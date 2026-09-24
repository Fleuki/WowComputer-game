import * as THREE from 'three';
import {
  clamp, damp, lerp, rand, turnToward, easeOutCubic, easeInOutSine, easeInCubic,
  distPointSegment, solveTwoBone, canvasTexture, mulberry32,
} from './utils.js';
import { ARENA_RADIUS } from './arena.js';

// ------------------------------------------------------------------ poses
// All values are in the boss's local frame (+Z forward, -X is its right side).
// gx/gy/gz = right hand grip, sy/sp = spear yaw/pitch.
const BASE_POSE = { hipH: 3.0, lean: 0.22, twist: 0, head: 0.25, gx: -0.95, gy: 2.75, gz: 1.0, sy: 0.22, sp: -0.5, lh: 0 };
const P = (o) => ({ ...BASE_POSE, ...o });
const POSES = {
  idle: P({}),
  dormant: P({ hipH: 1.45, lean: 0.95, head: 0.75, gx: -0.7, gy: 2.8, gz: 1.5, sy: 0.05, sp: -0.55 }),
  crouch: P({ hipH: 2.1, lean: 0.6, head: 0.1, gx: -1.0, gy: 1.9, gz: 0.9, sy: 0.3, sp: -0.3 }),
  lungeWind: P({ hipH: 2.25, lean: 0.55, twist: -0.4, head: 0.05, gx: -1.0, gy: 2.4, gz: -0.9, sy: 0.04, sp: -0.02 }),
  lungeStrike: P({ hipH: 2.45, lean: 0.8, twist: 0.12, head: 0.0, gx: -0.35, gy: 2.2, gz: 2.3, sy: 0.0, sp: -0.3 }),
  sweepWind: P({ hipH: 2.2, lean: 0.45, twist: -0.9, head: 0.1, gx: -1.2, gy: 1.2, gz: -0.5, sy: -2.25, sp: -0.12 }),
  stabWind: P({ hipH: 2.55, lean: 0.45, twist: -0.3, gx: -0.9, gy: 2.5, gz: -0.4, sy: 0.02, sp: -0.2 }),
  stabStrike: P({ hipH: 2.5, lean: 0.66, twist: 0.15, gx: -0.35, gy: 1.9, gz: 1.8, sy: 0.0, sp: -0.4 }),
  raise: P({ hipH: 3.25, lean: -0.1, head: -0.2, gx: -0.5, gy: 5.2, gz: 0.9, sy: 0.0, sp: -0.9 }),
  slamAir: P({ hipH: 2.8, lean: 0.35, head: 0.4, gx: -0.4, gy: 3.3, gz: 1.2, sy: 0.0, sp: -1.3 }),
  plant: P({ hipH: 1.9, lean: 0.85, head: 0.5, gx: -0.3, gy: 2.6, gz: 1.7, sy: 0.0, sp: -0.55 }),
  throwWind: P({ hipH: 2.6, lean: 0.15, twist: -1.0, gx: -1.6, gy: 3.3, gz: -0.8, sy: -1.9, sp: 0.25 }),
  throwStrike: P({ hipH: 2.5, lean: 0.45, twist: 0.8, gx: 1.0, gy: 2.4, gz: 1.4, sy: 1.5, sp: -0.15 }),
  roar: P({ hipH: 3.25, lean: -0.3, head: -0.55, gx: -2.0, gy: 2.9, gz: 0.2, sy: -1.2, sp: -0.45, lh: 1 }),
  stagger: P({ hipH: 1.5, lean: 1.0, head: 0.7, gx: -1.0, gy: 1.35, gz: 1.4, sy: 0.35, sp: -0.28 }),
  dead: P({ hipH: 0.9, lean: 1.3, head: 1.0, gx: -1.3, gy: 0.5, gz: 1.6, sy: 0.7, sp: -0.05 }),
  diveAir: P({ hipH: 3.0, lean: 0.7, head: 0.3, gx: -0.3, gy: 2.7, gz: 1.8, sy: 0.0, sp: -0.6 }),
};
const POSE_KEYS = Object.keys(BASE_POSE);

// Overall size multiplier: the boss towers over the heroine.
const S = 1.3;
const SPEAR_FRONT = 5.7;
const SPEAR_BACK = 2.4;
const TIP = SPEAR_FRONT * S;
const UP = new THREE.Vector3(0, 1, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);

// ------------------------------------------------------------------ textures
function capeTextures() {
  const rnd = mulberry32(77);
  const W = 256, H = 512;
  // Tatter outline shared by colour + emissive maps.
  const hem = [];
  for (let x = 0; x <= W; x += 6) hem.push([x, H - 10 - Math.pow(rnd(), 1.6) * H * 0.3]);
  const holes = [];
  for (let i = 0; i < 16; i++) holes.push([rnd() * W, H * (0.45 + rnd() * 0.45), 4 + rnd() * 14, 8 + rnd() * 30]);
  const tatter = (g) => {
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(0, H);
    for (const [x, y] of hem) g.lineTo(x, y);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    for (const [x, y, rx, ry] of holes) {
      g.beginPath();
      g.ellipse(x, y, rx, ry, rnd() * 0.4 - 0.2, 0, Math.PI * 2);
      g.fill();
    }
    // Vertical rips from the hem.
    for (let i = 0; i < 9; i++) {
      const x = rnd() * W;
      g.beginPath();
      g.moveTo(x - 3, H);
      g.lineTo(x + (rnd() - 0.5) * 20, H * (0.55 + rnd() * 0.25));
      g.lineTo(x + 5, H);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  };
  const map = canvasTexture(W, H, (g) => {
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#6e0c1c');
    lg.addColorStop(0.35, '#a3172f');
    lg.addColorStop(1, '#4a0610');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '20,0,5' : '200,40,60'},${0.05 + rnd() * 0.12})`;
      g.lineWidth = 2 + rnd() * 8;
      const x = rnd() * W;
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + rnd() * 20 - 10, H * 0.3, x + rnd() * 30 - 15, H * 0.6, x + rnd() * 20 - 10, H);
      g.stroke();
    }
    tatter(g);
  });
  const emissive = canvasTexture(W, H, (g) => {
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, '#000');
    lg.addColorStop(0.55, '#200400');
    lg.addColorStop(1, '#ff6a20');
    g.fillStyle = lg;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(255,${120 + rnd() * 100},40,${rnd()})`;
      const y = H * (0.4 + rnd() * 0.6);
      g.fillRect(rnd() * W, y, 2, 2 + rnd() * 3);
    }
    tatter(g);
  });
  return { map, emissive };
}

// ------------------------------------------------------------------ hazards
const WAVE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const WAVE_FRAG = /* glsl */ `
  uniform float uFade;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2) * uFade;
    float band = 0.6 + 0.4 * sin(vUv.x * 180.0);
    gl_FragColor = vec4(uColor * (1.0 + (1.0 - vUv.y) * 2.0), a * band);
  }
`;

