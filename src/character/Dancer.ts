import type { AudioFeatures } from '../audio/types';
import type { Vibe, VibeName } from '../audio/VibeDetector';
import type { Rig } from './LilGuy';

/**
 * A pose is a small set of named joint values. Moves produce poses; poses are
 * blended; the final pose is applied to the rig. Units are radians except
 * squash (fraction), offsetX (world units) and eyeOpen (0 shut .. 1 open).
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
  eyeOpen: number;
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
  eyeOpen: 1,
};

const pose = (p: Partial<Pose>): Pose => ({ ...ZERO, ...p });

/** Sharp-but-smooth pulse: 1 on the beat, 0 halfway between beats. */
const hit = (b: number) => ((1 + Math.cos(2 * Math.PI * frac(b))) / 2) ** 2;
/** Softer pulse for laid-back moves. */
const soft = (b: number) => (1 + Math.cos(2 * Math.PI * frac(b))) / 2;
/** 1 or -1, alternating every beat. */
const alt = (b: number) => (Math.floor(b) % 2 === 0 ? 1 : -1);

export interface DanceMove {
  name: string;
  /** How well the move suits each vibe (0..1). Moves are picked by these. */
  vibes: Partial<Record<VibeName, number>>;
  /** With no vibe known yet, only picked when the music's drive (0..1) is at least this. */
  minEnergy?: number;
  pose: (beat: number, f: AudioFeatures) => Pose;
}

export const MOVES: DanceMove[] = [
  {
    name: 'Bounce',
    vibes: { bouncy: 0.8, hype: 0.6, groovy: 0.3 },
    pose: (b) => {
      const h = hit(b);
      return pose({ squash: 0.1 * h, headNod: 0.25 * h, armOutL: 0.35 + 0.1 * h, armOutR: 0.35 + 0.1 * h, armFwdL: 0.3 * h, armFwdR: 0.3 * h });
    },
  },
  {
    name: 'Sway',
    vibes: { chill: 0.8, mellow: 0.5, groovy: 0.3 },
    pose: (b) => {
      const s = Math.cos(Math.PI * b);
      return pose({ squash: 0.05 * hit(b), offsetX: 0.08 * s, bodyRoll: -0.12 * s, headTilt: 0.2 * s, armOutL: 0.2, armOutR: 0.2, armFwdL: 0.5 * s, armFwdR: -0.5 * s });
    },
  },
  {
    name: 'Step',
    vibes: { groovy: 0.8, chill: 0.4, bouncy: 0.3 },
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
    vibes: { hype: 1, bouncy: 0.4 },
    minEnergy: 0.35,
    pose: (b) => {
      const h = hit(b);
      return pose({ squash: 0.1 * h, headNod: 0.2 * h, armOutL: 2.4 + 0.4 * h, armOutR: 2.4 + 0.4 * h, armFwdL: 0.2, armFwdR: 0.2, lean: -0.08 });
    },
  },
  {
    name: 'Spin',
    vibes: { hype: 0.6, groovy: 0.3, bouncy: 0.2 },
    minEnergy: 0.45,
    pose: (b) => {
      const p = frac(b / 4); // one full spin every 4 beats
      return pose({ bodyYaw: 2 * Math.PI * smoothstep(p), squash: 0.05 * hit(b), armOutL: 1.2, armOutR: 1.2, headTilt: 0.15 });
    },
  },
  {
    // Lo-fi study mode: a slow, heavy nod and a lazy sway, eyes half shut.
    name: 'Head Nod',
    vibes: { chill: 1, mellow: 0.4, bouncy: 0.4 },
    pose: (b) => {
      const n = soft(b);
      const s = Math.sin((Math.PI * b) / 2);
      return pose({ squash: 0.03 * hit(b), headNod: 0.3 * n - 0.05, bodyRoll: 0.05 * s, headTilt: 0.08 * s, armOutL: 0.18, armOutR: 0.18, armFwdL: 0.15, armFwdR: 0.15, eyeOpen: 0.55 });
    },
  },
  {
    // Ballads: one long sway every four beats, barely moving.
    name: 'Slow Sway',
    vibes: { mellow: 1, chill: 0.4 },
    pose: (b) => {
      const s = Math.sin((Math.PI * b) / 2);
      return pose({ offsetX: 0.05 * s, bodyRoll: -0.1 * s, headTilt: 0.18 * s, headNod: 0.05, armFwdL: 0.15 * s, armFwdR: -0.15 * s, armOutL: 0.15, armOutR: 0.15, eyeOpen: 0.4 });
    },
  },
  {
    // Funk: shoulders pop side to side, accents land on the off-beat.
    name: 'Shoulder Bounce',
    vibes: { groovy: 1, bouncy: 0.4 },
    pose: (b) => {
      const off = hit(b + 0.5);
      const side = alt(b);
      return pose({ squash: 0.07 * off, bodyRoll: 0.15 * side * hit(b), headTilt: 0.12 * side, headNod: 0.15 * off, armFwdL: 0.9, armFwdR: 0.9, armOutL: 0.3 + 0.15 * off, armOutR: 0.3 + 0.15 * off });
    },
  },
  {
    // Hip-hop: deep knee bounce on the half-time, arms pumping on the beat.
    name: 'Knee Bounce',
    vibes: { bouncy: 1, hype: 0.3 },
    pose: (b) => {
      const big = hit(b / 2);
      const h = hit(b);
      const side = alt(b);
      return pose({
        squash: 0.16 * big + 0.05 * h,
        lean: 0.1 * big,
        headNod: 0.35 * big,
        armOutL: 0.25,
        armOutR: 0.25,
        armFwdL: 0.3 + (side > 0 ? 0.9 * h : 0),
        armFwdR: 0.3 + (side < 0 ? 0.9 * h : 0),
      });
    },
  },
  {
    name: 'Headbang',
    vibes: { headbang: 1, hype: 0.2 },
    minEnergy: 0.5,
    pose: (b) => {
      const h = hit(b);
      return pose({ squash: 0.06 * h, headNod: 0.55 * h - 0.15, lean: 0.18 + 0.1 * h, armOutL: 0.35, armOutR: 0.35, armFwdL: 0.2, armFwdR: 0.2, eyeOpen: 0.3 });
    },
  },
  {
    // Lean back, one hand on the neck, strum twice a beat.
    name: 'Air Guitar',
    vibes: { headbang: 0.8 },
    pose: (b) => {
      const h = hit(b);
      return pose({
        squash: 0.05 * h,
        lean: -0.1,
        bodyYaw: 0.25,
        headNod: 0.25 * h,
        armOutL: 0.6,
        armFwdL: 1.3,
        armOutR: 0.3,
        armFwdR: 0.6 + 0.35 * Math.sin(4 * Math.PI * b),
        legL: 0.15 * h,
        eyeOpen: 0.5,
      });
    },
  },
  {
    // Lift a leg between beats, stomp it down on the beat, alternating.
    name: 'Stomp',
    vibes: { headbang: 0.6, hype: 0.5 },
    pose: (b) => {
      const lift = Math.sin(Math.PI * frac(b)) ** 2;
      const left = alt(b) > 0;
      return pose({ squash: 0.12 * hit(b), legL: left ? 0.6 * lift : 0, legR: left ? 0 : 0.6 * lift, armOutL: 0.5, armOutR: 0.5, armFwdL: 0.4, armFwdR: 0.4, headNod: 0.2 * hit(b), lean: 0.08 });
    },
  },
];

