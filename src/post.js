import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final grade: chromatic aberration, soft S-curve, vignette, damage tint, grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uDamage: { value: 0 },
    uLowHp: { value: 0 },
    uAberration: { value: 0.0035 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uDamage, uLowHp, uAberration, uFlash;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float ab = uAberration + uDamage * 0.03;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab * r2 * 4.0).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab * r2 * 4.0).b;
      // Gentle S-curve and warm/purple split tone.
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.22);
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col += mix(vec3(0.018, 0.0, 0.03), vec3(0.02, 0.008, -0.01), lum);
      // Vignette
      float v = smoothstep(0.95, 0.25, length(c * vec2(1.0, 1.15)));
      col *= mix(0.45, 1.0, v);
      // Damage / low health tint
      float edge = smoothstep(0.2, 0.75, length(c));
      float dmg = uDamage * 0.8 + uLowHp * (0.3 + 0.15 * sin(uTime * 5.0));
      col = mix(col, vec3(0.45, 0.0, 0.04), edge * clamp(dmg, 0.0, 1.0));
      col = mix(col, vec3(1.0), uFlash);
      // Grain
      float n = fract(sin(dot(vUv * vec2(1234.5, 987.6) + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.03;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.6, 0.5, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.damage = 0;
    this.flash = 0;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  setPixelRatio(pr) {
    this.composer.setPixelRatio(pr);
  }

  damagePulse() {
    this.damage = 1;
  }

  whiteFlash(v = 1) {
    this.flash = Math.max(this.flash, v);
  }

  render(dt, time, lowHp) {
    this.damage = Math.max(0, this.damage - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 1.5);
    const u = this.grade.uniforms;
    u.uTime.value = time;
    u.uDamage.value = this.damage;
    u.uLowHp.value = lowHp;
    u.uFlash.value = this.flash;
    this.composer.render(dt);
  }
}
