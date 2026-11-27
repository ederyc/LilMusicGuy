import * as THREE from 'three';

export interface LilGuyColors {
  skin: string;
  shirt: string;
  pants: string;
  shoes: string;
}

export const DEFAULT_COLORS: LilGuyColors = {
  skin: '#ffd2b0',
  shirt: '#6c5ce7',
  pants: '#2d3436',
  shoes: '#fdfdfd',
};

/** Attachment points for accessories (future shop items). */
export type SlotName = 'head' | 'face' | 'back' | 'leftHand' | 'rightHand';

export interface ArmRig {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
}

export interface LegRig {
  thigh: THREE.Bone;
  shin: THREE.Bone;
  foot: THREE.Bone;
}

/** The skeleton the Body drives. "L" is the character's left (+x). */
export interface Rig {
  /** Whole character, origin between the feet on the ground. */
  root: THREE.Group;
  pelvis: THREE.Bone;
  spine: THREE.Bone;
  chest: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  arms: { L: ArmRig; R: ArmRig };
  legs: { L: LegRig; R: LegRig };
  eyes: THREE.Object3D[];
  slots: Record<SlotName, THREE.Group>;
}

/**
 * Rest-pose measurements (world units, character is ~1.6 tall). Bone offsets are
 * relative to the parent bone. The Body's IK uses these, so change them here only.
 */
export const DIMS = {
  /** Pelvis height above the ground. */
  hipY: 0.45,
  spineY: 0.18,
  chestY: 0.22,
  neckY: 0.16,
  headY: 0.02,
  shoulderX: 0.24,
  shoulderY: 0.03,
  upperArm: 0.15,
  foreArm: 0.15,
  legX: 0.11,
  legY: 0.02,
  thigh: 0.205,
  shin: 0.205,
  /** Ankle height when the foot is flat on the ground (hipY + legY - thigh - shin). */
  ankleY: 0.06,
};

/**
 * The little figurine. Built from primitives so it needs no model files yet, but the
 * torso, arms and legs are skinned meshes on a real skeleton, so they bend smoothly at
 * the waist, elbows and knees instead of hinging like toy parts. A rigged GLTF can
 * replace this later as long as it exposes the same bones.
 *
 * Coordinates: feet at y=0, facing +z (toward the camera).
 */
export class LilGuy {
  readonly rig: Rig;
  private materials: Record<keyof LilGuyColors, THREE.MeshToonMaterial>;
  private equipped: Partial<Record<SlotName, THREE.Object3D>> = {};

  constructor(colors: Partial<LilGuyColors> = {}) {
    const c = { ...DEFAULT_COLORS, ...colors };
    const gradient = toonGradient();
    const mat = (color: string) => new THREE.MeshToonMaterial({ color, gradientMap: gradient });
    this.materials = {
      skin: mat(c.skin),
      shirt: mat(c.shirt),
      pants: mat(c.pants),
      shoes: mat(c.shoes),
    };
    const dark = new THREE.MeshBasicMaterial({ color: '#1e1e24' });
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const blush = new THREE.MeshBasicMaterial({ color: '#ff8fa3', transparent: true, opacity: 0.55 });

    const root = new THREE.Group();
    root.name = 'LilGuy';

    // --- Skeleton -----------------------------------------------------------
    const bone = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0) => {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(x, y, z);
      parent.add(b);
      return b;
    };
    const pelvis = bone('pelvis', root, 0, DIMS.hipY);
    const spine = bone('spine', pelvis, 0, DIMS.spineY);
    const chest = bone('chest', spine, 0, DIMS.chestY);
    const neck = bone('neck', chest, 0, DIMS.neckY);
    const head = bone('head', neck, 0, DIMS.headY);

