import type { AudioFeatures } from '../audio/types';
import type { Vibe, VibeName } from '../audio/VibeDetector';

/**
 * A pose is a set of named joint targets: what he's *trying* to do. Moves produce
 * poses; poses are blended; the Body then follows them physically (springs, secondary
 * motion, leg IK). Units are radians, except world units for shifts/drops/lifts,
 * a fraction for squash and 0 (shut) .. 1 (open) for eyeOpen.
 *
 * Arm "out" = raise sideways, arm "fwd" = swing forward; elbows/wrists flex forward and
 * their "Up" variants bend within the arm's sideways plane (waves). Everything is
 * per-side so mirrored moves read naturally. Feet are positioned, not rotated: the IK
 * bends the knees to reach them, so they stay planted unless lifted.
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

  // --- Hips (feet stay planted; knees bend to make up the difference)
  /** Lower the hips (bend the knees). */
  hipDrop: number;
  /** Slide the hips sideways (+ = his left). */
  hipShift: number;
  /** Push the hips forward (+) or back. */
  hipPush: number;
  hipTwist: number;
  /** Tilt the pelvis (+ = tip forward). */
  hipTilt: number;
  /** Lift the whole body off the ground. */
  jump: number;
  /** 0 = standing, 1 = sitting on the front edge of his prop, legs dangling. */
  sit: number;

  // --- Upper body isolations
  /** Bend the upper spine forward (+) / back, on top of `lean`. */
  chestLean: number;
  chestTwist: number;
  /** Slide the ribcage sideways over the hips. */
  chestSlide: number;
  /** Push the ribcage forward (+) / back. */
  chestPush: number;
  headTurn: number;
  /** Slide the head sideways without tilting it. */
  headSlide: number;

  // --- Arms below the shoulder
  elbowL: number;
  elbowR: number;
  elbowUpL: number;
  elbowUpR: number;
  wristL: number;
  wristR: number;
  wristUpL: number;
  wristUpR: number;

  // --- Feet (offsets from where they normally stand)
  footLiftL: number;
  footLiftR: number;
  footFwdL: number;
  footFwdR: number;
  footOutL: number;
  footOutR: number;
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
  hipDrop: 0,
  hipShift: 0,
  hipPush: 0,
  hipTwist: 0,
  hipTilt: 0,
  jump: 0,
  sit: 0,
  chestLean: 0,
  chestTwist: 0,
  chestSlide: 0,
  chestPush: 0,
  headTurn: 0,
  headSlide: 0,
  elbowL: 0,
  elbowR: 0,
  elbowUpL: 0,
  elbowUpR: 0,
  wristL: 0,
  wristR: 0,
  wristUpL: 0,
  wristUpR: 0,
  footLiftL: 0,
  footLiftR: 0,
  footFwdL: 0,
  footFwdR: 0,
  footOutL: 0,
  footOutR: 0,
};

