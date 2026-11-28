import * as THREE from 'three';
import { DIMS, type Rig } from '../character/LilGuy';
import { radialTexture } from '../render/toon';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Soft dark blobs on the surface right under his feet and body. The real (sun) shadow
 * falls off to the side; these sit directly underneath and are what make him look
 * planted on his prop. A foot's blob shrinks and fades as it lifts, so hops and kicks
 * read clearly.
 */
export class ContactShadow {
  readonly object = new THREE.Group();
  private feet: THREE.Mesh[] = [];
  private body: THREE.Mesh;
  private v = new THREE.Vector3();

  constructor() {
    const texture = radialTexture([[0, 1], [0.35, 0.75], [1, 0]]);
    const blob = (w: number, d: number, strength: number) => {
      const material = new THREE.MeshBasicMaterial({
        color: '#1c1530',
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: strength,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
      m.rotation.x = -Math.PI / 2;
      m.userData.strength = strength;
      this.object.add(m);
      return m;
    };
    this.feet = [blob(0.26, 0.34, 0.5), blob(0.26, 0.34, 0.5)];
    this.body = blob(0.62, 0.5, 0.22);
  }

  /**
   * `surfaceY`: height of what he stands on; `frontEdge`: z where that surface ends
   * (blobs fade out past it instead of hanging in the air).
   */
  update(rig: Rig, surfaceY: number, frontEdge: number): void {
    const y = surfaceY + 0.003;
    const edgeFade = (z: number, r: number) => 1 - smooth(frontEdge - r, frontEdge + 0.02, z);

    const legs = [rig.legs.L, rig.legs.R];
    legs.forEach((leg, i) => {
      const blob = this.feet[i];
      const p = leg.foot.getWorldPosition(this.v);
      const lift = p.y - (surfaceY + DIMS.ankleY);
      // Below the surface means his legs hang over the edge: nothing to shade.
      const on = lift < -0.02 ? 0 : 1 - smooth(0, 0.3, lift);
      const mat = blob.material as THREE.MeshBasicMaterial;
      mat.opacity = blob.userData.strength * on * edgeFade(p.z + 0.04, 0.08);
      blob.scale.setScalar(1 + Math.max(0, lift) * 1.6);
      blob.position.set(p.x, y + 0.0005 * i, p.z + 0.04);
    });

    const hips = rig.pelvis.getWorldPosition(this.v);
    const height = Math.max(0, hips.y - surfaceY);
    const mat = this.body.material as THREE.MeshBasicMaterial;
    mat.opacity = this.body.userData.strength * (1 - smooth(0.6, 1.2, height)) * edgeFade(hips.z, 0.2);
    this.body.position.set(hips.x, y - 0.0005, Math.min(hips.z, frontEdge - 0.08));
    this.body.scale.setScalar(0.85 + 0.15 * smooth(0.6, 0.3, height));
  }
}
