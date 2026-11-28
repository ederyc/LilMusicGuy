import * as THREE from 'three';
import type { Pose } from './Dancer';
import { DIMS, type LegRig, type Rig } from './LilGuy';

/**
 * Damped spring on one value. `omega` = how fast it follows (rad/s), `zeta` = damping
 * (1 = no overshoot, lower = bouncier). `step` returns the acceleration it applied, which
 * is what drives secondary motion further down the body.
 */
export class Spring {
  v = 0;
  constructor(public x = 0) {}

  step(target: number, omega: number, zeta: number, dt: number, force = 0): number {
    const a = omega * omega * (target - this.x) - 2 * zeta * omega * this.v + force;
    this.v += a * dt; // semi-implicit Euler: stable at the small substeps we use
    this.x += this.v * dt;
    return a;
  }
}

/** Spring settings per joint group: [omega, zeta]. Core is tight so the beat stays crisp; extremities are looser. */
const TUNING = {
  core: [40, 0.9],
  yaw: [22, 0.85],
  spine: [30, 0.7],
  head: [26, 0.55],
  arm: [28, 0.6],
  elbow: [20, 0.5],
  leg: [38, 0.9],
  /** Sitting down / standing up: slow and smooth, no bounce. */
  sit: [7, 1],
  /** Facial expression (brows). */
  face: [24, 1],
} as const satisfies Record<string, readonly [number, number]>;

const GROUP: Partial<Record<keyof Pose, keyof typeof TUNING>> = {
  hipDrop: 'core', hipShift: 'core', hipPush: 'core', hipTwist: 'core', hipTilt: 'core', jump: 'core', offsetX: 'core', squash: 'core',
  bodyYaw: 'yaw',
  lean: 'spine', bodyRoll: 'spine', chestLean: 'spine', chestTwist: 'spine', chestSlide: 'spine', chestPush: 'spine',
  headNod: 'head', headTilt: 'head', headTurn: 'head', headSlide: 'head',
  armOutL: 'arm', armFwdL: 'arm', armOutR: 'arm', armFwdR: 'arm',
  elbowL: 'elbow', elbowR: 'elbow', elbowUpL: 'elbow', elbowUpR: 'elbow',
  wristL: 'elbow', wristR: 'elbow', wristUpL: 'elbow', wristUpR: 'elbow',
  sit: 'sit',
  browDown: 'face',
  legL: 'leg', legR: 'leg', footLiftL: 'leg', footLiftR: 'leg', footFwdL: 'leg', footFwdR: 'leg', footOutL: 'leg', footOutR: 'leg',
};

/**
 * Secondary ("jiggle") springs. They rest at 0 and are pushed around by the body's own
 * accelerations: the head lags when the hips snap, arms flop on landings, forearms whip
 * after the upper arm stops, the belly squashes when he lands, hats wobble.
 */
const JIGGLE = {
  headNod: [13, 0.3],
  headTilt: [13, 0.3],
  headTurn: [11, 0.35],
  belly: [18, 0.28],
  armOutL: [10, 0.3],
  armOutR: [10, 0.3],
  armFwdL: [10, 0.3],
  armFwdR: [10, 0.3],
  elbowL: [15, 0.35],
  elbowR: [15, 0.35],
  hatX: [11, 0.22],
  hatZ: [11, 0.22],
} as const satisfies Record<string, readonly [number, number]>;
type JiggleName = keyof typeof JIGGLE;

/**
 * How far each jiggle settles per unit of acceleration (radians per m/s², or per rad/s²
 * for rotations). Resonance makes the actual swing a bit bigger on rhythmic moves.
 */
const GAIN = {
  headFromBodyY: 0.004,
  headFromBodyX: 0.025,
  headFromYaw: 0.016,
  bellyFromBodyY: 0.003,
  armFromBodyY: 0.006,
  armFromBodyX: 0.03,
  armFromBodyZ: 0.03,
  /** Arms fling out by this × (spin speed in rad/s)². */
  armFromYawSpeed: 0.03,
  elbowFromShoulder: 0.002,
  hatFromHead: 0.001,
};

/** Hips sit slightly low at rest so the knees are soft, never locked straight. */
const BASE_DROP = 0.02;
/** Feet stand a touch wider than the hips. */
const BASE_FOOT_OUT = 0.015;
/** Relaxed arms keep a slight elbow bend. */
const BASE_ELBOW = 0.18;
/** Pelvis height above the surface when sitting on it. */
const SEAT_Y = 0.08;
/** How far back from the front edge he sits (his thighs overhang the edge). */
const SEAT_BACK = 0.06;
const MAX_SUBSTEP = 1 / 240;

