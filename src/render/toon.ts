import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The game's look: cel shading with colored (not grey) shadows, an anime-style rim light,
 * and ink outlines. Everything that should look "drawn" (the guy, props, accessories)
 * uses `toonMaterial` and gets `addOutlines`.
 *
 * Nothing here is a post-process: the desktop window is transparent, and screen-space
 * effects (bloom, edge detection) can't draw outside of the opaque pixels there.
 */

// ---------------------------------------------------------------------------
// Shading
// ---------------------------------------------------------------------------

/** Global look settings shared by every toon material (live: change them any time). */
export const LOOK = {
  /** Rim light: color, which way it comes from (view space), strength. */
  rimColor: { value: new THREE.Color('#fff4e8') },
  rimDir: { value: new THREE.Vector3(0.55, 0.65, -0.1).normalize() },
  rimStrength: { value: 0.45 },
  /** Where the light→shadow terminator falls on the ramp (0..1), and the half-tone band. */
  ramp: { value: new THREE.Vector2(0.36, 0.5) },
};

export interface ToonOptions {
  /** Multiplier for the deepest shadow band; tinted so shadows stay colorful. */
  shadow?: string;
  /** Multiplier for the half-tone band between shadow and light. */
  mid?: string;
  /** Rim light amount for this material (0 = none). */
  rim?: number;
}

const SHADOW = '#8a7fc4';
const MID = '#cfc8ef';
/** Skin: warm shadows read as soft and alive instead of muddy. */
export const SKIN_TONE: ToonOptions = { shadow: '#d9939c', mid: '#f6d6d0' };

// Three-band ramp with anti-aliased band edges (fwidth), returning a colored multiplier.
const RAMP_GLSL = /* glsl */ `
uniform vec3 toonShadow;
uniform vec3 toonMid;
uniform vec2 toonRamp;
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
  float d = dot( normal, lightDirection ) * 0.5 + 0.5;
  float fw = max( fwidth( d ), 1e-4 ) * 0.75;
  float a = smoothstep( toonRamp.x - fw, toonRamp.x + fw, d );
  float b = smoothstep( toonRamp.y - fw, toonRamp.y + fw, d );
  return mix( mix( toonShadow, toonMid, a ), vec3( 1.0 ), b );
}
`;

// Stepped rim on the silhouette, only on the side the rim light comes from.
const RIM_GLSL = /* glsl */ `
{
  vec3 viewDir = normalize( vViewPosition );
  float fres = 1.0 - saturate( dot( normal, viewDir ) );
  float fw = max( fwidth( fres ), 1e-4 );
  float edge = smoothstep( 0.58 - fw, 0.58 + fw, fres );
  float facing = smoothstep( 0.0, 0.35, dot( normal, rimDir ) );
  vec3 tint = mix( rimColor, rimColor * diffuseColor.rgb * 1.6, 0.35 );
  outgoingLight += tint * edge * facing * rimStrength * toonRim;
}
`;

/** A cel-shaded material. Share these freely; colors can be changed later via `.color`. */
export function toonMaterial(color: THREE.ColorRepresentation, opts: ToonOptions = {}): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({ color });
  const own = {
    toonShadow: { value: new THREE.Color(opts.shadow ?? SHADOW) },
    toonMid: { value: new THREE.Color(opts.mid ?? MID) },
    toonRim: { value: opts.rim ?? 1 },
  };
  material.userData.toon = own;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, own, {
      toonRamp: LOOK.ramp,
      rimColor: LOOK.rimColor,
      rimDir: LOOK.rimDir,
      rimStrength: LOOK.rimStrength,
    });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <gradientmap_pars_fragment>', RAMP_GLSL)
      .replace(
        'void main() {',
        'uniform vec3 rimColor;\nuniform vec3 rimDir;\nuniform float rimStrength;\nuniform float toonRim;\nvoid main() {',
      )
      .replace('#include <opaque_fragment>', `${RIM_GLSL}\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'lmg-toon';
  return material;
}

// ---------------------------------------------------------------------------
// Outlines (inverted hull, extruded in screen space so the line weight is constant)
// ---------------------------------------------------------------------------

const OUTLINE = {
  /** Line width in device pixels. */
  width: { value: 3 },
  resolution: { value: new THREE.Vector2(1000, 1000) },
};
/** Dark, slightly purple ink the outline color is mixed toward. */
const INK = new THREE.Color('#1c1530');

/** Call on resize: outline width is `cssPx` CSS pixels at any size and pixel ratio. */
export function setOutlineViewport(renderer: THREE.WebGLRenderer, cssPx = 1.6): void {
  renderer.getDrawingBufferSize(OUTLINE.resolution.value);
  OUTLINE.width.value = cssPx * renderer.getPixelRatio();
}

const OUTLINE_VERT = /* glsl */ `
uniform float outlineWidth;
uniform vec2 resolution;
#include <common>
#include <skinning_pars_vertex>
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 clip = projectionMatrix * modelViewMatrix * vec4( transformed, 1.0 );
  vec3 n = normalize( normalMatrix * objectNormal );
  vec2 dir = ( projectionMatrix * vec4( n, 0.0 ) ).xy;
  float len = length( dir );
  dir = len > 1e-5 ? dir / len : vec2( 0.0 );
  clip.xy += dir * outlineWidth * clip.w * 2.0 / resolution;
  gl_Position = clip;
}
`;

const OUTLINE_FRAG = /* glsl */ `
uniform vec3 color;
void main() {
  gl_FragColor = vec4( color, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Ink color for a surface: a much darker, slightly ink-tinted version of it. */
export function inkFor(base: THREE.Color, out = new THREE.Color()): THREE.Color {
  return out.copy(base).multiplyScalar(0.3).lerp(INK, 0.45);
}

const outlineGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Hull geometry with smooth normals everywhere (so hard-edged shapes like boxes get an
 * unbroken line instead of gaps at the corners). Cached per source geometry.
 */
function hullGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  let hull = outlineGeometries.get(source);
  if (!hull) {
    const g = source.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
    }
    hull = mergeVertices(g, 1e-4);
    hull.computeVertexNormals();
    outlineGeometries.set(source, hull);
  }
  return hull;
}

