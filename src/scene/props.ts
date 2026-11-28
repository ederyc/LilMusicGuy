import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { AudioFeatures } from '../audio/types';
import { addOutlines, radialTexture, toonMaterial } from '../render/toon';

/**
 * His home base: the thing he stands on, sits on the edge of, and naps on. It's what
 * grounds him on the desktop, so he's never just floating. Props are swappable (and
 * eventually shop items), like accessories.
 *
 * Coordinates: origin on the floor at the prop's center, front facing +z.
 */
export interface Prop {
  id: string;
  name: string;
  object: THREE.Object3D;
  /** Height of the surface he stands on. */
  top: number;
  /** z of the front edge of that surface; he sits here with his legs over the front. */
  frontEdge: number;
  /** Rough size, for framing the camera. */
  width: number;
  /** Per-frame animation (e.g. a woofer pumping to the bass). */
  update(f: AudioFeatures, dt: number): void;
}

export interface PropDef {
  id: string;
  name: string;
  build(): Prop;
}

const toon = (color: string) => toonMaterial(color);

/** Shadows on, then ink outlines (outlines never cast shadows). */
function finish<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  addOutlines(o);
  return o;
}

/** A chunky floor speaker. The woofer pumps and the ring lights up with the music. */
function speaker(): Prop {
  const W = 0.8;
  const H = 0.75;
  const D = 0.6;
  const group = new THREE.Group();

  const cabinet = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.06), toon('#57546a'));
  cabinet.position.y = H / 2;
  group.add(cabinet);

  const front = D / 2 + 0.001;
  const face = (y: number, r: number, color: string, z = 0) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), toon(color));
    m.position.set(0, y, front + z);
    group.add(m);
    return m;
  };
  // Woofer: a surround, a cone that pumps, and a dust cap.
  face(0.3, 0.25, '#2f2d3a');
  const ringMat = new THREE.MeshBasicMaterial({ color: '#6c5ce7' });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.235, 0.252, 48), ringMat);
  ring.position.set(0, 0.3, front + 0.002);
  group.add(ring);
  // Soft light spill around the ring (a real glow; post-process bloom can't draw on the
  // transparent desktop window).
  const haloMat = new THREE.MeshBasicMaterial({
    color: '#8b7bff',
    map: radialTexture([[0, 0], [0.6, 0], [0.76, 0.9], [0.84, 0.35], [1, 0]]),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.66), haloMat);
  halo.position.set(0, 0.3, front + 0.004);
  halo.renderOrder = 1;
  group.add(halo);
  const cone = new THREE.Group();
  cone.position.set(0, 0.3, front);
  const coneMesh = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.06, 40, 1, true), toon('#22212b'));
  coneMesh.userData.noOutline = true; // open shapes: an outline hull would show through
  coneMesh.rotation.x = -Math.PI / 2;
  coneMesh.position.z = 0.0;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon('#6b6880'));
  cap.rotation.x = Math.PI / 2;
  cap.userData.noOutline = true;
  cap.position.z = 0.005;
  cone.add(coneMesh, cap);
  group.add(cone);
  // Tweeter.
  face(0.61, 0.075, '#2f2d3a');
  face(0.61, 0.04, '#1b1a21', 0.002);
  // Little feet so it sits on the surface.
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.03, 12), toon('#2a2833'));
      foot.position.set(x * (W / 2 - 0.08), 0.0, z * (D / 2 - 0.08));
      group.add(foot);
    }
  }
  group.position.y = 0.015; // stand on the feet

  const glow = new THREE.Color('#6c5ce7');
  const dim = new THREE.Color('#4a4370');
  let pump = 0;
  let light = 0;
  return {
    id: 'speaker',
    name: 'Speaker',
    object: finish(group),
    top: H + 0.015,
    frontEdge: D / 2,
    width: W,
    update(f, dt) {
      if (f.isBeat) {
        pump = Math.max(pump, 0.6 + 0.4 * f.beatStrength);
        light = 1;
      }
      pump *= Math.exp(-dt * 14);
      light *= Math.exp(-dt * 5);
      cone.position.z = front + 0.035 * (pump + 0.4 * f.bass);
      cone.scale.setScalar(1 + 0.04 * pump);
      const lit = Math.min(1, light + 0.3 * f.energy);
      ringMat.color.copy(dim).lerp(glow, lit);
      haloMat.opacity = 0.15 + 0.85 * lit;
      halo.scale.setScalar(1 + 0.06 * light);
    },
  };
}

/** An upturned record crate (a stool, basically), with a couple of records leaning on its side. */
function crate(): Prop {
  const W = 0.7;
  const H = 0.46;
  const D = 0.5;
  const group = new THREE.Group();
  const wood = toon('#c98a4b');
  const woodDark = toon('#8a5a2e');

  const top = new THREE.Mesh(new RoundedBoxGeometry(W, 0.05, D, 2, 0.015), wood);
  top.position.y = H - 0.025;
  group.add(top);
  // Slatted sides: two slats per side with a gap you can see into.
  const slat = (w: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new RoundedBoxGeometry(w, 0.12, d, 2, 0.012), wood);
    m.position.set(x, y, z);
    group.add(m);
  };
  for (const y of [0.08, 0.27]) {
    slat(W, 0.03, 0, y, D / 2 - 0.015);
    slat(W, 0.03, 0, y, -D / 2 + 0.015);
    slat(0.03, D, W / 2 - 0.015, y, 0);
    slat(0.03, D, -W / 2 + 0.015, y, 0);
  }
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, H - 0.04, 0.05), woodDark);
      post.position.set(x * (W / 2 - 0.025), (H - 0.04) / 2, z * (D / 2 - 0.025));
      group.add(post);
    }
  }
  // Records leaning against its side (his right, your left).
  const record = (labelColor: string, tilt: number, z: number) => {
    const g = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 40), toon('#141317'));
    const label = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.014, 24), toon(labelColor));
    g.add(disc, label);
    g.rotation.z = Math.PI / 2 - tilt;
    g.position.set(-W / 2 - 0.06 - 0.2 * Math.sin(tilt) * 0.3, 0.2, z);
    group.add(g);
  };
  record('#ff7675', 0.28, 0.05);
  record('#fdcb6e', 0.18, -0.06);

  return {
    id: 'crate',
    name: 'Record Crate',
    object: finish(group),
    top: H,
    frontEdge: D / 2,
    width: W + 0.3,
    update() {},
  };
}

/** No prop: he stands on whatever the bottom of his space is. */
function floor(): Prop {
  return { id: 'none', name: 'None', object: new THREE.Group(), top: 0, frontEdge: 0.25, width: 0.6, update() {} };
}

export const PROPS: PropDef[] = [
  { id: 'speaker', name: 'Speaker', build: speaker },
  { id: 'crate', name: 'Record Crate', build: crate },
  { id: 'none', name: 'None', build: floor },
];
