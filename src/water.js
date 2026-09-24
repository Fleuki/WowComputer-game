import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export const WATER_Y = 0.2;

// Rippling, reflective water for the flooded nave. In high quality it uses a
// real planar reflection; otherwise a glossy tinted surface lit by the env map.

const WaterShader = {
  name: 'DrownedWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uTint: { value: new THREE.Color(0x12343c) },
    uDeep: { value: new THREE.Color(0x06161b) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uTint;
    uniform vec3 uDeep;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vWorld.xz;
      vec2 r = vec2(noise(p * 0.35 + vec2(uTime * 0.25, 0.0)), noise(p * 0.35 + vec2(3.0, -uTime * 0.22))) - 0.5;
      r += (vec2(noise(p * 1.4 - uTime * 0.5), noise(p * 1.3 + uTime * 0.45)) - 0.5) * 0.35;
      vec4 uv = vUv;
      uv.xy += r * 0.022 * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;
      vec3 V = normalize(cameraPosition - vWorld);
      float fres = 0.3 + 0.7 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
      float glint = pow(max(0.0, r.x + r.y), 4.0) * 0.35;
      vec3 col = mix(mix(uDeep, uTint, 0.5 + r.x), refl, 0.35 + 0.5 * fres) + glint * vec3(0.7, 0.9, 1.0);
      gl_FragColor = vec4(col, 0.72 + 0.23 * fres);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
};

export function buildWater(root, high) {
  const geo = new THREE.CircleGeometry(34, 96);
  let mesh, uniforms;
  if (high) {
    mesh = new Reflector(geo, {
      shader: WaterShader,
      textureWidth: Math.min(1024, window.innerWidth * 0.5),
      textureHeight: Math.min(1024, window.innerHeight * 0.5),
      clipBias: 0.01,
    });
    mesh.material.transparent = true;
    uniforms = mesh.material.uniforms;
  } else {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d2a31, roughness: 0.04, metalness: 0.3, transparent: true, opacity: 0.86, envMapIntensity: 2.2,
    });
    mesh = new THREE.Mesh(geo, mat);
    uniforms = { uTime: { value: 0 }, uTint: { value: mat.color } };
  }
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = WATER_Y;
  mesh.renderOrder = 2;
  root.add(mesh);

  const calm = new THREE.Color(0x12343c);
  const blood = new THREE.Color(0x3a1016);
  return {
    mesh,
    update(t, phase) {
      uniforms.uTime.value = t;
      uniforms.uTint.value.lerpColors(calm, blood, phase * 0.75);
    },
  };
}
