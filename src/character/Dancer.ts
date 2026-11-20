import type { AudioFeatures } from '../audio/types';
import type { Rig } from './LilGuy';

/**
 * A pose is a small set of named joint values. Moves produce poses; poses are
 * blended; the final pose is applied to the rig. Units are radians except
 * squash (fraction) and offsetX (world units).
 *
 * Arm "out" = raise sideways, arm/leg "fwd" = swing forward. Both are
 * expressed per-side so mirrored moves read naturally.
 */
export interface Pose {
  squash: number;
  offsetX: number;
  bodyYaw: number;
  bodyRoll: number;
  lean: number;
  headNod: number;
  headTilt: number;
  armOutL: number;
  armFwdL: number;
  armOutR: number;
  armFwdR: number;
  legL: number;
  legR: number;
}

const ZERO: Pose = {
  squash: 0,
  offsetX: 0,
  bodyYaw: 0,
  bodyRoll: 0,
  lean: 0,
  headNod: 0,
  headTilt: 0,
  armOutL: 0.12,
  armFwdL: 0,
  armOutR: 0.12,
  armFwdR: 0,
  legL: 0,
  legR: 0,
};

const pose = (p: Partial<Pose>): Pose => ({ ...ZERO, ...p });

/** Sharp-but-smooth pulse: 1 on the beat, 0 halfway between beats. */
const hit = (b: number) => ((1 + Math.cos(2 * Math.PI * frac(b))) / 2) ** 2;

export interface DanceMove {
  name: string;
  /** Only picked when the music's drive (0..1 normalized loudness) is at least this. */
  minEnergy?: number;
  pose: (beat: number, f: AudioFeatures) => Pose;
}

export const MOVES: DanceMove[] = [
  {
    name: 'Bounce',
    pose: (b) => {
      const h = hit(b);
      return pose({ squash: 0.1 * h, headNod: 0.25 * h, armOutL: 0.35 + 0.1 * h, armOutR: 0.35 + 0.1 * h, armFwdL: 0.3 * h, armFwdR: 0.3 * h });
    },
  },
  {
    name: 'Sway',
    pose: (b) => {
      const s = Math.cos(Math.PI * b);
      return pose({ squash: 0.05 * hit(b), offsetX: 0.08 * s, bodyRoll: -0.12 * s, headTilt: 0.2 * s, armOutL: 0.2, armOutR: 0.2, armFwdL: 0.5 * s, armFwdR: -0.5 * s });
    },
  },
  {
    name: 'Step',
    pose: (b) => {
      const s = Math.sin(Math.PI * b);
      return pose({
        squash: 0.05 * hit(b),
        bodyYaw: 0.3 * Math.sin((Math.PI * b) / 2),
        legL: 0.5 * Math.max(0, s),
        legR: 0.5 * Math.max(0, -s),
        armFwdL: -0.6 * s,
        armFwdR: 0.6 * s,
        armOutL: 0.2,
        armOutR: 0.2,
        headNod: 0.12 * hit(b),
      });
    },
  },
  {
    name: 'Raise the Roof',
    minEnergy: 0.35,
    pose: (b) => {
      const h = hit(b);
      return pose({ squash: 0.1 * h, headNod: 0.2 * h, armOutL: 2.4 + 0.4 * h, armOutR: 2.4 + 0.4 * h, armFwdL: 0.2, armFwdR: 0.2, lean: -0.08 });
    },
  },
  {
    name: 'Spin',
    minEnergy: 0.45,
    pose: (b) => {
      const p = frac(b / 4); // one full spin every 4 beats
      return pose({ bodyYaw: 2 * Math.PI * smoothstep(p), squash: 0.05 * hit(b), armOutL: 1.2, armOutR: 1.2, headTilt: 0.15 });
    },
  },
];

const BEATS_PER_SEGMENT = 8;
const CROSSFADE_BEATS = 0.75;

/**
 * Turns AudioFeatures into motion. Holds an idle animation when there's no
 * music and fades into dancing when there is. Every 8 beats it switches to a
 * new move (weighted by energy) and crossfades between them.
 */