    const makeArm = (side: 1 | -1, s: string): ArmRig => {
      const upper = bone(`upperArm${s}`, chest, DIMS.shoulderX * side, DIMS.shoulderY);
      const fore = bone(`foreArm${s}`, upper, 0, -DIMS.upperArm);
      const hand = bone(`hand${s}`, fore, 0, -DIMS.foreArm);
      return { upper, fore, hand };
    };
    const makeLeg = (side: 1 | -1, s: string): LegRig => {
      const thigh = bone(`thigh${s}`, pelvis, DIMS.legX * side, DIMS.legY);
      const shin = bone(`shin${s}`, thigh, 0, -DIMS.thigh);
      const foot = bone(`foot${s}`, shin, 0, -DIMS.shin);
      return { thigh, shin, foot };
    };
    const arms = { L: makeArm(1, 'L'), R: makeArm(-1, 'R') };
    const legs = { L: makeLeg(1, 'L'), R: makeLeg(-1, 'R') };

    const bones: THREE.Bone[] = [];
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
    });
    root.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    const idx = (b: THREE.Bone) => bones.indexOf(b);

    /**
     * A skinned mesh whose geometry is authored in `frame`'s local space. `chain` lists
     * bones from lowest to highest along local y, with the y of each joint between them.
     */
    const skinned = (
      geo: THREE.BufferGeometry,
      material: THREE.Material,
      frame: THREE.Bone,
      chain: THREE.Bone[],
      joints: { y: number; blend: number }[],
    ) => {
      const pos = geo.getAttribute('position');
      const skinIndex: number[] = [];
      const skinWeight: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        const w = chainWeights(pos.getY(i), joints);
        // keep the two strongest influences
        const order = w.map((v, k) => [v, k]).sort((a, b) => b[0] - a[0]);
        skinIndex.push(idx(chain[order[0][1]]), order[1] ? idx(chain[order[1][1]]) : 0, 0, 0);
        skinWeight.push(order[0][0], order[1] ? order[1][0] : 0, 0, 0);
      }
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      geo.applyMatrix4(frame.matrixWorld); // into root space (root is at identity right now)

      const m = new THREE.SkinnedMesh(geo, material);
      m.castShadow = true;
      m.frustumCulled = false; // bounds move with the bones
      root.add(m);
      m.bind(skeleton, new THREE.Matrix4());
      return m;
    };

    // --- Torso: one bean bending through pelvis → spine → chest -------------
    const torsoJoints = [
      { y: DIMS.spineY, blend: 0.07 },
      { y: DIMS.spineY + DIMS.chestY, blend: 0.08 },
    ];
    skinned(capsuleGeo(0.22, -0.07 + 0.22, 0.57 - 0.22, 18), this.materials.shirt, pelvis, [pelvis, spine, chest], torsoJoints);
    skinned(tubeGeo(0.2, 0.228, -0.06, 0.12, 6), this.materials.pants, pelvis, [pelvis, spine, chest], torsoJoints);

    // --- Arms: sleeve bends at the elbow, hand rides the hand bone ------------
    for (const [side, arm] of [[1, arms.L], [-1, arms.R]] as const) {
      void side;
      skinned(capsuleGeo(0.06, -0.27, -0.01, 14), this.materials.shirt, arm.upper, [arm.fore, arm.upper], [
        { y: -DIMS.upperArm, blend: 0.05 },
      ]);
      // Mitten-shaped (longer than wide) so wrist bends actually show.
      const hand = mesh(new THREE.SphereGeometry(0.075, 16, 12), this.materials.skin);
      hand.scale.set(0.92, 1.22, 0.85);
      hand.position.y = -0.04;
      arm.hand.add(hand);
    }

    // --- Legs: bend at the knee, shoe rides the foot bone ---------------------
    for (const leg of [legs.L, legs.R]) {
      skinned(capsuleGeo(0.075, -0.37, -0.02, 16), this.materials.pants, leg.thigh, [leg.shin, leg.thigh], [
        { y: -DIMS.thigh, blend: 0.06 },
      ]);
      const shoe = mesh(new THREE.SphereGeometry(0.1, 16, 12), this.materials.shoes);
      shoe.scale.set(1, 0.6, 1.4);
      shoe.position.set(0, 0, 0.04);
      leg.foot.add(shoe);
    }

    // --- Head (rigid) ---------------------------------------------------------
    const skull = mesh(new THREE.SphereGeometry(0.32, 32, 24), this.materials.skin);
    skull.position.y = 0.28;
    head.add(skull);

    const eyes: THREE.Object3D[] = [];
    for (const side of [1, -1]) {
      const eye = new THREE.Group();
      eye.position.set(0.11 * side, 0.3, 0.29);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), dark);
      pupil.scale.set(1, 1.25, 0.5);
      const shine = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), white);
      shine.position.set(0.015, 0.02, 0.022);
      eye.add(pupil, shine);
      head.add(eye);
      eyes.push(eye);

      const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), blush);
      cheek.position.set(0.19 * side, 0.21, 0.255);
      cheek.lookAt(cheek.position.clone().multiplyScalar(2).setY(0.21));
      head.add(cheek);
    }
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 8, 16, Math.PI), dark);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, 0.2, 0.305);
    head.add(mouth);

    // --- Accessory slots ------------------------------------------------------
    const slot = (parent: THREE.Object3D, name: SlotName, pos: [number, number, number]) => {
      const g = new THREE.Group();
      g.name = `slot:${name}`;
      g.position.set(...pos);
      parent.add(g);
      return g;
    };
    const slots = {
      head: slot(head, 'head', [0, 0.6, 0]),
      face: slot(head, 'face', [0, 0.3, 0.32]),
      back: slot(chest, 'back', [0, -0.1, -0.22]),
      leftHand: slot(arms.L.hand, 'leftHand', [0, -0.04, 0]),
      rightHand: slot(arms.R.hand, 'rightHand', [0, -0.04, 0]),
    };

    this.rig = { root, pelvis, spine, chest, neck, head, arms, legs, eyes, slots };
  }

  get object(): THREE.Object3D {
    return this.rig.root;
  }

  setColors(colors: Partial<LilGuyColors>): void {
    for (const [key, value] of Object.entries(colors) as [keyof LilGuyColors, string][]) {
      this.materials[key]?.color.set(value);
    }
  }

  /** Attach an accessory to a slot, replacing whatever was there. */
  equip(slot: SlotName, item: THREE.Object3D): void {
    this.unequip(slot);
    this.rig.slots[slot].add(item);
    this.equipped[slot] = item;
  }

  unequip(slot: SlotName): void {
    const current = this.equipped[slot];
    if (current) this.rig.slots[slot].remove(current);
    delete this.equipped[slot];
  }
}