/** While he's still working out the vibe: a hand on his headphones, a small nod, a finger tap. */
function listeningPose(b: number, t: number): Pose {
  const h = hit(b);
  return pose({
    squash: 0.02 * h,
    bodyRoll: 0.03 * Math.sin(t * 1.3),
    headTilt: 0.22,
    headNod: 0.08 * h,
    armOutR: 2.5,
    armFwdR: 0.35,
    armOutL: 0.15,
    armFwdL: 0.25 + 0.1 * h,
    eyeOpen: 0.7,
  });
}

/** What he does between songs or in a quiet bit, flavored by the last vibe he heard. */
const IDLES: Record<VibeName | 'none', (t: number) => Pose> = {
  none: (t) => pose({ squash: 0.015 * Math.sin(t * 2.2), headTilt: 0.06 * Math.sin(t * 0.7), headNod: 0.03 * Math.sin(t * 0.5) }),
  mellow: (t) => pose({ squash: 0.012 * Math.sin(t * 1.6), headTilt: 0.08 * Math.sin(t * 0.5), bodyRoll: 0.04 * Math.sin(t * 0.5), eyeOpen: 0.5 }),
  chill: (t) => pose({ squash: 0.012 * Math.sin(t * 1.6), headTilt: 0.08 * Math.sin(t * 0.5), bodyRoll: 0.04 * Math.sin(t * 0.5), eyeOpen: 0.6 }),
  groovy: (t) => {
    const s = Math.sin(t * 1.8);
    return pose({ offsetX: 0.02 * s, bodyRoll: 0.05 * s, headTilt: 0.06 * Math.sin(t * 0.9), armFwdL: 0.1 * s, armFwdR: -0.1 * s });
  },
  bouncy: (t) => {
    const up = (Math.sin(t * 6) * 0.5 + 0.5) ** 2;
    return pose({ squash: 0.035 * up, headNod: 0.05 * up, armOutL: 0.2, armOutR: 0.2 });
  },
  hype: (t) => {
    const up = (Math.sin(t * 7) * 0.5 + 0.5) ** 2;
    return pose({ squash: 0.045 * up, headNod: 0.06 * up, armOutL: 0.25, armOutR: 0.25, headTilt: 0.05 * Math.sin(t * 1.7) });
  },
  headbang: (t) => pose({ headNod: 0.08 * Math.max(0, Math.sin(t * 5)), lean: 0.05, legL: 0.1 * Math.max(0, Math.sin(t * 2.5)) }),
};