/** Standing relaxed: the neutral pose every move starts from. */
export const REST_POSE: Readonly<Pose> = ZERO;

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
  // ---- Mobility showcases: these lean on the bendy skeleton and the physics. ----
  {
    // A wave rolls from his left fingertips, through the shoulders, out the right
    // fingertips and back: every arm joint rises and settles in turn.
    name: 'Noodle Wave',
    vibes: { groovy: 1, chill: 0.6, mellow: 0.4, hype: 0.3 },
    pose: (b) => {
      // Where the wave is: 0 = left fingertips … 1 = right fingertips. It travels at a
      // steady pace, across in 4 beats and back in 4, reaching a new joint every half beat.
      const ph = frac(b / 8);
      const c = -0.175 + 1.35 * (ph < 0.5 ? 2 * ph : 2 - 2 * ph);
      const at = (x: number) => Math.exp(-(((x - c) / 0.15) ** 2));
      // As the wave reaches a joint it pops up; the joint before it bends back down,
      // so each arm makes a travelling S instead of moving as one stick.
      const arm = (hand: number, elbow: number, shoulder: number) => ({
        out: 1.3 + 0.65 * at(shoulder) - 0.3 * at(elbow),
        elbowUp: 1.3 * at(elbow) - 0.8 * at(shoulder) - 0.5 * at(hand),
        wristUp: 1.4 * at(hand) - 1.0 * at(elbow),
      });
      const L = arm(0, 0.175, 0.35);
      const R = arm(1, 0.825, 0.65);
      const side = c - 0.5; // which way the wave is leaning
      return pose({
        armOutL: L.out, elbowUpL: L.elbowUp, wristUpL: L.wristUp, elbowL: -0.15,
        armOutR: R.out, elbowUpR: R.elbowUp, wristUpR: R.wristUp, elbowR: -0.15,
        armFwdL: 0.1, armFwdR: 0.1,
        // ribcage and head ride along as it passes through the middle
        chestSlide: 0.07 * side,
        headSlide: 0.05 * side,
        headTilt: 0.3 * (at(0.35) - at(0.65)),
        headNod: -0.15 * at(0.5),
        hipShift: -0.04 * side,
        hipDrop: 0.03 * soft(b),
      });
    },
  },
  {
    // A wave down the spine: head, chest, hips, then knees, one roll every two beats.
    // He turns three-quarters so you can see the S-curve.
    name: 'Body Roll',
    vibes: { groovy: 0.8, mellow: 0.7, chill: 0.6 },
    pose: (b) => {
      const ph = Math.PI * b;
      const w = (lag: number) => Math.sin(ph - lag);
      return pose({
        bodyYaw: 0.55,
        headNod: 0.28 * w(0),
        chestPush: 0.06 * w(0.6),
        chestLean: 0.22 * w(0.3),
        hipPush: 0.06 * w(1.3),
        hipTilt: -0.25 * w(1.3),
        hipDrop: 0.045 + 0.04 * w(2),
        armOutL: 0.3, armOutR: 0.3,
        armFwdL: 0.2 + 0.3 * w(1), armFwdR: 0.2 + 0.3 * w(1),
        elbowL: 0.6 + 0.35 * w(1.4), elbowR: 0.6 + 0.35 * w(1.4),
        wristL: 0.4 * w(1.9), wristR: 0.4 * w(1.9),
        headTilt: 0.08 * Math.sin(ph / 2),
        eyeOpen: 0.6,
      });
    },
  },
  {
    // Crouch, hop (landing on the beat), kick; hop, kick with the other leg.
    name: 'Hop Kick',
    vibes: { hype: 0.9, bouncy: 0.8, headbang: 0.4 },
    minEnergy: 0.4,
    pose: (b) => {
      const p = frac(b);
      const beat = ((Math.floor(b) % 4) + 4) % 4;
      if (beat === 0 || beat === 2) {
        // crouch (0 → 0.2), launch, airborne, land right on the next beat
        const u = clamp((p - 0.2) / 0.75, 0, 1);
        const crouch = p < 0.2 ? smoothstep(p / 0.2) : 1 - smoothstep(Math.min(1, (p - 0.2) / 0.1));
        const air = 4 * u * (1 - u);
        return pose({
          hipDrop: 0.07 * crouch,
          lean: 0.15 * crouch - 0.05 * air,
          jump: 0.14 * air,
          armOutL: 0.4 + 1.6 * air, armOutR: 0.4 + 1.6 * air,
          armFwdL: 0.3 * crouch, armFwdR: 0.3 * crouch,
          elbowL: 0.6 * air, elbowR: 0.6 * air,
          headNod: 0.2 * crouch - 0.15 * air,
        });
      }
      // kick: land soft, then the kicking foot shoots out and back. He turns a little
      // away from the kicking leg so you see it from the side.
      const k = Math.sin(Math.PI * p);
      const left = beat === 3;
      const land = Math.exp(-p * 7);
      return pose({
        bodyYaw: (left ? -0.45 : 0.45) * k,
        hipDrop: 0.08 * land + 0.02,
        lean: -0.15 * k,
        footFwdL: left ? 0.3 * k : -0.02 * k,
        footLiftL: left ? 0.22 * k : 0,
        footFwdR: left ? -0.02 * k : 0.3 * k,
        footLiftR: left ? 0 : 0.22 * k,
        hipShift: (left ? -0.04 : 0.04) * k,
        // arms swing against the kick for balance
        armFwdL: left ? -0.4 * k : 0.9 * k, armFwdR: left ? 0.9 * k : -0.4 * k,
        armOutL: 0.5, armOutR: 0.5,
        elbowL: 0.5, elbowR: 0.5,
        headNod: 0.2 * land,
      });
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
/**
 * The Body's springs trail their targets by a few tens of milliseconds, so moves are
 * evaluated this far ahead of the beat clock to land on the beat.
 */
const LEAD_SECONDS = 0.045;
const CROSSFADE_BEATS = 0.75;
/** After the music stops, his idle keeps the last vibe's flavor this long. */
const IDLE_MEMORY = 20;
const YAWN_SECONDS = 2.4;
/** He sits turned a little to one side: it's comfier, and it reads better from the front. */
const SIT_TURN = 0.5;

/** Sitting on the edge of his prop: legs swinging, looking around, the odd yawn and stretch. */
function chillPose(t: number, yawn: number): Pose {
  const swing = (phase: number) => 0.07 * Math.sin(t * 2.4 + phase);
  // glance around every so often, otherwise look ahead
  const look = Math.sin(t * 0.31) * Math.max(0, Math.sin(t * 0.17));
  return pose({
    sit: 1,
    bodyYaw: SIT_TURN,
    lean: -0.04 - 0.1 * yawn,
    footFwdL: swing(0),
    footFwdR: swing(1.9),
    armOutL: 0.2 + 2.3 * yawn,
    armOutR: 0.2 + 2.3 * yawn,
    armFwdL: 0.5 * (1 - yawn),
    armFwdR: 0.5 * (1 - yawn),
    elbowL: 0.7 * (1 - yawn),
    elbowR: 0.7 * (1 - yawn),
    headNod: 0.04 - 0.3 * yawn,
    headTilt: 0.1 * Math.sin(t * 0.5),
    headTurn: 0.45 * look * (1 - yawn),
    eyeOpen: 0.85 - 0.65 * yawn,
  });
}

/** Dozed off where he sat: slumped forward, head down, slow breathing. */
function napPose(t: number): Pose {
  const breathe = Math.sin(t * 1.3);
  return pose({
    sit: 1,
    bodyYaw: SIT_TURN,
    lean: 0.2,
    chestLean: 0.12,
    squash: 0.015 * breathe,
    headNod: 0.5 + 0.04 * breathe,
    headTilt: 0.22,
    armOutL: 0.15,
    armOutR: 0.15,
    armFwdL: 0.55,
    armFwdR: 0.55,
    elbowL: 0.8,
    elbowR: 0.8,
    footFwdL: 0.02,
    footFwdR: -0.01,
    eyeOpen: 0.1,
  });
}

/** Smoothly move `x` toward `target` at `rate` (1/s), frame-rate independent. */
function approach(x: number, target: number, dt: number, rate: number): number {
  return x + (target - x) * (1 - Math.exp(-dt * rate));
}

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
  /** When set, he does only this move (test bench "Dance" picker). */
  private forced: DanceMove | null = null;
  private lastBeat = 0;
  private segment = -1;
  private segmentStart = 0;
  private time = 0;
  private nextBlink = 2;
  private blinkUntil = 0;
  private listenMix = 0;
  /** Seconds of quiet so far. */
  private quietFor = 0;
  private sitMix = 0;
  private napMix = 0;
  private startleAt = -Infinity;
  private yawnAt = -Infinity;
  private nextYawn = 15;

  /** Seconds of quiet before he sits down on his prop, and before he dozes off. */
  sitAfter = 6;
  napAfter = 60;

  /** 0..1 how asleep he is (for the Zzz's). */
  get sleepiness(): number {
    return this.napMix * this.sitMix;
  }
  private lastVibe: VibeName | null = null;
  private lastVibeAt = -Infinity;

  /** What he's doing, for the UI. */
  /** Lock him to one move, or pass null to go back to picking by the music. */
  force(move: DanceMove | null): void {
    this.forced = move;
    if (move && move !== this.currentMove) {
      this.prevMove = this.currentMove;
      this.currentMove = move;
      this.segmentStart = this.lastBeat; // crossfade from here
    }
  }

  get label(): string {
    if (this.intensity < 0.15) {
      if (this.sleepiness > 0.5) return 'Napping';
      if (this.sitMix > 0.5) return 'Chilling';
      return 'Idle';
    }
    if (this.listenMix > 0.5) return 'Listening…';
    return this.currentMove.name;
  }

  update(f: AudioFeatures, vibe: Vibe | null, dt: number): Pose {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.time += dt;
    // Typical music sits around 0.15–0.4 raw energy; stretch that to 0..1.
    const drive = clamp(f.energy * 2.5, 0, 1);
    const b = f.beat;
    this.lastBeat = b;
    const bp = b + (f.bpm ? (LEAD_SECONDS * f.bpm) / 60 : 0);
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
      this.currentMove = this.forced ?? this.pickMove(drive, vibe);
    }

    // Dance pose (with crossfade between moves).
    const blend = smoothstep(Math.min(1, Math.max(0, (b - this.segmentStart) / CROSSFADE_BEATS)));
    let dance = lerpPose(this.prevMove.pose(bp, f), this.currentMove.pose(bp, f), blend);

    // Louder bass = bigger squash.
    dance.squash *= 0.7 + 0.6 * f.bass;

    // Still making up his mind: listen instead of dancing.
    const listenTarget = vibe?.listening && f.active && !this.forced ? 1 : 0;
    this.listenMix += (listenTarget - this.listenMix) * (1 - Math.exp(-dt * 4));
    dance = lerpPose(dance, listeningPose(bp, t), this.listenMix);

    // Idle, flavored by the vibe he last heard.
    const idleVibe = this.lastVibe && t - this.lastVibeAt < IDLE_MEMORY ? this.lastVibe : 'none';
    const idle = IDLES[idleVibe](t);

    // Resting: the longer it's quiet, the more settled he gets. A short gap between
    // songs he waits on his feet; then he sits on his prop's edge; eventually he naps.
    this.quietFor = f.active ? 0 : this.quietFor + dt;
    const sitTarget = this.quietFor > this.sitAfter ? 1 : 0;
    const napTarget = this.quietFor > this.napAfter ? 1 : 0;
    if (f.active && this.napMix > 0.4) this.startleAt = t; // music woke him up
    this.sitMix = approach(this.sitMix, sitTarget, dt, sitTarget ? 1.2 : 2.5);
    this.napMix = approach(this.napMix, napTarget, dt, napTarget ? 0.35 : 6); // dozes off slowly, wakes at once

    if (this.sitMix > 0.9 && this.napMix < 0.1 && t > this.nextYawn) {
      this.yawnAt = t;
      this.nextYawn = t + 18 + Math.random() * 20;
    }
    const u = (t - this.yawnAt) / YAWN_SECONDS;
    const yawn = u >= 0 && u <= 1 ? Math.sin(Math.PI * u) ** 2 : 0;

    let rest = lerpPose(idle, chillPose(t, yawn), this.sitMix);
    rest = lerpPose(rest, napPose(t), this.napMix * this.sitMix);

    // He gets up before he gets down: dancing waits until he's off his seat.
    const target = f.active ? (0.55 + 0.45 * drive) * (1 - this.sitMix) : 0;
    this.intensity += (target - this.intensity) * (1 - Math.exp(-dt * 3));

    const out = lerpPose(rest, dance, this.intensity);

    // Startled awake: eyes wide, a jolt, arms fly out, then it fades.
    const since = t - this.startleAt;
    if (since >= 0 && since < 1.2) {
      const e = Math.exp(-since * 4);
      out.eyeOpen = 1;
      out.headNod -= 0.35 * e;
      out.lean -= 0.15 * e;
      out.armOutL += 1.1 * e;
      out.armOutR += 1.1 * e;
      out.elbowL += 0.6 * e;
      out.elbowR += 0.6 * e;
    }

    if (this.time > this.nextBlink) {
      this.blinkUntil = this.time + 0.12;
      this.nextBlink = this.time + 2 + Math.random() * 3;
    }
    if (this.time < this.blinkUntil && since > 1.2) out.eyeOpen = 0.1;
    return out;
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