/**
 * Physical layer between the Dancer's poses and the skeleton. Poses say what he's
 * *trying* to do; the Body follows them through springs, adds secondary motion from
 * the resulting accelerations, solves the legs with IK so his feet stay planted, and
 * writes everything to the bones.
 */
export class Body {
  private springs = new Map<keyof Pose, Spring>();
  private jiggle = {} as Record<JiggleName, Spring>;
  private accel = new Map<keyof Pose, number>();
  private eyeOpen = 1;
  private spinFling = 0;
  private target = new THREE.Vector3();
  private dangle = new THREE.Vector3();

  /**
   * z of the front edge of whatever he's standing on (root space). When the pose says
   * `sit`, he sits here with his legs hanging over it.
   */
  seatEdge = 0.25;

  constructor(private rig: Rig) {
    for (const k of Object.keys(JIGGLE) as JiggleName[]) this.jiggle[k] = new Spring();
  }

  /** Current (physical) value of a pose channel. */
  value(k: keyof Pose): number {
    return this.springs.get(k)?.x ?? 0;
  }

  /** Current value of a secondary spring, for debugging / tests. */
  jiggleValue(k: JiggleName): number {
    return this.jiggle[k].x;
  }

  update(target: Pose, dt: number): void {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.eyeOpen = target.eyeOpen; // blinks are instant; not physical

    // Unwrap yaw so a spin finishing at 2π doesn't spring backwards to 0.
    const yaw = this.spring('bodyYaw', target.bodyYaw);
    const TAU = Math.PI * 2;
    const yawTarget = target.bodyYaw + Math.round((yaw.x - target.bodyYaw) / TAU) * TAU;

    const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this.substep(target, yawTarget, h);
  }

  private substep(target: Pose, yawTarget: number, h: number): void {
    for (const key of Object.keys(target) as (keyof Pose)[]) {
      if (key === 'eyeOpen') continue;
      const group = GROUP[key];
      if (!group) continue;
      const [w, z] = TUNING[group];
      const spr = this.spring(key, target[key]);
      this.accel.set(key, spr.step(key === 'bodyYaw' ? yawTarget : target[key], w, z, h));
    }

    // Body accelerations (m/s²): vertical from hips dropping / jumping, sideways from hip shifts.
    const acc = (k: keyof Pose) => this.accel.get(k) ?? 0;
    const accY = acc('jump') - acc('hipDrop') - 0.35 * acc('squash');
    const accX = acc('hipShift') + acc('offsetX') + 0.5 * acc('chestSlide');
    const accZ = acc('hipPush') + 0.5 * acc('chestPush');
    const yawAcc = acc('bodyYaw') + acc('hipTwist') + acc('chestTwist');
    const yawSpeed = this.springs.get('bodyYaw')?.v ?? 0;
    const spin = Math.min(1.2, GAIN.armFromYawSpeed * yawSpeed * yawSpeed);

    // A jiggle pushed by `settle`: where it would come to rest if the push held steady.
    const kick = (name: JiggleName, settle: number) => {
      const [w, z] = JIGGLE[name];
      return this.jiggle[name].step(0, w, z, h, w * w * settle);
    };
    // Head: keeps going when the body stops (nods on landings, lags side to side).
    const headNodAcc = kick('headNod', GAIN.headFromBodyY * accY);
    const headTiltAcc = kick('headTilt', -GAIN.headFromBodyX * accX);
    kick('headTurn', -GAIN.headFromYaw * yawAcc);
    // Belly squashes when he lands or pushes off.
    kick('belly', GAIN.bellyFromBodyY * accY);
    // Arms float up as he drops, flop down as he lands, swing against sideways moves.
    kick('armOutL', -GAIN.armFromBodyY * accY - GAIN.armFromBodyX * accX);
    kick('armOutR', -GAIN.armFromBodyY * accY + GAIN.armFromBodyX * accX);
    kick('armFwdL', -GAIN.armFromBodyZ * accZ);
    kick('armFwdR', -GAIN.armFromBodyZ * accZ);
    // Forearms whip: they lag the upper arm, then flick past it when it stops.
    kick('elbowL', -GAIN.elbowFromShoulder * (acc('armFwdL') + 0.5 * Math.abs(acc('armOutL'))));
    kick('elbowR', -GAIN.elbowFromShoulder * (acc('armFwdR') + 0.5 * Math.abs(acc('armOutR'))));
    // Whatever's on his head wobbles after his head moves.
    kick('hatX', -GAIN.hatFromHead * (acc('headNod') + headNodAcc));
    kick('hatZ', -GAIN.hatFromHead * (acc('headTilt') + headTiltAcc));

    // Spinning flings the arms outward (centrifugal), handled as a steady offset.
    this.spinFling = spin;
  }