function isFlat(geometry: THREE.BufferGeometry): boolean {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new THREE.Vector3());
  return Math.min(size.x, size.y, size.z) < 1e-4;
}

/**
 * Give every toon-shaded mesh under `root` an ink outline. Meshes with other materials
 * (face details, glows), flat shapes and anything marked `userData.noOutline` are skipped.
 * Safe to call again on the same tree.
 */
export function addOutlines(root: THREE.Object3D, widthScale = 1): void {
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.outline || mesh.userData.isOutline || mesh.userData.noOutline) return;
    if (!(mesh.material as THREE.MeshToonMaterial).isMeshToonMaterial) return;
    if (isFlat(mesh.geometry)) return;
    targets.push(mesh);
  });

  for (const mesh of targets) {
    const source = mesh.material as THREE.MeshToonMaterial;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: inkFor(source.color) },
        outlineWidth: widthScale === 1 ? OUTLINE.width : { value: OUTLINE.width.value * widthScale },
        resolution: OUTLINE.resolution,
      },
      vertexShader: OUTLINE_VERT,
      fragmentShader: OUTLINE_FRAG,
      side: THREE.BackSide,
    });
    const geometry = hullGeometry(mesh.geometry);
    let hull: THREE.Mesh;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      const skinned = mesh as THREE.SkinnedMesh;
      const s = new THREE.SkinnedMesh(geometry, material);
      s.bind(skinned.skeleton, skinned.bindMatrix);
      s.frustumCulled = false;
      hull = s;
      // A skinned hull lives beside its mesh (same space), not under it.
      hull.position.copy(mesh.position);
      hull.quaternion.copy(mesh.quaternion);
      hull.scale.copy(mesh.scale);
      mesh.parent!.add(hull);
    } else {
      hull = new THREE.Mesh(geometry, material);
      mesh.add(hull);
    }
    hull.userData.isOutline = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.renderOrder = mesh.renderOrder;
    // Follow recolors (customization, shop items) automatically.
    hull.onBeforeRender = () => {
      inkFor(source.color, material.uniforms.color.value);
      if (widthScale !== 1) material.uniforms.outlineWidth.value = OUTLINE.width.value * widthScale;
      hull.visible = mesh.visible;
    };
    mesh.userData.outline = hull;
  }
}

/** Remove the outline hulls (and their materials) created for meshes under `root`. */
export function removeOutlines(root: THREE.Object3D): void {
  root.traverse((o) => {
    const hull = o.userData.outline as THREE.Mesh | undefined;
    if (!hull) return;
    hull.removeFromParent();
    (hull.material as THREE.Material).dispose();
    delete o.userData.outline;
  });
}

// ---------------------------------------------------------------------------
// Soft textures (blush, glows, contact shadows)
// ---------------------------------------------------------------------------

/** Piecewise-linear lookup through sorted [position, value] stops. */
function sample<T>(stops: [number, T][], x: number, lerp: (a: T, b: T, t: number) => T): T {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [p1, v1] = stops[i];
    if (x <= p1) {
      const [p0, v0] = stops[i - 1];
      return lerp(v0, v1, (x - p0) / Math.max(1e-6, p1 - p0));
    }
  }
  return stops[stops.length - 1][1];
}

function dataTexture(data: Uint8Array<ArrayBuffer>, w: number, h: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A radial gradient texture: `stops` are [radius 0..1, alpha 0..1] pairs, white so the
 * material color tints it. (Computed, not drawn on a canvas, so it also works headless.)
 */
export function radialTexture(stops: [number, number][], size = 128): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const a = sample(stops, r, (p, q, t) => p + (q - p) * t);
      data.set([255, 255, 255, Math.round(255 * a)], (y * size + x) * 4);
    }
  }
  return dataTexture(data, size, size);
}

/** A vertical gradient texture: stop 0 is the top of the UV range, 1 the bottom. */
export function verticalTexture(stops: [number, string][], height = 128): THREE.DataTexture {
  const rgb = stops.map(([t, hex]) => [t, [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16))] as [number, number[]]);
  const data = new Uint8Array(height * 4);
  for (let row = 0; row < height; row++) {
    const t = 1 - (row + 0.5) / height; // row 0 is the bottom of the texture
    const c = sample(rgb, t, (a, b, u) => a.map((v, k) => v + (b[k] - v) * u));
    data.set([...c.map(Math.round), 255], row * 4);
  }
  return dataTexture(data, 1, height);
}
