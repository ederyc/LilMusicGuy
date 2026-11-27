import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Body, Spring } from '../src/character/Body';
import { MOVES, REST_POSE, type Pose } from '../src/character/Dancer';
import { chainWeights, DIMS, LilGuy } from '../src/character/LilGuy';
import { SILENT_FEATURES, type AudioFeatures } from '../src/audio/types';

const REST: Pose = { ...REST_POSE };

function setup() {
  const guy = new LilGuy();
  const body = new Body(guy.rig);
  return { guy, rig: guy.rig, body };
}

/** Run the body toward a pose for `seconds` at 60 fps. */
function hold(body: Body, pose: Pose, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    body.update(pose, 1 / 60);
    body.apply();
  }
}

const world = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return o.getWorldPosition(new THREE.Vector3());
};

describe('Spring', () => {
  it('settles on its target', () => {
    const s = new Spring(0);
    for (let i = 0; i < 240 * 2; i++) s.step(1, 20, 0.6, 1 / 240);
    expect(s.x).toBeCloseTo(1, 3);
  });

  it('overshoots when underdamped, not when critically damped', () => {
    const peak = (zeta: number) => {
      const s = new Spring(0);
      let max = 0;
      for (let i = 0; i < 240; i++) max = Math.max(max, (s.step(1, 20, zeta, 1 / 240), s.x));
      return max;
    };
    expect(peak(0.3)).toBeGreaterThan(1.2);
    expect(peak(1)).toBeLessThan(1.001);
  });
});