const BEATS_PER_SEGMENT = 8;
const CROSSFADE_BEATS = 0.75;
/** After the music stops, his idle keeps the last vibe's flavor this long. */
const IDLE_MEMORY = 20;

/**
 * Turns AudioFeatures + the detected vibe into motion. Holds an idle animation when there's
 * no music and fades into dancing when there is. While the vibe is still being worked out he
 * listens; after that, every 8 beats he switches to a new move suited to the vibe and
 * crossfades between them.
 */
export class Dancer {
  /** 0 = idle, 1 = full dance. Exposed for UI/debug. */
  intensity = 0;
  currentMove: DanceMove = MOVES[0];

  private prevMove: DanceMove = MOVES[0];
  private segment = -1;
  private segmentStart = 0;
  private time = 0;
  private nextBlink = 2;
  private blinkUntil = 0;
  private listenMix = 0;
  private lastVibe: VibeName | null = null;
  private lastVibeAt = -Infinity;
  private current: Pose = { ...ZERO };

  /** What he's doing, for the UI. */
  get label(): string {
    if (this.intensity < 0.15) return 'Idle';
    if (this.listenMix > 0.5) return 'Listening…';
    return this.currentMove.name;
  }

  update(f: AudioFeatures, vibe: Vibe | null, dt: number): Pose {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt;
    // Typical music sits around 0.15–0.4 raw energy; stretch that to 0..1.
    const drive = clamp(f.energy * 2.5, 0, 1);
    const b = f.beat;
    const t = this.time;

    if (vibe?.name) {
      this.lastVibe = vibe.name;
      this.lastVibeAt = t;
    }

    // Pick a new move each segment.
    const seg = Math.floor(b / BEATS_PER_SEGMENT);
    if (seg !== this.segment) {
      this.segment = seg;
      this.segmentStart = seg * BEATS_PER_SEGMENT;
      this.prevMove = this.currentMove;
      this.currentMove = this.pickMove(drive, vibe);
    }

    // Dance pose (with crossfade between moves).
    const blend = smoothstep(Math.min(1, Math.max(0, (b - this.segmentStart) / CROSSFADE_BEATS)));
    let dance = lerpPose(this.prevMove.pose(b, f), this.currentMove.pose(b, f), blend);

    // Louder bass = bigger squash.
    dance.squash *= 0.7 + 0.6 * f.bass;

    // Still making up his mind: listen instead of dancing.
    const listenTarget = vibe?.listening && f.active ? 1 : 0;
    this.listenMix += (listenTarget - this.listenMix) * (1 - Math.exp(-dt * 4));
    dance = lerpPose(dance, listeningPose(b, t), this.listenMix);

    // Idle, flavored by the vibe he last heard.
    const idleVibe = this.lastVibe && t - this.lastVibeAt < IDLE_MEMORY ? this.lastVibe : 'none';
    const idle = IDLES[idleVibe](t);

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
    const eyeY = this.time < this.blinkUntil ? 0.1 : clamp(p.eyeOpen, 0.1, 1);
    for (const e of rig.eyes) e.scale.y = eyeY;
  }

  /**
   * With a vibe: a weighted pick by how well each move suits it, mixing in a little of the
   * runner-up vibe when it's close. Without one: any move the music is loud enough for.
   */
  private pickMove(drive: number, vibe: Vibe | null): DanceMove {
    const others = MOVES.filter((m) => m !== this.currentMove);
    if (vibe?.name) {
      const weigh = (m: DanceMove) =>
        (1 - vibe.blend) * (m.vibes[vibe.name!] ?? 0) + vibe.blend * (vibe.next ? m.vibes[vibe.next] ?? 0 : 0);
      const picked = weightedPick(others, weigh);
      if (picked) return picked;
    }
    // (one-vibe specialties like Air Guitar wait until there's a vibe that calls for them)
    const pool = others.filter((m) => (m.minEnergy ?? 0) <= drive && Object.keys(m.vibes).length > 1);
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : this.currentMove;
  }
}

function weightedPick<T>(items: T[], weight: (item: T) => number): T | null {
  const ws = items.map(weight);
  const total = ws.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
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
