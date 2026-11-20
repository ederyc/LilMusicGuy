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

/** The joints the Dancer drives. */
export interface Rig {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  eyes: THREE.Object3D[];
}

/**
 * The little figurine, built from primitives so it needs no model files yet.
 * Swap any part for a GLTF later as long as the Rig joints stay the same.
 *
 * Coordinates: feet at y=0, facing +z (toward the camera). "Left" means the
 * character's left, which is +x.
 */
export class LilGuy {
  readonly rig: Rig;
  private materials: Record<keyof LilGuyColors, THREE.MeshToonMaterial>;
  private slots: Record<SlotName, THREE.Group>;
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

    // Hips sit at y=0.45; legs hang below.
    const hips = new THREE.Group();
    hips.position.y = 0.45;
    root.add(hips);

    const makeLeg = (side: 1 | -1) => {
      const leg = new THREE.Group();
      leg.position.set(0.11 * side, 0.02, 0);
      const limb = mesh(new THREE.CapsuleGeometry(0.075, 0.22, 6, 12), this.materials.pants);
      limb.position.y = -0.2;
      const shoe = mesh(new THREE.SphereGeometry(0.1, 16, 12), this.materials.shoes);
      shoe.scale.set(1, 0.6, 1.4);
      shoe.position.set(0, -0.41, 0.04);
      leg.add(limb, shoe);
      hips.add(leg);
      return leg;
    };
    const legL = makeLeg(1);
    const legR = makeLeg(-1);

    const torso = new THREE.Group();
    hips.add(torso);
    const body = mesh(new THREE.CapsuleGeometry(0.22, 0.2, 8, 20), this.materials.shirt);
    body.position.y = 0.25;
    const pants = mesh(new THREE.CylinderGeometry(0.228, 0.2, 0.18, 20), this.materials.pants);
    pants.position.y = 0.03;
    torso.add(body, pants);

    const makeArm = (side: 1 | -1) => {
      const arm = new THREE.Group();
      arm.position.set(0.24 * side, 0.43, 0);
      const limb = mesh(new THREE.CapsuleGeometry(0.06, 0.2, 6, 12), this.materials.shirt);
      limb.position.y = -0.15;
      const hand = mesh(new THREE.SphereGeometry(0.075, 14, 10), this.materials.skin);
      hand.position.y = -0.31;
      arm.add(limb, hand);
      torso.add(arm);
      return arm;
    };
    const armL = makeArm(1);
    const armR = makeArm(-1);

    const head = new THREE.Group();
    head.position.y = 0.58;
    torso.add(head);
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

    // Accessory slots.
    const slot = (parent: THREE.Object3D, name: SlotName, pos: [number, number, number]) => {
      const g = new THREE.Group();
      g.name = `slot:${name}`;
      g.position.set(...pos);
      parent.add(g);
      return g;
    };
    this.slots = {
      head: slot(head, 'head', [0, 0.6, 0]),
      face: slot(head, 'face', [0, 0.3, 0.32]),
      back: slot(torso, 'back', [0, 0.3, -0.22]),
      leftHand: slot(armL, 'leftHand', [0, -0.34, 0]),
      rightHand: slot(armR, 'rightHand', [0, -0.34, 0]),
    };

    this.rig = { root, torso, head, armL, armR, legL, legR, eyes };
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
    this.slots[slot].add(item);
    this.equipped[slot] = item;
  }

  unequip(slot: SlotName): void {
    const current = this.equipped[slot];
    if (current) this.slots[slot].remove(current);
    delete this.equipped[slot];
  }
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = true;
  return m;
}

function toonGradient(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