  private spring(k: keyof Pose, initial: number): Spring {
    let s = this.springs.get(k);
    if (!s) {
      s = new Spring(initial);
      this.springs.set(k, s);
    }
    return s;
  }

  /** Write the current physical state onto the skeleton. */
  apply(): void {
    const r = this.rig;
    const p = (k: keyof Pose) => this.value(k);
    const j = (k: JiggleName) => clamp(this.jiggle[k].x, -0.6, 0.6);

    // Legacy channels: `squash` sinks the hips (knees bend) and compresses the belly a
    // little; `offsetX` shifts the hips while the feet stay planted.
    const squash = p('squash');
    const hipShift = p('hipShift') + p('offsetX');
    const roll = p('bodyRoll');
    const lean = p('lean');
    // Sitting: 0 = standing, 1 = sat on the front edge. Standing-only motion fades out.
    const sit = clamp(p('sit'), 0, 1);
    const stand = 1 - sit;
    const hipDrop = BASE_DROP + p('hipDrop') + squash * 0.35;
    const jump = Math.max(0, p('jump')) * stand;
    const seatZ = this.seatEdge - SEAT_BACK;

    // (the root's position belongs to whoever placed him; only his facing is ours)
    const yaw = p('bodyYaw');
    r.root.rotation.set(0, yaw, 0);

    // Standing, the hips move with his facing. Sitting, they stay on the seat (a fixed
    // spot on the prop) and he turns *on* it, so turning never slides him off the edge.
    const seatY = SEAT_Y + 0.3 * p('hipDrop');
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    r.pelvis.position.set(
      lerp(hipShift, -sin * seatZ, sit),
      lerp(DIMS.hipY - hipDrop + jump, seatY, sit),
      lerp(p('hipPush'), cos * seatZ, sit),
    );
    r.pelvis.rotation.set(0.15 * lean + p('hipTilt'), p('hipTwist'), 0.3 * roll);

    // Belly squash: scale the spine and undo it on the chest so only the middle squishes.
    const belly = clamp(squash * 0.5 + j('belly'), -0.25, 0.3);
    r.spine.scale.set(1 + belly * 0.5, 1 - belly, 1 + belly * 0.5);
    r.spine.rotation.set(0.4 * lean + 0.4 * p('chestLean'), 0.4 * p('chestTwist'), 0.35 * roll);

    r.chest.scale.set(1 / r.spine.scale.x, 1 / r.spine.scale.y, 1 / r.spine.scale.z);
    r.chest.position.set(p('chestSlide'), DIMS.chestY, p('chestPush'));
    r.chest.rotation.set(0.45 * lean + 0.6 * p('chestLean'), 0.6 * p('chestTwist'), 0.35 * roll);

    // Neck takes a share of every head motion so it curves instead of hinging.
    const nod = p('headNod') + j('headNod');
    const tilt = p('headTilt') + j('headTilt');
    const turn = p('headTurn') + j('headTurn');
    r.neck.position.set(p('headSlide'), DIMS.neckY, 0);
    r.neck.rotation.set(0.3 * nod, 0.3 * turn, 0.3 * tilt);
    r.head.rotation.set(0.7 * nod, 0.7 * turn, 0.7 * tilt);
    r.slots.head.rotation.set(j('hatX') * 0.6, 0, j('hatZ') * 0.6);

    // Arms. "Out" raises sideways, "fwd" swings forward; elbows/wrists flex forward,
    // "Up" variants bend within the arm's sideways plane (for waves).
    for (const [s, sign] of [['L', 1], ['R', -1]] as const) {
      const arm = r.arms[s];
      const out = p(`armOut${s}`) + j(`armOut${s}`) + this.spinFling;
      const fwd = p(`armFwd${s}`) + j(`armFwd${s}`);
      arm.upper.rotation.set(-fwd, 0, sign * out);
      const elbow = Math.max(-0.05, BASE_ELBOW + p(`elbow${s}`) + j(`elbow${s}`));
      arm.fore.rotation.set(-elbow, 0, sign * p(`elbowUp${s}`));
      arm.hand.rotation.set(-p(`wrist${s}`), 0, sign * p(`wristUp${s}`));
    }

    // Legs: put each ankle where it should be in root space, then solve.
    r.root.updateMatrix();
    r.pelvis.updateMatrix();
    for (const [s, sign] of [['L', 1], ['R', -1]] as const) {
      // `legL/R` (legacy) is a forward leg raise angle; turn it into a foot lift.
      const legRaise = p(`leg${s}`);
      const footLift = p(`footLift${s}`);
      const footFwd = p(`footFwd${s}`);
      const lift = Math.max(0, footLift + 0.28 * legRaise) + jump * 0.75;
      const x = sign * (DIMS.legX + BASE_FOOT_OUT + p(`footOut${s}`));
      this.target.set(x, DIMS.ankleY + lift, footFwd + 0.1 * legRaise);
      // Sitting: thighs out over the edge, shins hanging down, feet free to swing.
      this.dangle.set(
        x,
        r.pelvis.position.y + DIMS.legY - 0.01 - DIMS.shin + Math.max(0, footLift),
        r.pelvis.position.z + DIMS.thigh * 0.92 + footFwd,
      );
      this.target.lerp(this.dangle, sit);
      // Step the feet up and over the edge on the way, so they don't drag through it.
      this.target.y += 0.14 * Math.sin(Math.PI * sit);
      const toe = lerp(clamp((lift - jump * 0.75) * 2.2 + jump * 1.5, 0, 0.7), 0.35, sit);
      solveLeg(r.legs[s], r.pelvis, this.target, toe);
    }

    const eyeY = clamp(this.eyeOpen, 0.1, 1);
    for (const e of r.eyes) e.scale.y = eyeY;

    // Brows: down and pinched toward the middle when focused / intense, up when surprised.
    const brow = clamp(p('browDown'), -1, 1);
    for (const b of r.brows) {
      const rest = b.userData.rest as { position: THREE.Vector3; quaternion: THREE.Quaternion };
      b.position.copy(rest.position);
      b.position.y -= 0.016 * brow;
      b.position.x -= 0.006 * brow * b.userData.side;
      _browTilt.setFromAxisAngle(_z, 0.32 * brow * b.userData.side);
      b.quaternion.copy(rest.quaternion).multiply(_browTilt);
    }
  }

}

