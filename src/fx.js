import * as THREE from 'three';
import { rand, canvasTexture } from './utils.js';

// ---------------------------------------------------------------- particles

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  uniform float uScale;
  varying vec4 vColor;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    gl_Position = projectionMatrix * mv;
  }
`;
const POINT_FRAG = /* glsl */ `
  varying vec4 vColor;
  uniform float uHard;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float a = mix(pow(max(1.0 - d, 0.0), 1.6), step(d, 1.0) * (1.0 - d * 0.3), uHard);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }
`;

class ParticlePool {
  constructor(scene, max, blending, hard = 0) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.baseCol = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aColor', this.colAttr);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { uScale: { value: 400 }, uHard: { value: hard } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, size, life, grav = 0, drag = 0) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.baseCol[i * 3] = r; this.baseCol[i * 3 + 1] = g; this.baseCol[i * 3 + 2] = b;
    this.baseSize[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
  }

  _swap(i, j) {
    const s3 = (arr) => { for (let k = 0; k < 3; k++) arr[i * 3 + k] = arr[j * 3 + k]; };
    s3(this.pos); s3(this.vel); s3(this.baseCol);
    this.baseSize[i] = this.baseSize[j];
    this.life[i] = this.life[j];
    this.maxLife[i] = this.maxLife[j];
    this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j];
  }

  update(dt, pixelScale) {
    this.mat.uniforms.uScale.value = pixelScale;
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.count--;
        if (i !== this.count) this._swap(i, this.count);
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      const i3 = i * 3;
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.02 && this.grav[i] > 0) {
        this.pos[i3 + 1] = 0.02;
        this.vel[i3 + 1] *= -0.3;
        this.vel[i3] *= 0.6;
        this.vel[i3 + 2] *= 0.6;
      }
      const t = this.life[i] / this.maxLife[i];
      const fade = Math.min(1, t * 2.5) * Math.min(1, (1 - t) * 12 + 0.2);
      this.col[i * 4] = this.baseCol[i3];
      this.col[i * 4 + 1] = this.baseCol[i3 + 1];
      this.col[i * 4 + 2] = this.baseCol[i3 + 2];
      this.col[i * 4 + 3] = fade;
      this.size[i] = this.baseSize[i] * (0.4 + 0.6 * t);
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  clear() { this.count = 0; }
}

/** Streaking sparks drawn as short additive line segments. */
class SparkPool {
  constructor(scene, max) {
    this.max = max;
    this.count = 0;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.linePos = new Float32Array(max * 6);
    this.lineCol = new Float32Array(max * 6);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    scene.add(this.lines);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, life, grav = 18) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.c.set([r, g, b], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.count--;
        const j = this.count;
        if (i !== j) {
          for (let k = 0; k < 3; k++) {
            this.p[i * 3 + k] = this.p[j * 3 + k];
            this.v[i * 3 + k] = this.v[j * 3 + k];
            this.c[i * 3 + k] = this.c[j * 3 + k];
          }
          this.life[i] = this.life[j];
          this.maxLife[i] = this.maxLife[j];
          this.grav[i] = this.grav[j];
        }
        continue;
      }
      const i3 = i * 3;
      const drag = Math.exp(-3 * dt);
      this.v[i3] *= drag;
      this.v[i3 + 1] = this.v[i3 + 1] * drag - this.grav[i] * dt;
      this.v[i3 + 2] *= drag;
      this.p[i3] += this.v[i3] * dt;
      this.p[i3 + 1] += this.v[i3 + 1] * dt;
      this.p[i3 + 2] += this.v[i3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      const len = 0.035;
      const i6 = i * 6;
      this.linePos[i6] = this.p[i3];
      this.linePos[i6 + 1] = this.p[i3 + 1];
      this.linePos[i6 + 2] = this.p[i3 + 2];
      this.linePos[i6 + 3] = this.p[i3] - this.v[i3] * len;
      this.linePos[i6 + 4] = this.p[i3 + 1] - this.v[i3 + 1] * len;
      this.linePos[i6 + 5] = this.p[i3 + 2] - this.v[i3 + 2] * len;
      for (let k = 0; k < 3; k++) {
        this.lineCol[i6 + k] = this.c[i3 + k] * t * 2;
        this.lineCol[i6 + 3 + k] = 0;
      }
      i++;
    }
    this.geo.setDrawRange(0, this.count * 2);
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  clear() { this.count = 0; }
}

// ---------------------------------------------------------------- slash arcs

const SLASH_VERT = /* glsl */ `
  attribute float aT;
  attribute float aS;
  uniform float uA0;
  uniform float uA1;
  uniform float uThick;
  varying float vT;
  varying float vS;
  void main() {
    vT = aT;
    vS = aS;
    float th = mix(uA0, uA1, aT);
    float taper = pow(max(sin(3.14159 * clamp(aT, 0.0, 1.0)), 0.0), 0.55);
    float r = 1.0 - uThick * taper * (1.0 - aS);
    vec3 p = vec3(sin(th) * r, 0.0, cos(th) * r);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;
const SLASH_FRAG = /* glsl */ `
  uniform float uProg;
  uniform float uFade;
  uniform vec3 uColor;
  uniform float uTrail;
  uniform float uWhite;
  varying float vT;
  varying float vS;
  void main() {
    float d = uProg - vT;
    if (d < 0.0) discard;
    float trail = 1.0 - smoothstep(0.0, uTrail, d);
    float edge = pow(vS, 2.2);
    float a = trail * uFade * (0.25 + 0.75 * edge);
    vec3 col = mix(uColor, vec3(1.0), edge * uWhite) * (1.0 + edge * 1.5 * uWhite);
    gl_FragColor = vec4(col, a);
  }
`;

function makeSlashGeometry(seg = 40) {
  const pos = [], aT = [], aS = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    for (let j = 0; j < 2; j++) {
      pos.push(0, 0, 0);
      aT.push(i / seg);
      aS.push(j);
    }
    if (i < seg) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- rings

const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFade;
  uniform float uWidth;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    float band = (1.0 - smoothstep(1.0 - uWidth * 0.3, 1.0, r)) * smoothstep(1.0 - uWidth, 1.0 - uWidth * 0.3, r);
    float inner = smoothstep(1.0 - uWidth * 3.0, 1.0, r) * 0.25 * step(r, 1.0);
    float a = (band + inner) * uFade;
    if (a < 0.005) discard;
    gl_FragColor = vec4(uColor * (1.0 + band), a);
  }
`;
const SIMPLE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.glow = new ParticlePool(scene, 1600, THREE.AdditiveBlending);
    this.dark = new ParticlePool(scene, 500, THREE.NormalBlending, 1);
    this.sparks = new SparkPool(scene, 500);

    this.slashGeo = makeSlashGeometry();
    this.slashes = [];
    this.rings = [];
    this.glints = [];
    this.lights = [];
    this.ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

    this.glintTex = canvasTexture(128, 128, (g, w, h) => {
      const cx = w / 2, cy = h / 2;
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
      rg.addColorStop(0, 'rgba(255,255,255,1)');
      rg.addColorStop(0.12, 'rgba(255,240,230,0.9)');
      rg.addColorStop(0.35, 'rgba(255,150,160,0.25)');
      rg.addColorStop(1, 'rgba(255,100,120,0)');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      for (const [sx, sy] of [[1, 0.06], [0.06, 1]]) {
        const lg = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
        lg.addColorStop(0, 'rgba(255,255,255,1)');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        g.save();
        g.translate(cx, cy);
        g.scale(sx, sy);
        g.fillStyle = lg;
        g.beginPath();
        g.arc(0, 0, w / 2, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    });

    // A small pool of real lights for impact flashes.
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.userData.life = 0;
      scene.add(l);
      this.lights.push(l);
    }
  }

  // Generic radial burst of glowing particles.
  burst(pos, { count = 20, color = [1, 0.9, 0.85], speed = 6, size = 0.3, life = 0.6, gravity = 6, drag = 2, up = 0, spread = 1, dir = null, dark = false } = {}) {
    const pool = dark ? this.dark : this.glow;
    for (let i = 0; i < count; i++) {
      let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1);
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      if (dir) {
        vx = dir.x + vx * spread; vy = dir.y + vy * spread; vz = dir.z + vz * spread;
      }
      const s = speed * rand(0.4, 1);
      pool.spawn(pos.x, pos.y, pos.z, vx * s, vy * s + up, vz * s,
        color[0] * rand(0.85, 1.1), color[1] * rand(0.85, 1.1), color[2] * rand(0.85, 1.1),
        size * rand(0.6, 1.3), life * rand(0.6, 1.2), gravity, drag);
    }
  }

  sparkBurst(pos, { count = 16, color = [1, 0.8, 0.5], speed = 14, life = 0.35, dir = null, spread = 1, gravity = 20 } = {}) {
    for (let i = 0; i < count; i++) {
      let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1);
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      if (dir) { vx = dir.x + vx * spread; vy = dir.y + vy * spread; vz = dir.z + vz * spread; }
      const s = speed * rand(0.35, 1);
      this.sparks.spawn(pos.x, pos.y, pos.z, vx * s, vy * s, vz * s, color[0], color[1], color[2], life * rand(0.5, 1.2), gravity);
    }
  }

  /**
   * A crescent swoosh. The arc lies in the local XZ plane of a frame rotated
   * by (yaw, pitch, roll) and placed at `origin`.
   */
  slash({ origin, yaw = 0, pitch = 0, roll = 0, radius = 2, a0 = -1.5, a1 = 1.5, dur = 0.18, color = [1, 0.85, 0.9], thick = 0.45, trail = 0.7, follow = null, yScale = 1, white = 0.85, intensity = 1 }) {
    let s = this.slashes.find((x) => !x.visible);
    if (!s) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SLASH_VERT,
        fragmentShader: SLASH_FRAG,
        uniforms: {
          uA0: { value: 0 }, uA1: { value: 0 }, uThick: { value: 0.4 },
          uProg: { value: 0 }, uFade: { value: 1 }, uColor: { value: new THREE.Color() }, uTrail: { value: 0.7 }, uWhite: { value: 0.85 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      s = new THREE.Mesh(this.slashGeo, mat);
      s.frustumCulled = false;
      s.renderOrder = 7;
      s.rotation.order = 'YXZ';
      this.scene.add(s);
      this.slashes.push(s);
    }
    const u = s.material.uniforms;
    u.uA0.value = a0;
    u.uA1.value = a1;
    u.uThick.value = thick;
    u.uProg.value = 0;
    u.uFade.value = 1;
    u.uTrail.value = trail;
    u.uColor.value.setRGB(color[0] * intensity, color[1] * intensity, color[2] * intensity);
    u.uWhite.value = white;
    s.position.copy(origin);
    s.rotation.set(pitch, yaw, roll);
    s.scale.set(radius, radius * yScale, radius);
    s.userData = { t: 0, dur, follow, offset: follow ? origin.clone().sub(follow.position) : null };
    s.visible = true;
    return s;
  }

  ring(pos, { r0 = 0.5, r1 = 4, dur = 0.5, color = [1, 0.6, 0.5], width = 0.25, y = 0.05 } = {}) {
    let m = this.rings.find((x) => !x.visible);
    if (!m) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: SIMPLE_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { uColor: { value: new THREE.Color() }, uFade: { value: 1 }, uWidth: { value: 0.2 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      m = new THREE.Mesh(this.ringGeo, mat);
      m.renderOrder = 4;
      this.scene.add(m);
      this.rings.push(m);
    }
    m.material.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    m.material.uniforms.uWidth.value = width;
    m.position.set(pos.x, y, pos.z);
    m.userData = { t: 0, dur, r0, r1 };
    m.scale.setScalar(r0);
    m.visible = true;
    return m;
  }

  glint(getPos, { size = 2.5, dur = 0.45, color = 0xffffff } = {}) {
    const mat = new THREE.SpriteMaterial({
      map: this.glintTex,
      color,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 10;
    sp.userData = { t: 0, dur, size, getPos };
    this.scene.add(sp);
    this.glints.push(sp);
  }

  flash(pos, color = 0xffffff, intensity = 30, dur = 0.15, distance = 10) {
    const l = this.lights.reduce((a, b) => (a.userData.life < b.userData.life ? a : b));
    l.position.copy(pos);
    l.color.set(color);
    l.distance = distance;
    l.userData = { life: dur, dur, peak: intensity };
    l.intensity = intensity;
  }

  update(dt, pixelScale) {
    this.glow.update(dt, pixelScale);
    this.dark.update(dt, pixelScale);
    this.sparks.update(dt);

    for (const s of this.slashes) {
      if (!s.visible) continue;
      const d = s.userData;
      d.t += dt;
      const k = d.t / d.dur;
      if (d.follow) s.position.copy(d.follow.position).add(d.offset);
      const trail = s.material.uniforms.uTrail.value;
      s.material.uniforms.uProg.value = Math.min(1, k / 0.45) + Math.max(0, (k - 0.45) / 0.55) * trail;
      s.material.uniforms.uFade.value = k < 0.5 ? 1 : Math.max(0, 1 - (k - 0.5) / 0.5);
      if (k >= 1) s.visible = false;
    }

    for (const m of this.rings) {
      if (!m.visible) continue;
      const d = m.userData;
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      const e = 1 - Math.pow(1 - k, 2);
      m.scale.setScalar(d.r0 + (d.r1 - d.r0) * e);
      m.material.uniforms.uFade.value = 1 - k;
      if (k >= 1) m.visible = false;
    }

    for (let i = this.glints.length - 1; i >= 0; i--) {
      const sp = this.glints[i];
      const d = sp.userData;
      d.t += dt;
      const k = d.t / d.dur;
      if (k >= 1) {
        this.scene.remove(sp);
        sp.material.dispose();
        this.glints.splice(i, 1);
        continue;
      }
      const p = d.getPos();
      sp.position.copy(p);
      const s = d.size * Math.sin(Math.PI * Math.min(1, k * 1.2)) ;
      sp.scale.set(s, s, 1);
      sp.material.rotation = k * 1.2;
      sp.material.opacity = 1;
    }

    for (const l of this.lights) {
      const d = l.userData;
      if (d.life > 0) {
        d.life -= dt;
        l.intensity = Math.max(0, d.peak * (d.life / d.dur));
      } else l.intensity = 0;
    }
  }

  clear() {
    this.glow.clear();
    this.dark.clear();
    this.sparks.clear();
    this.slashes.forEach((s) => (s.visible = false));
    this.rings.forEach((r) => (r.visible = false));
    for (const g of this.glints) { this.scene.remove(g); g.material.dispose(); }
    this.glints.length = 0;
  }
}
