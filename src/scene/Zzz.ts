import * as THREE from 'three';

const LIFETIME = 3.2;
const EVERY = 1.1;

/** Little "z"s that drift up from his head while he naps. */
export class Zzz {
  readonly object = new THREE.Group();
  private sprites: { sprite: THREE.Sprite; age: number }[] = [];
  private material: THREE.SpriteMaterial;
  private timer = 0;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 52px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(40, 36, 70, 0.9)';
    ctx.strokeText('z', 32, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('z', 32, 34);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  }

  /** `from`: world position to emit from (top of his head); `amount`: 0..1 how asleep he is. */
  update(from: THREE.Vector3, amount: number, dt: number): void {
    this.timer += dt;
    if (amount > 0.6 && this.timer > EVERY) {
      this.timer = 0;
      const sprite = new THREE.Sprite(this.material.clone());
      sprite.position.copy(from);
      this.object.add(sprite);
      this.sprites.push({ sprite, age: 0 });
    }
    for (const z of this.sprites) {
      z.age += dt;
      const u = z.age / LIFETIME;
      z.sprite.position.x += dt * (0.12 + 0.05 * Math.sin(z.age * 3));
      z.sprite.position.y += dt * 0.22;
      z.sprite.scale.setScalar(0.08 + 0.14 * u);
      z.sprite.material.opacity = Math.min(1, u * 5) * (1 - u) * Math.min(1, amount * 1.5);
    }
    for (const z of this.sprites.filter((s) => s.age >= LIFETIME)) {
      this.object.remove(z.sprite);
      z.sprite.material.dispose();
    }
    this.sprites = this.sprites.filter((s) => s.age < LIFETIME);
  }
}