export class Dancer {
  /** 0 = idle, 1 = full dance. Exposed for UI/debug. */
  intensity = 0;
  currentMove: DanceMove = MOVES[0];

  private prevMove: DanceMove = MOVES[0];
  private segment = -1;
  private segmentStart = 0;
  private moveCounter = 0;
  private time = 0;
  private nextBlink = 2;
  private blinkUntil = 0;
  private current: Pose = { ...ZERO };

  update(f: AudioFeatures, dt: number): Pose {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt;
    // Typical music sits around 0.15–0.4 raw energy; stretch that to 0..1.
    const drive = clamp(f.energy * 2.5, 0, 1);
    const b = f.beat;

    // Pick a new move each segment.
    const seg = Math.floor(b / BEATS_PER_SEGMENT);
    if (seg !== this.segment) {
      this.segment = seg;
      this.segmentStart = seg * BEATS_PER_SEGMENT;
      this.prevMove = this.currentMove;
      this.currentMove = this.pickMove(drive);
    }

    // Dance pose (with crossfade between moves).
    const blend = smoothstep(Math.min(1, Math.max(0, (b - this.segmentStart) / CROSSFADE_BEATS)));
    const dance = lerpPose(this.prevMove.pose(b, f), this.currentMove.pose(b, f), blend);

    // Louder bass = bigger squash.
    dance.squash *= 0.7 + 0.6 * f.bass;

    // Idle: gentle breathing and looking around.
    const t = this.time;
    const idle = pose({ squash: 0.015 * Math.sin(t * 2.2), headTilt: 0.06 * Math.sin(t * 0.7), headNod: 0.03 * Math.sin(t * 0.5) });

    const target = f.active ? 0.55 + 0.45 * drive : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt * 3));

    const out = lerpPose(idle, dance, this.intensity);
    // Unwrap yaw so a spin finishing at 2π doesn't smooth backwards to 0.
    const TAU = Math.PI * 2;
    this.current.bodyYaw += Math.round((out.bodyYaw - this.current.bodyYaw) / TAU) * TAU;
    // Light smoothing removes any pops from beat-clock corrections.
    this.current = lerpPose(this.current, out, 1 - Math.exp(-dt * 25));
    return this.current;
  }

  /** Apply a pose to the rig, including eye blinks. */
  apply(rig: Rig, p: Pose): void {
    rig.root.scale.set(1 + p.squash * 0.5, 1 - p.squash, 1 + p.squash * 0.5);
    rig.root.position.x = p.offsetX;
    rig.root.rotation.y = p.bodyYaw;
    rig.root.rotation.z = p.bodyRoll * 0.4;
    rig.torso.rotation.x = p.lean;
    rig.torso.rotation.z = p.bodyRoll;
    rig.head.rotation.x = p.headNod;
    rig.head.rotation.z = p.headTilt;
    rig.armL.rotation.set(-p.armFwdL, 0, p.armOutL);
    rig.armR.rotation.set(-p.armFwdR, 0, -p.armOutR);
    rig.legL.rotation.x = -p.legL;
    rig.legR.rotation.x = -p.legR;

    if (this.time > this.nextBlink) {
      this.blinkUntil = this.time + 0.12;
      this.nextBlink = this.time + 2 + Math.random() * 3;
    }
    const eyeY = this.time < this.blinkUntil ? 0.1 : 1;
    for (const e of rig.eyes) e.scale.y = eyeY;
  }

  private pickMove(drive: number): DanceMove {
    const options = MOVES.filter((m) => (m.minEnergy ?? 0) <= drive && m !== this.currentMove);
    const pool = options.length ? options : MOVES;
    this.moveCounter++;
    return pool[(this.moveCounter * 7 + Math.floor(Math.random() * pool.length)) % pool.length];
  }
}

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const k in a) {
    const key = k as keyof Pose;
    out[key] = a[key] + (b[key] - a[key]) * t;
  }
  return out;
}

function frac(x: number): number {
  return x - Math.floor(x);
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
