import * as THREE from 'three';
import { rand } from './utils.js';

// Falling crimson petals and drifting motes of dust / embers.

const MOTE_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uScale;
  uniform float uEmber;
  varying float vAlpha;
  varying float vEmber;
  void main() {
    vec3 p = position;
    float t = uTime * (0.15 + fract(aSeed * 7.3) * 0.2);
    p.y = mod(p.y + t * (3.0 + uEmber * 4.0), 26.0);
    p.x += sin(uTime * 0.3 + aSeed * 20.0) * 1.5;
    p.z += cos(uTime * 0.25 + aSeed * 13.0) * 1.5;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float tw = 0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 3.0) + aSeed * 50.0);
    vAlpha = tw * smoothstep(0.0, 2.0, p.y) * (1.0 - smoothstep(20.0, 26.0, p.y));
    vEmber = step(0.5, fract(aSeed * 3.1)) * uEmber;
    gl_PointSize = (0.08 + fract(aSeed * 11.0) * 0.1) * uScale / max(-mv.z, 0.1) * (1.0 + vEmber);
    gl_Position = projectionMatrix * mv;
  }
`;
const MOTE_FRAG = /* glsl */ `
  varying float vAlpha;
  varying float vEmber;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(1.0 - d, 0.0), 2.0) * vAlpha;
    vec3 col = mix(vec3(1.0, 0.85, 0.7), vec3(1.0, 0.35, 0.15), vEmber);
    gl_FragColor = vec4(col, a * (0.7 + vEmber * 0.6));
  }
`;

export class Ambient {
  constructor(scene) {
    // Petals
    this.count = 420;
    const petalGeo = new THREE.PlaneGeometry(0.11, 0.075);
    const petalMat = new THREE.MeshStandardMaterial({
      color: 0xd21e3c,
      emissive: 0x5a0614,
      emissiveIntensity: 0.8,
      side: THREE.DoubleSide,
      roughness: 0.6,
    });
    this.petals = new THREE.InstancedMesh(petalGeo, petalMat, this.count);
    this.petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.petals.frustumCulled = false;
    this.data = [];
    for (let i = 0; i < this.count; i++) {
      this.data.push({
        p: new THREE.Vector3(rand(-30, 30), rand(0, 24), rand(-30, 30)),
        v: new THREE.Vector3(rand(-0.3, 0.3), -rand(0.5, 1.1), rand(-0.3, 0.3)),
        r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
        w: new THREE.Vector3(rand(0.5, 2.5), rand(0.5, 2.5), rand(0.5, 2.5)),
        ph: rand(0, 10),
        landed: 0,
      });
    }
    scene.add(this.petals);
    this.m4 = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.scl = new THREE.Vector3(1, 1, 1);
    this.wind = new THREE.Vector3(0.4, 0, 0.6);
    this.gust = 0;

    // Motes
    const n = 600;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 28;
      pos[i * 3] = Math.sin(a) * r;
      pos[i * 3 + 1] = Math.random() * 26;
      pos[i * 3 + 2] = Math.cos(a) * r;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, uEmber: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    scene.add(this.motes);
  }

  /** A sudden gust (e.g. from the boss slamming or roaring). */
  blast(strength = 1) {
    this.gust = Math.max(this.gust, strength);
  }

  update(dt, t, pixelScale, ember, blastOrigin, camPos) {
    this.moteMat.uniforms.uTime.value = t;
    this.moteMat.uniforms.uScale.value = pixelScale;
    this.moteMat.uniforms.uEmber.value += (ember - this.moteMat.uniforms.uEmber.value) * Math.min(1, dt);
    this.gust = Math.max(0, this.gust - dt * 1.2);
    const wx = this.wind.x + Math.sin(t * 0.3) * 0.5;
    const wz = this.wind.z + Math.cos(t * 0.21) * 0.5;
    for (let i = 0; i < this.count; i++) {
      const d = this.data[i];
      if (d.p.y <= 0.02) {
        d.landed += dt;
        if (this.gust > 0.2 && blastOrigin) {
          const dx = d.p.x - blastOrigin.x, dz = d.p.z - blastOrigin.z;
          const dist = Math.hypot(dx, dz) + 0.1;
          if (dist < 14) {
            d.v.set((dx / dist) * this.gust * 8, this.gust * rand(2, 5), (dz / dist) * this.gust * 8);
            d.p.y = 0.05;
            d.landed = 0;
          }
        }
        if (d.landed > 6) {
          d.p.set(rand(-30, 30), rand(20, 26), rand(-30, 30));
          d.landed = 0;
          d.v.set(rand(-0.3, 0.3), -rand(0.5, 1.1), rand(-0.3, 0.3));
        }
      } else {
        const sway = Math.sin(t * 1.7 + d.ph) * 0.6;
        d.v.x += ((wx + sway) - d.v.x) * dt * 0.8;
        d.v.z += ((wz + Math.cos(t * 1.3 + d.ph) * 0.6) - d.v.z) * dt * 0.8;
        d.v.y += (-0.8 - d.v.y) * dt * 1.5;
        d.p.addScaledVector(d.v, dt);
        d.r.x += d.w.x * dt;
        d.r.y += d.w.y * dt;
        d.r.z += d.w.z * dt;
        if (d.p.y <= 0.02) {
          d.p.y = 0.02;
          d.r.x = -Math.PI / 2 + rand(-0.2, 0.2);
          d.r.y = 0;
        }
        if (Math.abs(d.p.x) > 34 || Math.abs(d.p.z) > 34) {
          d.p.set(rand(-30, 30), rand(20, 26), rand(-30, 30));
        }
      }
      this.q.setFromEuler(d.r);
      // Shrink petals that drift right in front of the lens.
      let sc = 1;
      if (camPos) {
        const cd = d.p.distanceTo(camPos);
        sc = cd < 2.2 ? Math.max(0, (cd - 0.8) / 1.4) : 1;
      }
      this.scl.setScalar(sc);
      this.m4.compose(d.p, this.q, this.scl);
      this.petals.setMatrixAt(i, this.m4);
    }
    this.petals.instanceMatrix.needsUpdate = true;
  }
}
