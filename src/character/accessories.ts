import * as THREE from 'three';
import { toonMaterial } from '../render/toon';
import type { SlotName } from './LilGuy';

/**
 * Placeholder accessory catalog. Eventually these come from the shop
 * (likely GLTF models + metadata); for now they're built in code to prove the
 * slot system works.
 */
export interface AccessoryDef {
  id: string;
  name: string;
  slot: SlotName;
  build: () => THREE.Object3D;
}

const toon = (color: string) => toonMaterial(color);

export const ACCESSORIES: AccessoryDef[] = [
  {
    id: 'headphones',
    name: 'Headphones',
    slot: 'head',
    build: () => {
      const g = new THREE.Group();
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.03, 10, 32, Math.PI), toon('#2d3436'));
      band.position.y = -0.32;
      g.add(band);
      for (const side of [1, -1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 20), toon('#ff7675'));
        cup.rotation.z = Math.PI / 2;
        cup.position.set(0.32 * side, -0.32, 0);
        g.add(cup);
      }
      return g;
    },
  },
  {
    id: 'party-hat',
    name: 'Party Hat',
    slot: 'head',
    build: () => {
      const g = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 20), toon('#fdcb6e'));
      cone.position.y = 0.1;
      const pom = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), toon('#e84393'));
      pom.position.y = 0.27;
      g.add(cone, pom);
      g.position.y = -0.04;
      g.rotation.z = -0.2;
      return g;
    },
  },
  {
    id: 'shades',
    name: 'Shades',
    slot: 'face',
    build: () => {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#111' });
      for (const side of [1, -1]) {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.02), mat);
        lens.position.set(0.11 * side, 0, -0.01);
        lens.rotation.y = 0.25 * side;
        g.add(lens);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.015), mat);
      bridge.position.z = 0.01;
      g.add(bridge);
      return g;
    },
  },
];