// ---------------------------------------------------------------------------
// Two-bone leg IK
// ---------------------------------------------------------------------------
const _inv = new THREE.Matrix4();
const _local = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _x = new THREE.Vector3(1, 0, 0);
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qFoot = new THREE.Quaternion();
const _browTilt = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);

/**
 * Bend the leg so the ankle lands on `ankleTarget` (root space). Knee points forward;
 * the foot is kept level with the ground, pitched toe-down by `toe` radians.
 * Assumes the pelvis matrix is up to date and its parent is the root.
 */
export function solveLeg(leg: LegRig, pelvis: THREE.Object3D, ankleTarget: THREE.Vector3, toe = 0): void {
  const L1 = DIMS.thigh;
  const L2 = DIMS.shin;

  _inv.copy(pelvis.matrix).invert();
  _local.copy(ankleTarget).applyMatrix4(_inv).sub(leg.thigh.position);
  const dist = clamp(_local.length(), 0.05, L1 + L2 - 1e-4);
  _dir.copy(_local).normalize();

  const knee = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));
  const hipLift = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));

  // Point the thigh at the target, then swing it forward so the knee leads.
  _qa.setFromUnitVectors(_down, _dir);
  _qb.setFromAxisAngle(_x, -hipLift);
  leg.thigh.quaternion.copy(_qa).multiply(_qb);
  leg.shin.quaternion.setFromAxisAngle(_x, knee);

  // Foot: undo pelvis + thigh + shin so it ends up level (plus toe pitch) in root space.
  _qFoot.copy(pelvis.quaternion).multiply(leg.thigh.quaternion).multiply(leg.shin.quaternion).invert();
  _qb.setFromAxisAngle(_x, toe);
  leg.foot.quaternion.copy(_qFoot).multiply(_qb);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