describe('skin weights', () => {
  it('always sum to 1 and blend only near joints', () => {
    const joints = [{ y: 0.18, blend: 0.07 }, { y: 0.4, blend: 0.08 }];
    for (let y = -0.1; y <= 0.6; y += 0.01) {
      const w = chainWeights(y, joints);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    expect(chainWeights(0, joints)).toEqual([1, 0, 0]);
    expect(chainWeights(0.29, joints)[1]).toBeCloseTo(1, 6);
    expect(chainWeights(0.18, joints)[0]).toBeCloseTo(0.5, 6);
  });
});

describe('Body', () => {
  it('stands with both feet flat on the ground at rest', () => {
    const { rig, body } = setup();
    hold(body, REST, 1);
    for (const leg of [rig.legs.L, rig.legs.R]) {
      expect(world(leg.foot).y).toBeCloseTo(DIMS.ankleY, 3);
      // foot level: its local up axis points straight up
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(leg.foot.getWorldQuaternion(new THREE.Quaternion()));
      expect(up.y).toBeGreaterThan(0.999);
    }
  });

  it('keeps the feet planted while the hips drop, shift, push and twist, bending the knees forward', () => {
    const { rig, body } = setup();
    hold(body, REST, 1);
    const before = { L: world(rig.legs.L.foot), R: world(rig.legs.R.foot) };
    hold(body, { ...REST, hipDrop: 0.08, hipShift: 0.05, hipPush: 0.03, hipTwist: 0.3 }, 1.5);
    for (const s of ['L', 'R'] as const) {
      const leg = rig.legs[s];
      expect(world(leg.foot).distanceTo(before[s])).toBeLessThan(0.002);
      const hip = world(leg.thigh);
      const knee = world(leg.shin);
      const ankle = world(leg.foot);
      // knee sits in front of the hip–ankle line
      expect(knee.z).toBeGreaterThan((hip.z + ankle.z) / 2 + 0.02);
    }
  });

  it('reaches lifted foot targets', () => {
    const { rig, body } = setup();
    hold(body, { ...REST, footLiftL: 0.15, footFwdL: 0.1 }, 1.5);
    const ankle = world(rig.legs.L.foot);
    expect(ankle.y).toBeCloseTo(DIMS.ankleY + 0.15, 2);
    expect(ankle.z).toBeCloseTo(0.1, 2);
    expect(world(rig.legs.R.foot).y).toBeCloseTo(DIMS.ankleY, 3);
  });

  it('jiggles after a sudden move, then settles', () => {
    const { body } = setup();
    hold(body, REST, 1);
    let maxNod = 0;
    let maxBelly = 0;
    for (let t = 0; t < 0.6; t += 1 / 60) {
      body.update({ ...REST, hipDrop: 0.1 }, 1 / 60);
      maxNod = Math.max(maxNod, Math.abs(body.jiggleValue('headNod')));
      maxBelly = Math.max(maxBelly, Math.abs(body.jiggleValue('belly')));
    }
    expect(maxNod).toBeGreaterThan(0.02);
    expect(maxBelly).toBeGreaterThan(0.02);
    hold(body, { ...REST, hipDrop: 0.1 }, 3);
    expect(Math.abs(body.jiggleValue('headNod'))).toBeLessThan(0.002);
    expect(Math.abs(body.jiggleValue('belly'))).toBeLessThan(0.002);
  });

  it('stays stable with long or uneven frames', () => {
    const { body } = setup();
    for (let i = 0; i < 200; i++) {
      body.update({ ...REST, hipDrop: i % 2 ? 0.1 : 0, armOutL: i % 3 ? 2 : 0 }, i % 7 === 0 ? 0.25 : 1 / 30);
      body.apply();
    }
    expect(Number.isFinite(body.value('hipDrop'))).toBe(true);
    expect(Math.abs(body.jiggleValue('headNod'))).toBeLessThan(1);
  });
});

describe('every move through the body', () => {
  const features = (beat: number): AudioFeatures => ({ ...SILENT_FEATURES, beat, bpm: 120, energy: 0.3, bass: 0.6, active: true });

  for (const move of MOVES) {
    it(`${move.name}: finite, feet never sink below the floor`, () => {
      const { rig, body } = setup();
      let lowest = Infinity;
      for (let t = 0; t < 8; t += 1 / 60) {
        const b = t * 2;
        body.update(move.pose(b, features(b)), 1 / 60);
        body.apply();
        for (const leg of [rig.legs.L, rig.legs.R]) {
          const p = world(leg.foot);
          expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
          lowest = Math.min(lowest, p.y);
        }
      }
      expect(lowest).toBeGreaterThan(DIMS.ankleY - 0.005);
    });
  }

  it('Hop Kick leaves the ground with both feet, and kicks', () => {
    const move = MOVES.find((m) => m.name === 'Hop Kick')!;
    const { rig, body } = setup();
    let bothUp = 0;
    let kick = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      const b = t * 2;
      body.update(move.pose(b, features(b)), 1 / 60);
      body.apply();
      const l = world(rig.legs.L.foot);
      const r = world(rig.legs.R.foot);
      bothUp = Math.max(bothUp, Math.min(l.y, r.y) - DIMS.ankleY);
      kick = Math.max(kick, l.z, r.z);
    }
    expect(bothUp).toBeGreaterThan(0.06);
    expect(kick).toBeGreaterThan(0.18);
  });

  it('Noodle Wave passes through every arm joint in turn', () => {
    const move = MOVES.find((m) => m.name === 'Noodle Wave')!;
    // left to right over the first 4 beats: each joint peaks after the one before it
    const peakOf = (key: keyof Pose) => {
      let best = -Infinity;
      let at = 0;
      for (let b = 0; b < 4; b += 0.01) {
        const v = move.pose(b, features(b))[key];
        if (v > best) [best, at] = [v, b];
      }
      return at;
    };
    const order = [peakOf('wristUpL'), peakOf('elbowUpL'), peakOf('armOutL'), peakOf('armOutR'), peakOf('elbowUpR'), peakOf('wristUpR')];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it('Body Roll moves head, chest, then hips in sequence', () => {
    const move = MOVES.find((m) => m.name === 'Body Roll')!;
    const peakOf = (key: keyof Pose) => {
      let best = -Infinity;
      let at = 0;
      for (let b = 0; b < 2; b += 0.01) {
        const v = move.pose(b, features(b))[key];
        if (v > best) [best, at] = [v, b];
      }
      return at;
    };
    expect(peakOf('chestPush')).toBeGreaterThan(peakOf('headNod'));
    expect(peakOf('hipPush')).toBeGreaterThan(peakOf('chestPush'));
  });
});

describe('sitting', () => {
  it('sits on the front edge with legs hanging over it, then stands back up on the same spot', () => {
    const { rig, body } = setup();
    body.seatEdge = 0.3;
    hold(body, REST, 1);
    const standing = { L: world(rig.legs.L.foot), R: world(rig.legs.R.foot) };

    hold(body, { ...REST, sit: 1 }, 2.5);
    const hips = world(rig.pelvis);
    expect(hips.y).toBeLessThan(0.15);
    expect(hips.z).toBeGreaterThan(0.2);
    expect(hips.z).toBeLessThan(0.3);
    for (const leg of [rig.legs.L, rig.legs.R]) {
      const ankle = world(leg.foot);
      expect(ankle.y).toBeLessThan(-0.05); // below the surface he's sitting on
      expect(ankle.z).toBeGreaterThan(0.3 + 0.08); // out past the edge
      expect(world(leg.shin).z).toBeGreaterThan(0.3); // knees over the edge
    }

    hold(body, REST, 2.5);
    expect(world(rig.legs.L.foot).distanceTo(standing.L)).toBeLessThan(0.003);
    expect(world(rig.legs.R.foot).distanceTo(standing.R)).toBeLessThan(0.003);
  });

  it('lifts the feet over the edge on the way down instead of dragging them through it', () => {
    const { rig, body } = setup();
    body.seatEdge = 0.3;
    hold(body, REST, 1);
    for (let t = 0; t < 2.5; t += 1 / 60) {
      body.update({ ...REST, sit: 1 }, 1 / 60);
      body.apply();
      const ankle = world(rig.legs.L.foot);
      // anywhere over the top surface, the foot must be on or above it
      if (ankle.z < 0.3 - 0.05) expect(ankle.y).toBeGreaterThan(DIMS.ankleY - 0.01);
    }
  });
});