/**
 * Skin weights along a chain: joints (sorted by y) split it into segments, and each
 * vertex belongs to the segment it's in, blended smoothly within `blend` of a joint.
 * Returns one weight per segment (chain bone), summing to 1.
 */
export function chainWeights(y: number, joints: { y: number; blend: number }[]): number[] {
  // s[k] = how far "above" joint k this vertex is (0..1)
  const s = joints.map((j) => smoothstep((y - (j.y - j.blend)) / (2 * j.blend)));
  const w: number[] = [];
  for (let k = 0; k <= joints.length; k++) {
    const below = k === 0 ? 1 : s[k - 1];
    const above = k === joints.length ? 0 : s[k];
    w.push(Math.max(0, below - above));
  }
  return w;
}

/** A capsule along y (cap centers at `bottom` and `top`) with enough rows to bend smoothly. */
function capsuleGeo(radius: number, bottom: number, top: number, rows: number, radial = 16): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const cap = 6;
  for (let i = 0; i <= cap; i++) {
    const a = -Math.PI / 2 + (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(radius * Math.cos(a), bottom + radius * Math.sin(a)));
  }
  for (let i = 1; i < rows; i++) pts.push(new THREE.Vector2(radius, bottom + ((top - bottom) * i) / rows));
  for (let i = 0; i <= cap; i++) {
    const a = (i / cap) * (Math.PI / 2);
    pts.push(new THREE.Vector2(Math.max(0, radius * Math.cos(a)), top + radius * Math.sin(a)));
  }
  return new THREE.LatheGeometry(pts, radial);
}

/** A tapered tube with a closed bottom, for the pants. */
function tubeGeo(rBottom: number, rTop: number, bottom: number, top: number, rows: number): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0, bottom)];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    pts.push(new THREE.Vector2(rBottom + (rTop - rBottom) * t, bottom + (top - bottom) * t));
  }
  pts.push(new THREE.Vector2(0, top));
  return new THREE.LatheGeometry(pts, 20);
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  return m;
}

function smoothstep(x: number): number {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

function toonGradient(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