export class Shockwave {
  constructor(boss, origin, { speed = 13, maxR = 17, heavy = true, height = 0.9, color = [1.0, 0.35, 0.3], dust = [1, 0.4, 0.3] } = {}) {
    this.boss = boss;
    this.o = origin.clone();
    this.r = 0.8;
    this.speed = speed;
    this.maxR = maxR;
    this.heavy = heavy;
    this.hit = false;
    this.dust = dust;
    const mat = new THREE.ShaderMaterial({
      vertexShader: WAVE_VERT,
      fragmentShader: WAVE_FRAG,
      uniforms: { uFade: { value: 1 }, uColor: { value: new THREE.Color(color[0], color[1], color[2]) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(boss.waveGeo, mat);
    this.mesh.position.set(this.o.x, 0, this.o.z);
    this.mesh.scale.set(this.r, height, this.r);
    boss.game.scene.add(this.mesh);
  }

  update(dt) {
    this.r += this.speed * dt;
    const k = this.r / this.maxR;
    this.mesh.scale.set(this.r, this.mesh.scale.y, this.r);
    this.mesh.material.uniforms.uFade.value = 1 - k;
    const pl = this.boss.game.player;
    if (!this.hit && pl.pos.y < 0.5) {
      const d = Math.hypot(pl.pos.x - this.o.x, pl.pos.z - this.o.z);
      if (Math.abs(d - this.r) < 0.55) {
        if (pl.takeDamage(this.boss.dmg(this.heavy), this.o)) this.hit = true;
      }
    }
    // Throw up dust along the front.
    if (Math.random() < 0.9) {
      const a = Math.random() * Math.PI * 2;
      this.boss.game.fx.glow.spawn(this.o.x + Math.cos(a) * this.r, 0.2, this.o.z + Math.sin(a) * this.r, 0, rand(1, 3), 0, this.dust[0], this.dust[1], this.dust[2], 0.4, 0.4, 0, 1);
    }
    if (k >= 1) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.boss.game.scene.remove(this.mesh);
    this.mesh.material.dispose();
  }
}

class SpikeTrap {
  constructor(boss, pos, delay) {
    this.boss = boss;
    this.p = pos.clone();
    this.p.y = 0;
    this.delay = delay;
    this.t = 0;
    this.radius = 1.35;
    this.hitDone = false;
    this.group = new THREE.Group();
    this.group.position.copy(this.p);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a40, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ring = new THREE.Mesh(boss.trapRingGeo, this.ringMat);
    this.ring.position.y = 0.04;
    this.group.add(this.ring);
    this.fillMat = new THREE.MeshBasicMaterial({ color: 0x801020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.fill = new THREE.Mesh(boss.trapFillGeo, this.fillMat);
    this.fill.position.y = 0.03;
    this.group.add(this.fill);
    this.spikes = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(boss.spikeGeo, boss.spikeMat);
      const a = (i / 7) * Math.PI * 2 + rand(-0.3, 0.3);
      const r = i === 0 ? 0 : rand(0.4, 1.0);
      s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      s.rotation.set(Math.sin(a) * r * 0.35, 0, -Math.cos(a) * r * 0.35);
      s.userData.h = i === 0 ? 1.3 : rand(0.6, 1.05);
      s.scale.set(1, 0.001, 1);
      s.castShadow = true;
      this.group.add(s);
      this.spikes.push(s);
    }
    boss.game.scene.add(this.group);
  }

  update(dt) {
    const g = this.boss.game;
    this.t += dt;
    const t = this.t;
    if (t < this.delay) {
      const k = t / this.delay;
      this.ringMat.opacity = 0.35 + 0.5 * Math.abs(Math.sin(t * 18));
      this.ring.scale.setScalar(lerp(0.4, 1, easeOutCubic(Math.min(1, k * 2))));
      this.fillMat.opacity = k * 0.35;
      this.fill.scale.setScalar(k);
      return true;
    }
    const e = t - this.delay;
    if (!this.erupted) {
      this.erupted = true;
      g.audio.play('spike', { gap: 0.02 });
      g.fx.sparkBurst(new THREE.Vector3(this.p.x, 0.3, this.p.z), { count: 12, color: [1, 0.3, 0.3], speed: 12, dir: UP, spread: 0.7 });
      g.fx.burst(new THREE.Vector3(this.p.x, 0.3, this.p.z), { count: 10, color: [0.3, 0.2, 0.2], speed: 4, size: 0.5, life: 0.7, gravity: 3, dark: true, up: 2 });
      g.cam.shake(0.15);
      this.ringMat.opacity = 0;
      this.fillMat.opacity = 0;
    }
    const grow = Math.min(1, e / 0.07);
    const shrink = e > 0.7 ? Math.max(0, 1 - (e - 0.7) / 0.25) : 1;
    for (const s of this.spikes) s.scale.set(1, Math.max(0.001, s.userData.h * grow * shrink), 1);
    if (!this.hitDone && e < 0.2) {
      const pl = g.player;
      const d = Math.hypot(pl.pos.x - this.p.x, pl.pos.z - this.p.z);
      if (d < this.radius + 0.2 && pl.pos.y < 2.2) {
        if (pl.takeDamage(this.boss.dmg(false), this.p)) this.hitDone = true;
      }
    }
    if (e > 1.0) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.boss.game.scene.remove(this.group);
    this.ringMat.dispose();
    this.fillMat.dispose();
  }
}

class Crescent {
  constructor(boss, pos, dir, speed) {
    this.boss = boss;
    this.p = pos.clone();
    this.dir = dir.clone();
    this.speed = speed;
    this.t = 0;
    this.returning = false;
    this.mesh = new THREE.Mesh(boss.crescentGeo, boss.crescentMat);
    this.glow = new THREE.Sprite(boss.crescentGlowMat);
    this.glow.scale.set(3.2, 3.2, 1);
    this.mesh.add(this.glow);
    this.mesh.position.copy(this.p);
    boss.game.scene.add(this.mesh);
    this.hitDone = false;
  }

  update(dt) {
    const g = this.boss.game;
    this.t += dt;
    if (!this.returning) {
      const v = this.speed * Math.max(0.05, 1 - this.t / 1.15);
      this.p.addScaledVector(this.dir, v * dt);
      if (this.t > 1.15) this.returning = true;
    } else {
      const target = this.boss.aimPoint();
      target.y = this.p.y;
      const to = target.sub(this.p);
      const d = to.length();
      const v = Math.min(22, (this.t - 1.15) * 30);
      if (d < 1.2 || this.t > 4) { this.dispose(); return false; }
      this.dir.copy(to.normalize());
      this.p.addScaledVector(this.dir, v * dt);
    }
    const hr = Math.hypot(this.p.x, this.p.z);
    if (hr > ARENA_RADIUS + 1) { this.p.x *= (ARENA_RADIUS + 1) / hr; this.p.z *= (ARENA_RADIUS + 1) / hr; this.returning = true; }
    this.mesh.position.copy(this.p);
    this.spin = (this.spin || 0) + dt * 18;
    this.mesh.quaternion.setFromUnitVectors(ZAXIS, this.dir);
    this.mesh.rotateZ(this.spin);
    if (Math.random() < 0.8) g.fx.glow.spawn(this.p.x, this.p.y, this.p.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 1, 0.3, 0.2, 0.5, 0.3, 0, 0);
    if (!this.hitDone && g.player.hitBySphere(this.p, 0.95)) {
      if (g.player.takeDamage(this.boss.dmg(false), this.p)) this.hitDone = true;
    }
    return true;
  }

  dispose() {
    this.boss.game.scene.remove(this.mesh);
  }
}

// ------------------------------------------------------------------ cloth
export class Cloth {
  constructor(cols, rows, material) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.p = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    for (let i = 0; i < cols; i++) this.pinned[i] = 1;
    this.cons = [];
    this.acc = 0;
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    const uv = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) uv.push(c / (cols - 1), 1 - r / (rows - 1));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const idx = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  build(anchors, dropDir) {
    const { cols, rows } = this;
    const vRest = 0.34 * S;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const a = anchors[c];
        const x = a.x + dropDir.x * r * vRest;
        const y = a.y - r * vRest;
        const z = a.z + dropDir.z * r * vRest;
        this.p.set([x, y, z], i * 3);
        this.prev.set([x, y, z], i * 3);
      }
    }
    this.cons.length = 0;
    const topSpacing = anchors[0].distanceTo(anchors[1]);
    for (let r = 0; r < rows; r++) {
      const hs = topSpacing * (1 + (r / (rows - 1)) * 1.1);
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (c < cols - 1) this.cons.push(i, i + 1, hs);
        if (r < rows - 1) this.cons.push(i, i + cols, vRest);
        if (r < rows - 2) this.cons.push(i, i + cols * 2, vRest * 2);
        if (c < cols - 1 && r < rows - 1) this.cons.push(i, i + cols + 1, Math.hypot(hs, vRest));
      }
    }
  }

  step(anchors, colliders, wind, dt) {
    this.acc = Math.min(this.acc + dt, 3 / 60);
    const h = 1 / 60;
    while (this.acc >= h) {
      this.acc -= h;
      this._sub(anchors, colliders, wind, h);
    }
    this.posAttr.array.set(this.p);
    this.posAttr.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  _sub(anchors, colliders, wind, h) {
    const { p, prev, cols } = this;
    const n = p.length / 3;
    const g = -16 * h * h;
    for (let c = 0; c < cols; c++) {
      p[c * 3] = anchors[c].x; p[c * 3 + 1] = anchors[c].y; p[c * 3 + 2] = anchors[c].z;
      prev[c * 3] = anchors[c].x; prev[c * 3 + 1] = anchors[c].y; prev[c * 3 + 2] = anchors[c].z;
    }
    for (let i = cols; i < n; i++) {
      const i3 = i * 3;
      const x = p[i3], y = p[i3 + 1], z = p[i3 + 2];
      const w = (i / n);
      p[i3] += (x - prev[i3]) * 0.975 + wind.x * h * h * w;
      p[i3 + 1] += (y - prev[i3 + 1]) * 0.975 + g + wind.y * h * h * w;
      p[i3 + 2] += (z - prev[i3 + 2]) * 0.975 + wind.z * h * h * w;
      prev[i3] = x; prev[i3 + 1] = y; prev[i3 + 2] = z;
    }
    const cons = this.cons;
    for (let it = 0; it < 4; it++) {
      for (let k = 0; k < cons.length; k += 3) {
        const a = cons[k], b = cons[k + 1], rest = cons[k + 2];
        const a3 = a * 3, b3 = b * 3;
        const dx = p[b3] - p[a3], dy = p[b3 + 1] - p[a3 + 1], dz = p[b3 + 2] - p[a3 + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - rest) / d;
        const pa = this.pinned[a], pb = this.pinned[b];
        if (pa && pb) continue;
        const wa = pa ? 0 : pb ? 1 : 0.5;
        const wb = pb ? 0 : pa ? 1 : 0.5;
        p[a3] += dx * diff * wa; p[a3 + 1] += dy * diff * wa; p[a3 + 2] += dz * diff * wa;
        p[b3] -= dx * diff * wb; p[b3 + 1] -= dy * diff * wb; p[b3 + 2] -= dz * diff * wb;
      }
      // Collisions
      for (let i = cols; i < n; i++) {
        const i3 = i * 3;
        if (p[i3 + 1] < 0.04) p[i3 + 1] = 0.04;
        for (const col of colliders) {
          const ax = col.a.x, ay = col.a.y, az = col.a.z;
          const bx = col.b.x - ax, by = col.b.y - ay, bz = col.b.z - az;
          const px = p[i3] - ax, py = p[i3 + 1] - ay, pz = p[i3 + 2] - az;
          const len2 = bx * bx + by * by + bz * bz;
          let t = len2 > 0 ? (px * bx + py * by + pz * bz) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const cx = px - bx * t, cy = py - by * t, cz = pz - bz * t;
          const d2 = cx * cx + cy * cy + cz * cz;
          if (d2 < col.r * col.r && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = (col.r - d) / d;
            p[i3] += cx * push; p[i3 + 1] += cy * push; p[i3 + 2] += cz * push;
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------ boss
export class Boss {
  constructor(game) {
    this.game = game;
    const scene = game.scene;

    this.mats = {
      armor: new THREE.MeshStandardMaterial({ color: 0x1d1822, metalness: 0.75, roughness: 0.36, envMapIntensity: 1.2 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xc09553, metalness: 1.0, roughness: 0.3, envMapIntensity: 1.3 }),
      bone: new THREE.MeshStandardMaterial({ color: 0xf3ede3, roughness: 0.3, metalness: 0.0, emissive: 0xffffff, emissiveIntensity: 0.0 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x050204, emissive: 0xff1a2a, emissiveIntensity: 0 }),
      cloth: null,
      spearMetal: new THREE.MeshStandardMaterial({ color: 0xe9e2d6, metalness: 0.95, roughness: 0.18, envMapIntensity: 1.5 }),
      shaft: new THREE.MeshStandardMaterial({ color: 0x6a4a2e, metalness: 0.8, roughness: 0.35, envMapIntensity: 1.2 }),
    };
    const tex = capeTextures();
    this.mats.cloth = new THREE.MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissive,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0,
    });

    this.group = new THREE.Group();
    this.group.scale.setScalar(S);
    scene.add(this.group);
    this.limbs = new THREE.Group();
    scene.add(this.limbs);
    this.buildBody();
    this.buildLimbs();
    this.buildSpear();

    // Hazard assets (shared)
    this.waveGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0);
    this.trapRingGeo = new THREE.RingGeometry(1.25, 1.42, 48).rotateX(-Math.PI / 2);
    this.trapFillGeo = new THREE.CircleGeometry(1.35, 40).rotateX(-Math.PI / 2);
    this.spikeGeo = new THREE.ConeGeometry(0.2, 2.2, 5).translate(0, 1.1, 0);
    this.spikeMat = new THREE.MeshStandardMaterial({ color: 0x4a0612, emissive: 0xff1c3a, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.25 });
    this.crescentGeo = (() => {
      const s = new THREE.Shape();
      const R = 0.95;
      const pts = [];
      const N = 24;
      for (let i = 0; i <= N; i++) { const a = -1.3 + (i / N) * 2.6; pts.push([Math.cos(a) * R, Math.sin(a) * R]); }
      for (let i = N; i >= 0; i--) {
        const a = -1.3 + (i / N) * 2.6;
        const w = 0.42 * Math.sin((i / N) * Math.PI);
        pts.push([Math.cos(a) * (R - w), Math.sin(a) * (R - w)]);
      }
      s.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
      const g = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false });
      // Centre the blade on its spin axis; it spins like a thrown sickle.
      g.translate(-0.55, 0, -0.03);
      g.scale(1.3, 1.3, 1.3);
      return g;
    })();
    this.crescentMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.7, 0.5), side: THREE.DoubleSide });
    this.crescentGlowMat = new THREE.SpriteMaterial({ map: game.fx.glintTex, color: 0xff5040, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });

    // Red phase-two light that follows the boss.
    this.light = new THREE.PointLight(0xff3a2a, 0, 16, 1.6);
    scene.add(this.light);

    // Scratch
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.mid = new THREE.Vector3();
    this.end = new THREE.Vector3();
    this.gripW = new THREE.Vector3();
    this.dirW = new THREE.Vector3(0, 0, 1);
    this.tipW = new THREE.Vector3();
    this.prevGrip = new THREE.Vector3();
    this.prevTip = new THREE.Vector3();
    this.capsules = [];
    for (let i = 0; i < 6; i++) this.capsules.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.5 });

    this.hazards = [];
    this.id = 'carmine';
    this.arena = 'crimson';
    this.music = { p1: 'drowned', p2: 'ash' };
    this.title = { small: 'Страж Багряного Собора', big: 'КАРМИН' };
    this.hudName = 'Кармин, Страж Собора';
    this.shown = true;
    this.reset();
  }

  setVisible(v) {
    this.shown = v;
    this.group.visible = this.limbs.visible = this.spear.visible = this.cape.mesh.visible = v;
    this.light.visible = v;
  }

  // ---------------------------------------------------------------- building
  buildBody() {
    const M = this.mats;
    const g = this.group;
    const hips = (this.hips = new THREE.Group());
    g.add(hips);

    // Tattered skirt
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.25, 2.1, 18, 4, true).translate(0, -1.0, 0), M.cloth);
    skirt.castShadow = true;
    hips.add(skirt);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 8, 20).rotateX(Math.PI / 2), M.gold);
    hips.add(belt);

    const torso = (this.torso = new THREE.Group());
    torso.rotation.order = 'YXZ';
    hips.add(torso);
    // Abdomen (narrow, segmented)
    const abProfile = [];
    for (let i = 0; i <= 10; i++) {
      const y = i * 0.12;
      const r = 0.34 + Math.sin(i * 1.3) * 0.04 + (i / 10) * 0.2;
      abProfile.push(new THREE.Vector2(r, y));
    }
    const abdomen = new THREE.Mesh(new THREE.LatheGeometry(abProfile, 14), M.armor);
    torso.add(abdomen);
    // Chest
    const chest = new THREE.Mesh(new THREE.SphereGeometry(0.8, 20, 16), M.armor);
    chest.scale.set(1.08, 0.95, 0.78);
    chest.position.set(0, 1.65, 0.05);
    torso.add(chest);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.05, 6, 28), M.gold);
    trim.rotation.x = Math.PI / 2 - 0.15;
    trim.scale.set(1.1, 0.8, 1);
    trim.position.set(0, 1.25, 0.08);
    torso.add(trim);
    const sternum = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 4).rotateX(Math.PI), M.gold);
    sternum.position.set(0, 1.55, 0.62);
    sternum.scale.set(1, 1, 0.4);
    torso.add(sternum);
    // Pauldrons with spikes
    for (const side of [-1, 1]) {
      const pd = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.armor);
      pd.position.set(side * 0.8, 2.05, 0.05);
      pd.rotation.z = -side * 0.5;
      torso.add(pd);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.035, 6, 20), M.gold);
      rim.rotation.x = Math.PI / 2;
      pd.add(rim);
      for (let k = 0; k < 2; k++) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.8 - k * 0.25, 6), M.armor);
        sp.position.set(side * (0.95 + k * 0.1), 2.35 - k * 0.05, -0.2 + k * 0.3);
        sp.rotation.set(-0.5, 0, -side * (0.7 + k * 0.3));
        torso.add(sp);
      }
    }
    // Spiked collar
    for (let i = 0; i < 7; i++) {
      const a = (i / 6 - 0.5) * 2.4;
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1.0 - Math.abs(i - 3) * 0.1, 5), M.armor);
      c.position.set(Math.sin(a) * 0.45, 2.45, -0.25 + Math.cos(a) * -0.1);
      c.rotation.set(-0.55, 0, -Math.sin(a) * 0.6);
      torso.add(c);
    }
    // Neck + head
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.6, 8), M.armor);
    neck.position.set(0, 2.3, 0.2);
    neck.rotation.x = 0.4;
    torso.add(neck);
    const head = (this.head = new THREE.Group());
    head.position.set(0, 2.55, 0.38);
    torso.add(head);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.46, 14, 12), M.armor);
    hood.position.set(0, 0.05, -0.18);
    hood.scale.set(1, 1, 1.1);
    head.add(hood);
    const maskProfile = [
      [0.0, -0.95], [0.12, -0.8], [0.26, -0.5], [0.36, -0.15], [0.42, 0.15], [0.41, 0.4], [0.32, 0.6], [0.17, 0.72], [0.0, 0.76],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const maskGeo = new THREE.LatheGeometry(maskProfile, 22);
    maskGeo.scale(1, 1, 0.82);
    const mask = new THREE.Mesh(maskGeo, M.bone);
    mask.position.set(0, 0.0, 0.08);
    mask.rotation.x = 0.25;
    head.add(mask);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), M.eye);
      eye.scale.set(0.9, 1.9, 0.4);
      eye.position.set(side * 0.17, -0.05, 0.4);
      eye.rotation.set(0.2, side * 0.3, side * 0.55);
      head.add(eye);
    }
    // Great crescent horn, angled so it reads from the front as well as the side.
    const horn = new THREE.Mesh(this.hornGeometry(), M.bone);
    horn.position.set(0.05, 0.3, -0.1);
    horn.rotation.set(0, 0.55, -0.28);
    head.add(horn);

    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.flashMats = [M.armor, M.bone, M.gold];

    // Cape
    this.cape = new Cloth(12, 16, M.cloth);
    this.game.scene.add(this.cape.mesh);
    this.capeAnchorsLocal = [];
    for (let i = 0; i < 12; i++) {
      const u = i / 11 - 0.5;
      this.capeAnchorsLocal.push(new THREE.Vector3(u * 1.7, 2.05 - Math.abs(u) * 0.2, -0.5 - (0.25 - u * u) * 0.4));
    }
    this.capeAnchors = this.capeAnchorsLocal.map((v) => v.clone());
  }

  hornGeometry() {
    const pts = [];
    const cx = 0.1, cy = 0.75, R = 1.2;
    const a0 = (205 * Math.PI) / 180, a1 = (-8 * Math.PI) / 180;
    const N = 40;
    const outer = [], inner = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = lerp(a0, a1, t);
      const w = 0.42 * Math.pow(1 - t, 0.9) + 0.015;
      outer.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]);
      inner.push([cx + Math.cos(a) * (R - w), cy + Math.sin(a) * (R - w)]);
    }
    for (const p of outer) pts.push(p);
    for (let i = inner.length - 1; i >= 0; i--) pts.push(inner[i]);
    const s = new THREE.Shape();
    s.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.045, bevelSegments: 2 });
    geo.translate(0, 0, -0.06);
    geo.rotateY(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }

  buildLimbs() {
    const M = this.mats;
    const seg = (r0, r1, len, mat) => {
      const geo = new THREE.CylinderGeometry(r1, r0, len, 8).rotateX(Math.PI / 2).translate(0, 0, len / 2);
      const m = new THREE.Mesh(geo, mat);
      m.userData.len = len;
      m.castShadow = true;
      this.limbs.add(m);
      return m;
    };
    const joint = (r, mat) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r * S, 10, 8), mat);
      m.castShadow = true;
      this.limbs.add(m);
      return m;
    };
    this.arm = {};
    for (const side of ['R', 'L']) {
      this.arm[side] = {
        upper: seg(0.22, 0.14, 1.65, M.armor),
        fore: seg(0.12, 0.17, 1.75, M.armor),
        elbow: joint(0.17, M.armor),
        hand: joint(0.15, M.armor),
        shoulderLocal: new THREE.Vector3(side === 'R' ? -0.82 : 0.82, 2.0, 0.1),
      };
    }
    this.legs = [];
    for (const side of [-1, 1]) {
      const leg = {
        side,
        thigh: seg(0.32, 0.17, 1.95, M.armor),
        shin: seg(0.17, 0.05, 2.05, M.armor),
        knee: joint(0.21, M.armor),
        claw: new THREE.Mesh(new THREE.ConeGeometry(0.1 * S, 0.7 * S, 5).rotateX(Math.PI / 2).translate(0, 0, 0.3 * S), M.armor),
        kneeSpike: new THREE.Mesh(new THREE.ConeGeometry(0.07 * S, 0.6 * S, 5).rotateX(-Math.PI / 2 - 0.6).translate(0, 0.18 * S, 0.25 * S), M.armor),
        foot: new THREE.Vector3(),
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        stepping: false,
        t: 0,
      };
      leg.claw.castShadow = true;
      this.limbs.add(leg.claw);
      leg.knee.add(leg.kneeSpike);
      this.legs.push(leg);
    }
  }

  buildSpear() {
    const M = this.mats;
    const sp = (this.spear = new THREE.Group());
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, SPEAR_FRONT + SPEAR_BACK - 1.6, 8).rotateX(Math.PI / 2), M.shaft);
    shaft.position.z = (SPEAR_FRONT - 1.6 - SPEAR_BACK) / 2;
    sp.add(shaft);
    // Blade: flattened diamond
    const bladeProfile = [[0, 0], [0.26, 0.28], [0.34, 0.55], [0.15, 1.3], [0, 1.8]].map(([r, y]) => new THREE.Vector2(r, y));
    const bladeGeo = new THREE.LatheGeometry(bladeProfile, 4);
    bladeGeo.rotateY(Math.PI / 4);
    bladeGeo.scale(1, 1, 0.22);
    bladeGeo.rotateX(Math.PI / 2);
    const blade = new THREE.Mesh(bladeGeo, M.spearMetal);
    blade.position.z = SPEAR_FRONT - 1.8;
    sp.add(blade);
    // Crossguard hooks
    for (const side of [-1, 1]) {
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.045, 6, 12, Math.PI * 0.8), M.gold);
      hook.position.set(side * 0.28, 0, SPEAR_FRONT - 1.75);
      hook.rotation.set(0, Math.PI / 2, side > 0 ? 0.3 : Math.PI - 0.3);
      sp.add(hook);
    }
    for (const z of [SPEAR_FRONT - 1.85, 0.6, -0.9, -SPEAR_BACK + 0.4]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8).rotateX(Math.PI / 2), M.gold);
      ring.position.z = z;
      sp.add(ring);
    }
    // Butt crescent
    const butt = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.06, 6, 16, Math.PI * 0.9), M.spearMetal);
    butt.position.z = -SPEAR_BACK + 0.2;
    butt.rotation.set(0, Math.PI / 2, Math.PI * 0.55);
    butt.scale.set(1, 1, 0.6);
    sp.add(butt);
    sp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    sp.scale.setScalar(S);
    this.game.scene.add(sp);
  }

  // ---------------------------------------------------------------- lifecycle
  reset() {
    this.pos = new THREE.Vector3(0, 0, -6);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.difficulty = this.game.difficulty || 'normal';
    this.maxHp = this.difficulty === 'hard' ? 2400 : 2000;
    this.hp = this.maxHp;
    this.phase = 1;
    this.alive = true;
    this.active = false;
    this.airborne = false;
    this.flash = 0;
    this.staggerDmg = 0;
    this.pendingStagger = false;
    this.pendingPhase = false;
    this.uninterruptible = false;
    this.airPressure = 0;
    this.lastAttack = '';
    this.phaseGlow = 0;
    this.deathT = -1;
    this.pose = { ...POSES.dormant };
    this.poseTarget = POSES.dormant;
    this.poseRate = 5;
    this.co = null;
    for (const h of this.hazards) h.dispose();
    this.hazards.length = 0;
    this.mats.cloth.emissiveIntensity = 0;
    this.mats.eye.emissiveIntensity = 0;
    this.light.intensity = 0;
    this.bobT = 0;
    this.setVisible(this.shown);
    this.updateSkeleton(0, true);
    for (const leg of this.legs) {
      leg.foot.copy(this.idealFoot(leg, this.v1));
      leg.stepping = false;
    }
    this.updateSkeleton(0, true);
    this.cape.build(this.capeAnchors, new THREE.Vector3(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI)).multiplyScalar(0.15));
    this.prevGrip.copy(this.gripW);
    this.prevTip.copy(this.tipW);
  }

  get spd() {
    return (this.phase === 2 ? 1.2 : 1) * (this.difficulty === 'hard' ? 1.08 : 1);
  }

  // Silksong-style: heavy blows take two masks (always on hard, in phase two on normal).
  dmg(heavy) {
    if (this.difficulty === 'hard') return heavy || this.phase === 2 ? 2 : 1;
    return heavy && this.phase === 2 ? 2 : 1;
  }

  fwd(out = this.v3) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  aimPoint() {
    return this.torso.localToWorld(new THREE.Vector3(0, 1.5, 0));
  }

  setPose(name, rate = 6) {
    this.poseTarget = POSES[name];
    this.poseRate = rate;
  }

  /** Start the fight (called after the intro). */
  awaken() {
    this.active = true;
    this.co = this.introSeq();
  }

  // ---------------------------------------------------------------- damage
  receiveHit(center, r) {
    if (!this.alive) return null;
    let best = null;
    let bestD = Infinity;
    for (const c of this.capsules) {
      const d = distPointSegment(center, c.a, c.b, this.v1) - c.r;
      if (d < r && d < bestD) {
        bestD = d;
        // Point on the capsule surface facing the attack.
        const n = this.v2.subVectors(center, this.v1);
        const len = n.length() || 1;
        best = { point: this.v1.clone().addScaledVector(n, c.r / len) };
      }
    }
    return best;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    const g = this.game;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 1;
    g.hud.bossHp(this.hp / this.maxHp);
    if (this.hp <= 0) {
      this.die();
      return;
    }
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2;
      this.pendingPhase = true;
      this.pendingStagger = false;
      return;
    }
    if (!this.uninterruptible) {
      this.staggerDmg += amount;
      if (this.staggerDmg >= (this.difficulty === 'hard' ? 520 : 440)) {
        this.staggerDmg = 0;
        this.pendingStagger = true;
      }
    }
  }

  die() {
    const g = this.game;
    this.alive = false;
    this.hp = 0;
    this.co = this.deathSeq();
    this.hazards.forEach((h) => h.dispose());
    this.hazards.length = 0;
    g.onBossDeath();
  }

  pushOut(p, r) {
    if (!this.alive) return;
    if (p.y > this.pos.y + (this.pose.hipH + 0.6) * S) return;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const R = 1.0 * S + r;
    if (d < R && d > 1e-4) {
      p.x = this.pos.x + (dx / d) * R;
      p.z = this.pos.z + (dz / d) * R;
    }
  }

  // ---------------------------------------------------------------- helpers
  *wait(t, fn) {
    let e = 0;
    while (e < t) {
      const dt = yield;
      e += dt;
      if (fn && fn(dt, Math.min(1, e / t), e) === true) return;
    }
  }

  playerDist() {
    const p = this.game.player.pos;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  faceToward(target, rate, dt) {
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw = turnToward(this.yaw, want, rate * dt);
  }

  clampArena(margin = 1.8) {
    const r = Math.hypot(this.pos.x, this.pos.z);
    const max = ARENA_RADIUS - margin;
    if (r > max) { this.pos.x *= max / r; this.pos.z *= max / r; }
  }

  brake(dt, k = 6) {
    this.vel.x = damp(this.vel.x, 0, k, dt);
    this.vel.z = damp(this.vel.z, 0, k, dt);
  }

  glint(size = 3.2) {
    const g = this.game;
    g.fx.glint(() => this.tipW.clone().addScaledVector(this.dirW, -0.6), { size, dur: 0.42 });
    g.audio.play('glint');
  }

  /** Swept spear-vs-player test (between last frame and this frame). */
  hitSpear(heavy, fromShaft = 2.2, r = 0.42) {
    const pl = this.game.player;
    for (let i = 0; i <= 2; i++) {
      const k = i / 2;
      const grip = this.v1.lerpVectors(this.prevGrip, this.gripW, k);
      const tip = this.v2.lerpVectors(this.prevTip, this.tipW, k);
      const dir = this.v3.subVectors(tip, grip).normalize();
      const a = grip.clone().addScaledVector(dir, fromShaft);
      if (pl.hitBySegment(a, tip, r)) {
        if (pl.takeDamage(this.dmg(heavy), this.pos)) {
          this.game.fx.sparkBurst(pl.center, { count: 14, color: [1, 0.5, 0.4], speed: 14 });
        }
        return true;
      }
    }
    return false;
  }

  hitBody(heavy, r = 1.3) {
    const pl = this.game.player;
    const c = this.aimPoint();
    const low = this.v1.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
    if (pl.hitBySegment(low, c, r)) pl.takeDamage(this.dmg(heavy), this.pos);
  }

  predictPlayer(t) {
    const p = this.game.player;
    const out = p.pos.clone().addScaledVector(p.vel, t);
    out.y = 0;
    const r = Math.hypot(out.x, out.z);
    const max = ARENA_RADIUS - 1;
    if (r > max) { out.x *= max / r; out.z *= max / r; }
    return out;
  }

  // ---------------------------------------------------------------- behaviour
  *introSeq() {
    const g = this.game;
    this.setPose('dormant', 2);
    yield* this.wait(0.6);
    this.setPose('idle', 1.8);
    g.audio.play('step', { pitch: 0.7 });
    yield* this.wait(1.2, (dt) => this.faceToward(g.player.pos, 1.5, dt));
    this.setPose('roar', 5);
    yield* this.wait(0.35);
    g.audio.play('roar');
    g.cam.shake(1.0);
    g.ambient.blast(1);
    g.fx.ring(this.pos, { r0: 1, r1: 16, dur: 1.0, color: [1, 0.8, 0.7], width: 0.12 });
    g.showTitle();
    yield* this.wait(1.5, () => { g.cam.shake(0.25); });
    this.setPose('idle', 3);
    yield* this.wait(0.5);
    g.onIntroDone();
    yield* this.brain();
  }

  *brain() {
    while (true) {
      yield* this.stalk(rand(0.35, 1.0) / this.spd);
      const atk = this.chooseAttack();
      this.lastAttack = atk;
      yield* this[atk]();
    }
  }

  chooseAttack() {
    const d = this.playerDist();
    if (this.airPressure > 0.45 && d < 7 && (this.lastAttack !== 'atkRise' || Math.random() < 0.5)) return 'atkRise';
    const p2 = this.phase === 2;
    const opts = [];
    const add = (n, w) => { if (n !== this.lastAttack) opts.push([n, w]); };
    if (d < 4.5) {
      add('atkStomp', 2.6); add('atkSweep', 2.4); add('atkEvade', 1.6); add('atkTriple', 1);
      if (p2) { add('atkSpikes', 0.6); }
    } else if (d < 7) {
      add('atkSweep', 3); add('atkTriple', 2); add('atkLeap', 0.8); add('atkEvade', 0.8);
      if (p2) { add('atkCrescents', 1); add('atkSpikes', 0.6); }
    } else if (d < 13) {
      add('atkLunge', 3); add('atkTriple', 1.3); add('atkSpikes', 1.5); add('atkLeap', 1.5);
      if (p2) { add('atkCrescents', 2); add('atkDive', 1.6); }
    } else {
      add('atkLunge', 2.5); add('atkLeap', 2); add('atkSpikes', 2);
      if (p2) { add('atkDive', 2.2); add('atkCrescents', 2); }
    }
    let total = opts.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * total;
    for (const [n, w] of opts) { r -= w; if (r <= 0) return n; }
    return opts[0][0];
  }

  *stalk(dur) {
    const g = this.game;
    this.setPose('idle', 4);
    const strafe = Math.random() < 0.5 ? -1 : 1;
    const speed = this.phase === 2 ? 4.6 : 3.6;
    yield* this.wait(dur, (dt, k, e) => {
      const p = g.player.pos;
      this.faceToward(p, 3.5, dt);
      const d = this.playerDist();
      const f = this.fwd();
      let tx = 0, tz = 0;
      if (d > 10) { tx = f.x * speed; tz = f.z * speed; }
      else if (d < 4.5) { tx = -f.x * speed * 0.8; tz = -f.z * speed * 0.8; }
      else { tx = f.z * strafe * speed * 0.6; tz = -f.x * strafe * speed * 0.6; }
      this.vel.x = damp(this.vel.x, tx, 4, dt);
      this.vel.z = damp(this.vel.z, tz, 4, dt);
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.clampArena();
      return e > 0.25 && (d < 3.2 || this.airPressure > 0.45);
    });
  }

  *atkLunge(chained = false) {
    const g = this.game;
    const s = this.spd;
    this.setPose('lungeWind', 7);
    let glinted = false;
    yield* this.wait((chained ? 0.45 : 0.72) / s, (dt, k) => {
      this.faceToward(g.player.pos, 6, dt);
      this.brake(dt);
      this.pos.addScaledVector(this.vel, dt);
      if (k > 0.3 && !glinted) { glinted = true; this.glint(); }
    });
    this.setPose('lungeStrike', 24);
    g.audio.play('lunge');
    const dir = this.fwd(new THREE.Vector3());
    const start = this.pos.clone();
    const dist = clamp(this.playerDist() + 3.5, 7, 16);
    const T = 0.42;
    yield* this.wait(T, (dt, k) => {
      const e = 1 - Math.pow(1 - k, 2.2);
      this.pos.set(start.x + dir.x * dist * e, 0, start.z + dir.z * dist * e);
      this.clampArena();
      this.hitSpear(true, 1.0);
      this.hitBody(false, 1.0);
      if (Math.random() < 0.9) {
        const t = this.tipW;
        g.fx.glow.spawn(t.x, t.y, t.z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 1, 0.4, 0.35, 0.5, 0.3, 0, 1);
      }
    });
    this.vel.set(0, 0, 0);
    if (this.phase === 2 && Math.random() < 0.55 && this.playerDist() < 7) {
      yield* this.atkSweep(true);
      return;
    }
    this.setPose('idle', 3);
    yield* this.wait(0.6 / s);
  }

  *atkSweep(chained = false) {
    const g = this.game;
    const s = this.spd;
    this.setPose('sweepWind', chained ? 12 : 7);
    let glinted = false;
    yield* this.wait((chained ? 0.35 : 0.6) / s, (dt, k) => {
      this.faceToward(g.player.pos, 6, dt);
      this.brake(dt);
      if (k > 0.35 && !glinted) { glinted = true; this.glint(2.6); }
    });
    g.audio.play('bossSwing', { pitch: 0.8 });
    const origin = this.pos.clone();
    origin.y = 0.7;
    g.fx.slash({ origin, yaw: this.yaw, pitch: 0.05, radius: 8.4, a0: -2.2, a1: 2.3, dur: 0.42, color: [1, 0.18, 0.22], thick: 0.22, trail: 0.9, white: 0.25, intensity: 0.8 });
    const T = 0.34;
    const pose = { ...POSES.sweepWind };
    this.poseTarget = pose;
    this.poseRate = 60;
    yield* this.wait(T, (dt, k) => {
      const e = easeInOutSine(k);
      const sy = lerp(-2.25, 2.3, e);
      pose.sy = sy;
      pose.twist = lerp(-0.9, 0.9, e);
      pose.gx = Math.sin(sy) * 1.25;
      pose.gz = Math.cos(sy) * 1.25;
      pose.gy = 1.1;
      pose.sp = -0.12;
      this.hitSpear(false, 0.3, 0.32);
    });
    this.setPose('idle', 3);
    yield* this.wait(0.6 / s);
  }

  *atkTriple() {
    const g = this.game;
    const s = this.spd;
    for (let i = 0; i < 3; i++) {
      this.setPose('stabWind', 14);
      let glinted = false;
      yield* this.wait((i === 0 ? 0.55 : 0.28) / s, (dt, k) => {
        this.faceToward(g.player.pos, 8, dt);
        if (i === 0 && k > 0.4 && !glinted) { glinted = true; this.glint(2.4); }
      });
      // Aim each thrust at the heroine: pull the grip in and angle down when she is close.
      const d = this.playerDist();
      const pose = { ...POSES.stabStrike };
      pose.gz = clamp((d - 1.2) / S, 0.2, 1.8);
      const gh = pose.gy * S + (pose.hipH - 2.5) * S;
      pose.sp = -clamp(Math.atan2(gh - 0.6, Math.max(0.4, d - pose.gz * S + 0.6)), 0.12, 1.2);
      this.poseTarget = pose;
      this.poseRate = 32;
      g.audio.play('bossSwing', { pitch: 1.35, gap: 0.01 });
      const dir = this.fwd(new THREE.Vector3());
      yield* this.wait(0.17, (dt) => {
        this.pos.addScaledVector(dir, 11 * dt);
        this.clampArena();
        this.hitSpear(false, 0.4);
      });
    }
    this.setPose('idle', 3);
    yield* this.wait(0.55 / s);
  }

  // Anti-air: a rising spear arc that punishes pogo-dancing above the boss.
  *atkRise() {
    const g = this.game;
    const s = this.spd;
    this.airPressure = 0;
    this.setPose('crouch', 12);
    let glinted = false;
    yield* this.wait(0.34 / s, (dt, k) => {
      this.brake(dt);
      this.faceToward(g.player.pos, 8, dt);
      if (k > 0.2 && !glinted) { glinted = true; this.glint(2.6); }
    });
    g.audio.play('bossSwing', { pitch: 1.1 });
    const pose = { ...POSES.raise, hipH: 3.3, lean: -0.15, gx: -0.6, gz: 1.0 };
    this.poseTarget = pose;
    this.poseRate = 60;
    const origin = this.aimPoint();
    g.fx.slash({ origin, yaw: this.yaw, roll: Math.PI / 2, radius: 7.5, a0: -0.5, a1: 1.75, dur: 0.36, color: [1, 0.2, 0.25], thick: 0.25, trail: 0.9, white: 0.3, intensity: 0.9 });
    yield* this.wait(0.26, (dt, k) => {
      const e = easeOutCubic(k);
      pose.sp = lerp(-0.35, 1.4, e);
      pose.gy = lerp(2.0, 4.4, e);
      this.faceToward(g.player.pos, 3, dt);
      this.hitSpear(false, 0.3, 0.5);
    });
    this.setPose('idle', 3);
    yield* this.wait(0.55 / s);
  }

  *atkStomp() {
    const g = this.game;
    const s = this.spd;
    this.setPose('raise', 10);
    let glinted = false;
    yield* this.wait(0.45 / s, (dt, k) => {
      this.brake(dt);
      this.faceToward(g.player.pos, 3, dt);
      if (k > 0.3 && !glinted) { glinted = true; this.glint(2.8); }
    });
    this.setPose('plant', 30);
    yield* this.wait(0.08);
    this.impact(0.7);
    g.fx.ring(this.pos, { r0: 0.8, r1: 4.4, dur: 0.3, color: [1, 0.45, 0.35], width: 0.35 });
    g.fx.burst(this.v1.set(this.pos.x, 0.3, this.pos.z), { count: 30, color: [1, 0.35, 0.3], speed: 10, size: 0.4, life: 0.5, gravity: 4, up: 1 });
    const pl = g.player;
    if (Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) < 4.4 && pl.pos.y < 1.8) pl.takeDamage(this.dmg(false), this.pos);
    this.hazards.push(new Shockwave(this, this.pos, { speed: 12, maxR: 9, heavy: false, height: 0.6 }));
    yield* this.wait(0.75 / s);
    this.setPose('idle', 3);
    yield* this.wait(0.25);
  }

  *atkEvade() {
    const g = this.game;
    this.setPose('crouch', 12);
    yield* this.wait(0.2 / this.spd, (dt) => this.brake(dt));
    const back = this.fwd(new THREE.Vector3()).negate();
    const start = this.pos.clone();
    this.airborne = true;
    this.uninterruptible = true;
    g.audio.play('bossSwing', { pitch: 0.7 });
    g.fx.burst(this.pos, { count: 14, color: [0.5, 0.4, 0.4], speed: 5, size: 0.6, life: 0.5, gravity: 0, up: 1 });
    this.setPose('diveAir', 8);
    yield* this.wait(0.45, (dt, k) => {
      const e = easeOutCubic(k);
      this.pos.set(start.x + back.x * 7 * e, Math.sin(Math.PI * k) * 2.6, start.z + back.z * 7 * e);
      this.clampArena();
      this.faceToward(g.player.pos, 8, dt);
    });
    this.pos.y = 0;
    this.airborne = false;
    this.uninterruptible = false;
    g.audio.play('step', { pitch: 0.8 });
    const next = this.phase === 2 && Math.random() < 0.5 ? 'atkCrescents' : Math.random() < 0.6 ? 'atkLunge' : 'atkSpikes';
    yield* this[next](true);
  }

  *atkLeap() {
    const g = this.game;
    const s = this.spd;
    this.setPose('crouch', 8);
    yield* this.wait(0.45 / s, (dt) => { this.faceToward(g.player.pos, 5, dt); this.brake(dt); });
    g.audio.play('bossSwing', { pitch: 0.6 });
    g.fx.burst(this.pos, { count: 16, color: [0.5, 0.4, 0.4], speed: 5, size: 0.6, life: 0.6, gravity: 0, up: 1 });
    this.airborne = true;
    this.uninterruptible = true;
    const start = this.pos.clone();
    const target = this.predictPlayer(0.5);
    this.setPose('raise', 6);
    yield* this.wait(0.55, (dt, k) => {
      this.pos.y = 10 * easeOutCubic(k);
      this.pos.x = lerp(start.x, target.x, k * 0.7);
      this.pos.z = lerp(start.z, target.z, k * 0.7);
      this.faceToward(g.player.pos, 4, dt);
    });
    this.setPose('slamAir', 10);
    const marker = this.makeMarker();
    yield* this.wait(0.32 / s, (dt) => {
      const pp = g.player.pos;
      target.x = damp(target.x, pp.x, 3, dt);
      target.z = damp(target.z, pp.z, 3, dt);
      this.pos.x = damp(this.pos.x, target.x, 6, dt);
      this.pos.z = damp(this.pos.z, target.z, 6, dt);
      marker.position.set(target.x, 0.05, target.z);
      marker.material.opacity = 0.6 + Math.sin(g.time * 30) * 0.3;
      this.faceToward(pp, 4, dt);
    });
    const y0 = this.pos.y;
    const sx = this.pos.x, sz = this.pos.z;
    yield* this.wait(0.14, (dt, k) => {
      this.pos.y = y0 * (1 - easeInCubic(k));
      this.pos.x = lerp(sx, target.x, k);
      this.pos.z = lerp(sz, target.z, k);
      this.hitSpear(true, 0.5);
    });
    g.scene.remove(marker);
    marker.material.dispose();
    this.pos.y = 0;
    this.airborne = false;
    this.clampArena();
    this.impact(1.0);
    const pl = g.player;
    if (Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) < 3.2 && pl.pos.y < 2.5) pl.takeDamage(this.dmg(true), this.pos);
    this.hazards.push(new Shockwave(this, this.pos, { speed: 13, maxR: 17, heavy: true }));
    this.setPose('plant', 20);
    this.uninterruptible = false;
    yield* this.wait(0.9 / s);
    this.setPose('idle', 3);
    yield* this.wait(0.3);
  }

  *atkSpikes() {
    const g = this.game;
    const s = this.spd;
    this.setPose('raise', 6);
    let glinted = false;
    yield* this.wait(0.6 / s, (dt, k) => {
      this.faceToward(g.player.pos, 4, dt);
      this.brake(dt);
      if (k > 0.4 && !glinted) { glinted = true; this.glint(3.5); }
    });
    this.setPose('plant', 28);
    yield* this.wait(0.1);
    this.impact(0.5);
    const n = this.phase === 2 ? 7 : 5;
    for (let i = 0; i < n; i++) {
      const target = this.predictPlayer(0.3);
      this.hazards.push(new SpikeTrap(this, target, 0.62 / s));
      g.audio.play('spikeWarn');
      yield* this.wait(0.32 / s);
    }
    // Final ring of spikes around the boss in phase two.
    if (this.phase === 2) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        this.hazards.push(new SpikeTrap(this, new THREE.Vector3(this.pos.x + Math.cos(a) * 3, 0, this.pos.z + Math.sin(a) * 3), 0.7 / s));
      }
    }
    yield* this.wait(0.55);
    this.setPose('idle', 3);
    yield* this.wait(0.35 / s);
  }

  *atkCrescents() {
    const g = this.game;
    const s = this.spd;
    this.setPose('throwWind', 8);
    let glinted = false;
    yield* this.wait(0.55 / s, (dt, k) => {
      this.faceToward(g.player.pos, 5, dt);
      this.brake(dt);
      if (k > 0.4 && !glinted) { glinted = true; this.glint(3); }
    });
    this.setPose('throwStrike', 25);
    g.audio.play('crescent');
    g.audio.play('bossSwing');
    const origin = this.pos.clone();
    origin.y = 1.25;
    g.fx.slash({ origin: origin.clone().setY(2.2), yaw: this.yaw, roll: -0.3, radius: 4, a0: -1.8, a1: 1.6, dur: 0.3, color: [1, 0.3, 0.2], thick: 0.4, white: 0.3 });
    const f = this.fwd(new THREE.Vector3());
    for (const a of [-0.42, 0, 0.42]) {
      const d = f.clone().applyAxisAngle(UP, a);
      this.hazards.push(new Crescent(this, origin.clone().addScaledVector(d, 1.5), d, 19));
    }
    yield* this.wait(0.75 / s);
    this.setPose('idle', 3);
    yield* this.wait(0.3);
  }

  *atkDive() {
    const g = this.game;
    const s = this.spd;
    this.setPose('crouch', 9);
    yield* this.wait(0.35 / s, (dt) => { this.faceToward(g.player.pos, 5, dt); this.brake(dt); });
    g.audio.play('bossSwing', { pitch: 0.5 });
    this.airborne = true;
    this.uninterruptible = true;
    const back = this.fwd(new THREE.Vector3()).negate();
    const start = this.pos.clone();
    this.setPose('diveAir', 6);
    yield* this.wait(0.5, (dt, k) => {
      this.pos.y = 11 * easeOutCubic(k);
      this.pos.x = start.x + back.x * 3 * k;
      this.pos.z = start.z + back.z * 3 * k;
      this.clampArena();
      this.faceToward(g.player.pos, 6, dt);
    });
    let glinted = false;
    const pose = { ...POSES.diveAir };
    this.poseTarget = pose;
    this.poseRate = 10;
    yield* this.wait(0.42 / s, (dt, k) => {
      this.faceToward(g.player.pos, 8, dt);
      const dx = g.player.pos.x - this.pos.x, dz = g.player.pos.z - this.pos.z;
      pose.sp = -Math.atan2(this.pos.y + 2.5, Math.hypot(dx, dz));
      if (k > 0.3 && !glinted) { glinted = true; this.glint(3.2); }
    });
    const target = this.predictPlayer(0.15);
    const dir = new THREE.Vector3(target.x - this.pos.x, -this.pos.y, target.z - this.pos.z).normalize();
    g.audio.play('lunge', { pitch: 1.2 });
    let guard = 0;
    while (this.pos.y > 0 && guard < 2) {
      const dt = yield;
      guard += dt;
      this.pos.addScaledVector(dir, 38 * dt);
      this.hitSpear(true, 0.5);
      this.hitBody(true, 1.0);
      if (Math.random() < 0.9) g.fx.glow.spawn(this.pos.x, this.pos.y + 3, this.pos.z, 0, 2, 0, 1, 0.3, 0.3, 0.8, 0.3, 0, 1);
    }
    this.pos.y = 0;
    this.airborne = false;
    this.clampArena();
    this.impact(0.8);
    this.hazards.push(new Shockwave(this, this.pos, { speed: 12, maxR: 8, heavy: false, height: 0.7 }));
    this.uninterruptible = false;
    this.setPose('plant', 20);
    yield* this.wait(0.8 / s);
    this.setPose('idle', 3);
    yield* this.wait(0.3);
  }

  *phaseSeq() {
    const g = this.game;
    this.uninterruptible = true;
    this.hazards.forEach((h) => h.dispose());
    this.hazards.length = 0;
    this.pos.y = 0;
    this.setPose('crouch', 6);
    yield* this.wait(0.5);
    this.setPose('roar', 6);
    yield* this.wait(0.25);
    g.audio.play('roar');
    g.onBossPhase2();
    g.ambient.blast(1.5);
    g.cam.shake(1.4);
    // Knock the player back (no damage).
    const pl = g.player;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 9 && !pl.dead) {
      pl.vel.set((dx / d) * 16, 7, (dz / d) * 16);
      pl.pos.y = Math.max(pl.pos.y, 0.01);
      pl.onGround = false;
    }
    for (let i = 0; i < 3; i++) g.fx.ring(this.pos, { r0: 1, r1: 14 + i * 4, dur: 0.8 + i * 0.3, color: [1, 0.35, 0.25], width: 0.15 });
    yield* this.wait(1.8, (dt) => {
      g.cam.shake(0.2);
      this.phaseGlow = Math.min(1, this.phaseGlow + dt * 0.8);
      const c = this.aimPoint();
      g.fx.burst(c, { count: 2, color: [1, 0.4, 0.2], speed: 6, size: 0.4, life: 0.8, gravity: -2 });
    });
    this.uninterruptible = false;
    this.staggerDmg = 0;
    this.setPose('idle', 3);
    yield* this.wait(0.3);
    yield* this.brain();
  }

  *staggerSeq() {
    const g = this.game;
    g.audio.play('stagger');
    g.cam.shake(0.4);
    g.fx.sparkBurst(this.aimPoint(), { count: 30, color: [1, 0.9, 0.7], speed: 16 });
    this.setPose('stagger', 7);
    this.vel.set(0, 0, 0);
    yield* this.wait(1.8);
    this.setPose('idle', 2.5);
    yield* this.wait(0.55);
    yield* this.brain();
  }

  *deathSeq() {
    const g = this.game;
    this.setPose('stagger', 8);
    this.pos.y = 0;
    this.airborne = false;
    yield* this.wait(1.4, (dt) => {
      if (Math.random() < 0.5) g.fx.sparkBurst(this.aimPoint(), { count: 3, color: [1, 0.9, 0.8], speed: 10 });
    });
    this.setPose('dead', 1.6);
    yield* this.wait(1.5);
    g.cam.shake(0.5);
    g.audio.play('step', { pitch: 0.5, vol: 1.5 });
    g.fx.burst(this.pos, { count: 30, color: [0.5, 0.4, 0.4], speed: 6, size: 0.7, life: 1.0, gravity: 0, up: 1 });
    while (true) {
      const dt = yield;
      this.deathT += dt;
    }
  }

  impact(strength) {
    const g = this.game;
    const tip = this.tipW.clone();
    tip.y = 0.1;
    g.audio.play('slam', { vol: strength });
    g.cam.shake(strength);
    g.ambient.blast(strength);
    g.fx.flash(this.v1.set(this.pos.x, 1, this.pos.z), 0xff8060, 60 * strength, 0.25, 16);
    g.fx.ring(tip, { r0: 0.5, r1: 6 * strength, dur: 0.4, color: [1, 0.7, 0.55], width: 0.3 });
    g.fx.burst(tip, { count: 30, color: [0.45, 0.35, 0.35], speed: 7, size: 0.8, life: 0.9, gravity: 0, up: 1.5, drag: 3 });
    g.fx.sparkBurst(tip, { count: 30, color: [1, 0.6, 0.35], speed: 18, dir: UP, spread: 1.2 });
  }

  makeMarker() {
    const m = new THREE.Mesh(this.trapRingGeo, new THREE.MeshBasicMaterial({ color: 0xff3040, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.scale.setScalar(2.2);
    this.game.scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game;
    if (this.active && this.co) {
      if (this.pendingPhase && !this.airborne && this.alive) {
        this.pendingPhase = false;
        this.uninterruptible = false;
        this.co = this.phaseSeq();
      } else if (this.pendingStagger && !this.airborne && !this.uninterruptible && this.alive) {
        this.pendingStagger = false;
        this.co = this.staggerSeq();
      }
      const r = this.co.next(dt);
      if (r.done) this.co = this.brain();
    }

    // How long the heroine has been hovering right above us (pogo pressure).
    const pl = g.player;
    const near = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) < 5;
    this.airPressure = near && pl.pos.y > 1.2 ? this.airPressure + dt : Math.max(0, this.airPressure - dt * 0.5);

    // Pose blending
    const tgt = this.poseTarget;
    const k = 1 - Math.exp(-this.poseRate * dt);
    for (const key of POSE_KEYS) this.pose[key] += (tgt[key] - this.pose[key]) * k;

    this.flash = Math.max(0, this.flash - dt * 7);
    this.updateSkeleton(dt);

    // Hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      if (!this.hazards[i].update(dt)) this.hazards.splice(i, 1);
    }

    // Materials: hit flash + phase glow
    const f = this.flash;
    this.mats.armor.emissive.setRGB(f * 0.22, f * 0.2, f * 0.2);
    this.mats.gold.emissive.setRGB(f * 0.18, f * 0.15, f * 0.12);
    this.mats.bone.emissiveIntensity = f * 0.35;
    const pg = this.phaseGlow;
    this.mats.cloth.emissiveIntensity = pg * (1.2 + Math.sin(g.time * 5) * 0.3);
    this.mats.eye.emissiveIntensity = pg * 6;
    this.light.intensity = pg * 30;
    this.light.position.copy(this.aimPoint());
    if (pg > 0.2 && this.alive && Math.random() < 0.6) {
      const i = Math.floor(Math.random() * this.cape.p.length / 3);
      const p = this.cape.p;
      g.fx.glow.spawn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], rand(-0.5, 0.5), rand(0.5, 2), rand(-0.5, 0.5), 1, rand(0.3, 0.6), 0.15, 0.25, 1.2, -0.5, 0.5);
    }
    if (!this.alive && this.deathT >= 0) {
      this.phaseGlow = Math.max(0, this.phaseGlow - dt * 0.5);
    }
  }

  idealFoot(leg, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = leg.side * 0.75 * S, lz = (0.2 + (leg.side > 0 ? 0.15 : -0.1) * (this.pose.hipH < 2.6 ? 3 : 1)) * S;
    out.set(this.pos.x + lx * c + lz * s, 0, this.pos.z - lx * s + lz * c);
    out.x += this.vel.x * 0.12;
    out.z += this.vel.z * 0.12;
    return out;
  }

  updateSkeleton(dt, snap = false) {
    const pose = this.pose;
    this.prevGrip.copy(this.gripW);
    this.prevTip.copy(this.tipW);

    this.bobT += dt * (1 + Math.hypot(this.vel.x, this.vel.z));
    const breathe = Math.sin(this.bobT * 2.0) * 0.05;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.hips.position.y = pose.hipH + breathe;
    this.torso.rotation.set(pose.lean + breathe * 0.3, pose.twist, 0);
    this.head.rotation.x = pose.head;
    this.group.updateMatrixWorld(true);

    // Spear
    const gl = this.v1.set(pose.gx, pose.gy + breathe, pose.gz);
    this.gripW.copy(gl).applyMatrix4(this.group.matrixWorld);
    const cp = Math.cos(pose.sp);
    this.dirW.set(Math.sin(pose.sy) * cp, Math.sin(pose.sp), Math.cos(pose.sy) * cp).applyAxisAngle(UP, this.yaw).normalize();
    this.tipW.copy(this.gripW).addScaledVector(this.dirW, TIP);
    // Keep the spear from sinking into the floor.
    if (this.tipW.y < -0.4 && !snap) {
      const push = -0.4 - this.tipW.y;
      this.gripW.y += push * 0.2;
      this.dirW.y += push / TIP;
      this.dirW.normalize();
      this.tipW.copy(this.gripW).addScaledVector(this.dirW, TIP);
    }
    this.spear.position.copy(this.gripW);
    this.spear.quaternion.setFromUnitVectors(ZAXIS, this.dirW);
    if (snap) { this.prevGrip.copy(this.gripW); this.prevTip.copy(this.tipW); }

    // Arms (IK)
    const right = this.v2.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    for (const side of ['R', 'L']) {
      const A = this.arm[side];
      const sh = this.torso.localToWorld(this.v3.copy(A.shoulderLocal));
      let target;
      if (side === 'R') target = this.gripW.clone();
      else if (pose.lh > 0.5) target = this.torso.localToWorld(new THREE.Vector3(2.2, 1.9, 0.9));
      else target = this.gripW.clone().addScaledVector(this.dirW, -1.5);
      const pole = new THREE.Vector3().copy(right).multiplyScalar(side === 'R' ? 1 : -1).add({ x: 0, y: -0.6, z: 0 });
      pole.addScaledVector(this.fwd(new THREE.Vector3()), -0.5);
      solveTwoBone(sh, target, 1.65 * S, 1.75 * S, pole, this.mid, this.end);
      this.placeLimb(A.upper, sh, this.mid);
      this.placeLimb(A.fore, this.mid, this.end);
      A.elbow.position.copy(this.mid);
      A.hand.position.copy(this.end);
    }

    // Legs with procedural stepping
    const fwd = this.fwd(new THREE.Vector3());
    const hipW = new THREE.Vector3();
    for (const leg of this.legs) {
      hipW.copy(this.hips.localToWorld(this.v3.set(leg.side * 0.5, 0, -0.05)));
      if (this.airborne || this.pos.y > 0.2) {
        const tuck = this.v1.copy(this.pos);
        tuck.y = this.pos.y + 0.6 * S;
        tuck.addScaledVector(right, -leg.side * 0.7 * S).addScaledVector(fwd, (leg.side > 0 ? 0.9 : -0.3) * S);
        leg.foot.lerp(tuck, snap ? 1 : 1 - Math.exp(-14 * dt));
        leg.stepping = false;
      } else {
        const ideal = this.idealFoot(leg, this.v1);
        const other = this.legs.find((l) => l !== leg);
        const dist = Math.hypot(leg.foot.x - ideal.x, leg.foot.z - ideal.z);
        if (snap) { leg.foot.copy(ideal); }
        else if (!leg.stepping && (dist > 1.1 || (dist > 0.35 && Math.hypot(this.vel.x, this.vel.z) < 0.2 && !other.stepping)) && !other.stepping) {
          leg.stepping = true;
          leg.t = 0;
          leg.from.copy(leg.foot);
          leg.from.y = Math.max(0, leg.from.y);
          leg.to.copy(ideal);
        } else if (dist > 5) {
          leg.foot.copy(ideal);
          leg.stepping = false;
        }
        if (leg.stepping) {
          const spd = Math.hypot(this.vel.x, this.vel.z);
          leg.t += dt / clamp(0.24 - spd * 0.006, 0.12, 0.24);
          leg.to.copy(ideal);
          const t = Math.min(1, leg.t);
          leg.foot.lerpVectors(leg.from, leg.to, easeInOutSine(t));
          leg.foot.y = Math.sin(Math.PI * t) * 0.7;
          if (t >= 1) {
            leg.stepping = false;
            leg.foot.y = 0;
            if (this.active && this.alive) this.game.audio.play('step', { vol: 0.4, pitch: rand(0.9, 1.1), gap: 0.08 });
          }
        } else {
          leg.foot.y = Math.max(0, leg.foot.y - dt * 8);
        }
      }
      const pole = this.v2.copy(fwd).addScaledVector(right, -leg.side * 0.3);
      pole.y = 0.2;
      solveTwoBone(hipW, leg.foot, 1.95 * S, 2.05 * S, pole, this.mid, this.end);
      this.placeLimb(leg.thigh, hipW, this.mid);
      this.placeLimb(leg.shin, this.mid, this.end);
      leg.knee.position.copy(this.mid);
      leg.knee.lookAt(this.end);
      leg.claw.position.copy(this.end);
      leg.claw.rotation.set(0.2, this.yaw + leg.side * 0.15, 0);
    }

    // Hurt capsules
    const C = this.capsules;
    C[0].a.copy(this.hips.localToWorld(this.v1.set(0, -0.6, 0)));
    C[0].b.copy(this.torso.localToWorld(this.v1.set(0, 1.9, 0)));
    C[0].r = 0.95 * S;
    C[1].a.copy(this.head.localToWorld(this.v1.set(0, -0.4, 0.1)));
    C[1].b.copy(this.head.localToWorld(this.v1.set(0, 0.4, 0)));
    C[1].r = 0.6 * S;
    for (let i = 0; i < 2; i++) {
      const leg = this.legs[i];
      C[2 + i * 2].a.copy(leg.thigh.position);
      C[2 + i * 2].b.copy(leg.knee.position);
      C[2 + i * 2].r = 0.45 * S;
      C[3 + i * 2].a.copy(leg.knee.position);
      C[3 + i * 2].b.copy(leg.claw.position);
      C[3 + i * 2].r = 0.38 * S;
    }

    // Cape
    for (let i = 0; i < this.capeAnchorsLocal.length; i++) {
      this.capeAnchors[i].copy(this.capeAnchorsLocal[i]);
      this.torso.localToWorld(this.capeAnchors[i]);
    }
    if (!snap) {
      const wind = this.v1.set(-this.vel.x * 3 + 3, 0, -this.vel.z * 3 + 2);
      const cols = [
        { a: C[0].a, b: C[0].b, r: 1.05 * S },
        { a: this.legs[0].thigh.position, b: this.legs[0].knee.position, r: 0.42 * S },
        { a: this.legs[1].thigh.position, b: this.legs[1].knee.position, r: 0.42 * S },
      ];
      this.cape.step(this.capeAnchors, cols, wind, dt);
    }
  }

  placeLimb(mesh, a, b) {
    mesh.position.copy(a);
    mesh.lookAt(b);
    mesh.scale.set(S, S, Math.max(0.01, a.distanceTo(b) / mesh.userData.len));
  }
}

