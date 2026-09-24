import * as THREE from 'three';
import {
  clamp, damp, lerp, rand, turnToward, easeOutCubic, easeInOutSine,
  distPointSegment, solveTwoBone, canvasTexture, mulberry32,
} from './utils.js';
import { ARENA_RADIUS } from './arena.js';
import { Shockwave, Cloth } from './boss.js';

// The Drowned Abbess: a colossal hunched figure gliding through the flooded
// nave. Wet striped robes, a lace veil (cloth sim), porcelain face with closed
// weeping eyes, a crown of thorns and a tall staff crowned with a rusted bell.

const UP = new THREE.Vector3(0, 1, 0);
const STAFF_UP = 6.5;   // grip -> bell end
const STAFF_DOWN = 4.8; // grip -> butt
const WATER_RING = [0.55, 0.9, 1.0];
const WATER_DUST = [0.75, 0.95, 1.0];

// Local frame: +Z forward, -X is her right. g* = staff grip, sy/sp = staff "up"
// direction (sp = pitch from forward-horizontal), l* = left hand target.
const BASE = { lean: 0.42, bow: 0.45, sink: 0, gx: -1.9, gy: 4.3, gz: 1.1, sy: 0.05, sp: 1.42, lx: 0.5, ly: 4.5, lz: 1.6 };
const P = (o) => ({ ...BASE, ...o });
const POSES = {
  idle: P({}),
  dormant: P({ lean: 0.95, bow: 1.0, sink: -1.4, lx: 0.4, ly: 3.2, lz: 1.8 }),
  tollRaise: P({ lean: 0.15, bow: -0.1, gx: -1.6, gy: 6.6, gz: 1.2, sp: 1.45, lx: 1.8, ly: 6.4, lz: 1.4 }),
  tollStrike: P({ lean: 0.5, bow: 0.5, gx: -1.9, gy: 4.6, gz: 1.5, sp: 1.38, lx: 0.8, ly: 4.8, lz: 1.6 }),
  slamWind: P({ lean: 0.05, bow: -0.15, gx: -1.0, gy: 7.4, gz: -0.4, sy: 0, sp: 2.3, lx: 0.6, ly: 6.8, lz: 0.2 }),
  slamStrike: P({ lean: 0.75, bow: 0.6, gx: -0.7, gy: 4.2, gz: 2.8, sy: 0, sp: -0.72, lx: 0.4, ly: 4.0, lz: 2.6 }),
  tideWind: P({ lean: 0.3, bow: 0.3, lx: 3.0, ly: 3.4, lz: -0.8 }),
  tideStrike: P({ lean: 0.55, bow: 0.45, lx: -1.0, ly: 2.2, lz: 3.4 }),
  sleeveWind: P({ lean: 0.5, bow: 0.4, lx: 3.2, ly: 2.2, lz: 0.4 }),
  hands: P({ lean: 0.2, bow: 0.2, lx: 1.2, ly: 6.8, lz: 1.8 }),
  tears: P({ lean: -0.05, bow: -0.7, gx: -2.4, gy: 5.0, lx: 2.4, ly: 6.0, lz: 0.8 }),
  submerge: P({ lean: 0.9, bow: 0.9, sink: -10.5 }),
  roar: P({ lean: -0.15, bow: -0.75, gx: -2.6, gy: 6.4, gz: 0.8, sp: 1.2, lx: 3.0, ly: 7.2, lz: 1.0 }),
  stagger: P({ lean: 0.95, bow: 0.95, sink: -1.6, gx: -2.2, gy: 3.2, gz: 2.2, sp: 0.9, lx: 1.2, ly: 1.6, lz: 2.4 }),
  dead: P({ lean: 1.05, bow: 1.1, sink: -7.5, gx: -2.4, gy: 1.5, gz: 2.5, sp: 0.2, lx: 1.4, ly: 0.8, lz: 2.4 }),
};
const KEYS = Object.keys(BASE);

// ------------------------------------------------------------------ textures
function robeTexture() {
  const rnd = mulberry32(31);
  return canvasTexture(512, 512, (g, w, h) => {
    const cols = ['#0d1316', '#18343a', '#35575a', '#5e111c', '#23272c', '#10262b', '#2c4a4d', '#471019'];
    let x = 0;
    while (x < w) {
      const sw = 14 + rnd() * 42;
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.fillRect(x, 0, sw + 1, h);
      // Diamond lace pattern on some strips.
      if (rnd() < 0.45) {
        g.strokeStyle = `rgba(190,215,212,${0.1 + rnd() * 0.15})`;
        g.lineWidth = 1.5;
        for (let y = 0; y < h; y += sw) {
          g.beginPath();
          g.moveTo(x + sw / 2, y); g.lineTo(x + sw, y + sw / 2); g.lineTo(x + sw / 2, y + sw); g.lineTo(x, y + sw / 2); g.closePath();
          g.stroke();
        }
      }
      x += sw;
    }
    // Wet streaks running down.
    for (let i = 0; i < 70; i++) {
      g.strokeStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '160,200,205'},${0.05 + rnd() * 0.12})`;
      g.lineWidth = 1 + rnd() * 4;
      const sx = rnd() * w;
      g.beginPath();
      g.moveTo(sx, rnd() * h * 0.5);
      g.lineTo(sx + (rnd() - 0.5) * 8, h);
      g.stroke();
    }
    const dark = g.createLinearGradient(0, 0, 0, h);
    dark.addColorStop(0, 'rgba(0,0,0,0)');
    dark.addColorStop(1, 'rgba(0,10,12,0.55)');
    g.fillStyle = dark;
    g.fillRect(0, 0, w, h);
  }, { repeat: true });
}

function laceTexture() {
  const rnd = mulberry32(8);
  return canvasTexture(256, 512, (g, w, h) => {
    g.fillStyle = 'rgba(232,240,240,1)';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    // Lace: rows of holes and diamonds.
    for (let y = 10; y < h - 20; y += 16) {
      const off = (Math.floor(y / 16) % 2) * 8;
      for (let x = off; x < w; x += 16) {
        g.beginPath();
        if ((x + y) % 48 < 16) { g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath(); }
        else g.arc(x, y, 3.2 + rnd() * 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Rips and a scalloped, torn hem.
    for (let i = 0; i < 10; i++) {
      g.beginPath();
      g.ellipse(rnd() * w, h * (0.3 + rnd() * 0.6), 4 + rnd() * 10, 10 + rnd() * 30, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 12) g.lineTo(x, h - 18 - Math.abs(Math.sin(x * 0.26)) * 16 - rnd() * 40);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'source-over';
  });
}

function faceTextures() {
  const draw = (tearsOnly) => (g, w, h) => {
    if (!tearsOnly) {
      const rg = g.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h * 0.5, w * 0.6);
      rg.addColorStop(0, '#f3f4f1');
      rg.addColorStop(1, '#c9cdca');
      g.fillStyle = rg;
      g.fillRect(0, 0, w, h);
      // Fine crackle in the porcelain.
      const rnd = mulberry32(4);
      g.strokeStyle = 'rgba(80,90,90,0.18)';
      g.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        let x = rnd() * w, y = rnd() * h;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 30; y += rnd() * 20; g.lineTo(x, y); }
        g.stroke();
      }
      // Closed eyes (downturned arcs with lashes), brows, nose, lips.
      g.strokeStyle = '#2a2d2f';
      g.lineWidth = 4;
      for (const s of [-1, 1]) {
        const ex = w / 2 + s * 52, ey = h * 0.47;
        g.beginPath(); g.arc(ex, ey - 12, 30, 0.25 * Math.PI, 0.75 * Math.PI); g.stroke();
        g.lineWidth = 2;
        for (let k = 0; k < 5; k++) {
          const a = (0.3 + k * 0.1) * Math.PI;
          g.beginPath();
          g.moveTo(ex + Math.cos(a) * 30, ey - 12 + Math.sin(a) * 30);
          g.lineTo(ex + Math.cos(a) * 38, ey - 12 + Math.sin(a) * 38);
          g.stroke();
        }
        g.lineWidth = 2.5;
        g.strokeStyle = 'rgba(60,60,60,0.5)';
        g.beginPath(); g.arc(ex, ey + 10, 44, 1.2 * Math.PI, 1.8 * Math.PI); g.stroke();
        g.strokeStyle = '#2a2d2f';
        g.lineWidth = 4;
      }
      g.strokeStyle = 'rgba(70,70,70,0.45)';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(w / 2, h * 0.5); g.lineTo(w / 2 - 6, h * 0.64); g.lineTo(w / 2 + 4, h * 0.66); g.stroke();
      g.strokeStyle = 'rgba(120,70,75,0.6)';
      g.beginPath(); g.moveTo(w / 2 - 20, h * 0.76); g.quadraticCurveTo(w / 2, h * 0.78, w / 2 + 20, h * 0.76); g.stroke();
    } else {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
    }
    // Tears: dark streaks with a gilded edge.
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x0 = w / 2 + s * (40 + k * 12);
        g.strokeStyle = tearsOnly ? '#ff2a2a' : k === 1 ? 'rgba(150,110,50,0.8)' : 'rgba(40,20,22,0.85)';
        g.lineWidth = k === 1 ? 3 : 5;
        g.beginPath();
        g.moveTo(x0, h * 0.5);
        g.bezierCurveTo(x0 + s * 4, h * 0.65, x0 - s * 6, h * 0.8, x0 + s * 3, h * (0.95 + k * 0.02));
        g.stroke();
      }
    }
  };
  return { map: canvasTexture(256, 256, draw(false)), emissive: canvasTexture(256, 256, draw(true)) };
}

// ------------------------------------------------------------------ hazards
const TIDE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const TIDE_FRAG = /* glsl */ `
  uniform float uFade;
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float foam = smoothstep(0.72, 1.0, vUv.y + sin(vUv.x * 60.0 + uTime * 8.0) * 0.05);
    float edge = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
    vec3 col = mix(uColor, vec3(0.9, 1.0, 1.0), foam);
    gl_FragColor = vec4(col, (0.55 + foam * 0.45) * edge * uFade);
  }
`;

/** A curved wall of water rolling outward in a sector. Jump it or dash through. */
class TideWave {
  constructor(boss, origin, yaw, { halfAngle = 1.0, speed = 9.5, height = 1.5, maxR = 24 } = {}) {
    this.boss = boss;
    this.o = origin.clone();
    this.yaw = yaw;
    this.half = halfAngle;
    this.r = 2.5;
    this.speed = speed;
    this.height = height;
    this.maxR = maxR;
    this.hit = false;
    this.t = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: TIDE_VERT,
      fragmentShader: TIDE_FRAG,
      uniforms: { uFade: { value: 1 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.25, 0.55, 0.62) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // Theta 0 of CylinderGeometry points along +Z, like our yaw; centre the sector on it.
    const geo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true, -halfAngle, halfAngle * 2).translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(this.o.x, 0.1, this.o.z);
    this.mesh.rotation.y = yaw;
    this.mesh.scale.set(this.r, height, this.r);
    boss.game.scene.add(this.mesh);
  }

  update(dt) {
    const g = this.boss.game;
    this.t += dt;
    this.r += this.speed * dt;
    const k = this.r / this.maxR;
    const rise = Math.min(1, this.t / 0.25);
    this.mesh.scale.set(this.r, this.height * rise, this.r);
    this.mat.uniforms.uFade.value = Math.min(1, (1 - k) * 3);
    this.mat.uniforms.uTime.value = this.t;
    const pl = g.player;
    if (!this.hit && pl.pos.y < this.height * 0.85) {
      const dx = pl.pos.x - this.o.x, dz = pl.pos.z - this.o.z;
      const d = Math.hypot(dx, dz);
      const ang = Math.atan2(dx, dz);
      let da = Math.abs(((ang - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      if (Math.abs(d - this.r) < 0.7 && da < this.half) {
        if (pl.takeDamage(this.boss.dmg(false), this.o)) this.hit = true;
      }
    }
    // Spray along the crest.
    for (let i = 0; i < 2; i++) {
      const a = this.yaw + rand(-this.half, this.half);
      g.fx.glow.spawn(this.o.x + Math.sin(a) * this.r, this.height * rise, this.o.z + Math.cos(a) * this.r,
        Math.sin(a) * 2, rand(1, 3), Math.cos(a) * 2, 0.8, 0.95, 1, 0.3, 0.5, 6, 0.5);
    }
    if (k >= 1) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.boss.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/** Pale drowned arms bursting from the water after a ripple warning. */
class DrownedHands {
  constructor(boss, pos, delay) {
    this.boss = boss;
    this.p = pos.clone();
    this.p.y = 0;
    this.delay = delay;
    this.t = 0;
    this.radius = 1.3;
    this.hitDone = false;
    this.group = new THREE.Group();
    this.group.position.copy(this.p);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x9fe8f4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ring = new THREE.Mesh(boss.trapRingGeo, this.ringMat);
    this.ring.position.y = 0.24;
    this.group.add(this.ring);
    this.arms = [];
    const n = 4;
    for (let i = 0; i < n; i++) {
      const arm = new THREE.Group();
      const a = (i / n) * Math.PI * 2 + rand(-0.4, 0.4);
      const r = i === 0 ? 0.1 : rand(0.45, 0.95);
      arm.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      arm.rotation.set(rand(-0.35, 0.35), rand(0, 6.28), rand(-0.35, 0.35));
      arm.add(new THREE.Mesh(boss.armGeo, boss.mats.drowned));
      const hand = new THREE.Mesh(boss.handGeo, boss.mats.drowned);
      hand.position.y = 1.9;
      arm.add(hand);
      arm.userData.h = rand(0.8, 1.15);
      arm.scale.set(1, 0.001, 1);
      this.group.add(arm);
      this.arms.push(arm);
    }
    boss.game.scene.add(this.group);
  }

  update(dt) {
    const g = this.boss.game;
    this.t += dt;
    if (this.t < this.delay) {
      const k = this.t / this.delay;
      this.ringMat.opacity = 0.3 + 0.5 * Math.abs(Math.sin(this.t * 14));
      this.ring.scale.setScalar(lerp(0.3, 1, easeOutCubic(Math.min(1, k * 1.5))));
      if (Math.random() < 0.3) g.fx.glow.spawn(this.p.x + rand(-1, 1), 0.25, this.p.z + rand(-1, 1), 0, rand(0.5, 1.5), 0, 0.7, 0.95, 1, 0.2, 0.4, 0, 1);
      return true;
    }
    const e = this.t - this.delay;
    if (!this.erupted) {
      this.erupted = true;
      this.ringMat.opacity = 0;
      g.audio.play('splash', { gap: 0.03, vol: 0.8 });
      g.fx.burst(new THREE.Vector3(this.p.x, 0.3, this.p.z), { count: 24, color: WATER_DUST, speed: 6, size: 0.35, life: 0.7, gravity: 14, up: 5 });
      g.fx.ring(this.p, { r0: 0.3, r1: 2.4, dur: 0.5, color: WATER_RING, width: 0.2, y: 0.24 });
    }
    const grow = Math.min(1, e / 0.12);
    const shrink = e > 0.75 ? Math.max(0, 1 - (e - 0.75) / 0.35) : 1;
    for (const a of this.arms) {
      a.scale.set(1, Math.max(0.001, a.userData.h * easeOutCubic(grow) * shrink), 1);
      a.rotation.y += dt * 0.6;
    }
    if (!this.hitDone && e < 0.25) {
      const pl = g.player;
      const d = Math.hypot(pl.pos.x - this.p.x, pl.pos.z - this.p.z);
      if (d < this.radius + 0.25 && pl.pos.y < 2.0) {
        if (pl.takeDamage(this.boss.dmg(false), this.p)) this.hitDone = true;
      }
    }
    if (e > 1.2) { this.dispose(); return false; }
    return true;
  }

  dispose() {
    this.boss.game.scene.remove(this.group);
    this.ringMat.dispose();
  }
}

/** A heavy tear falling from high above, marked by a shrinking circle. */
class TearDrop {
  constructor(boss, pos, delay) {
    this.boss = boss;
    this.p = pos.clone();
    this.delay = delay;
    this.t = 0;
    this.fall = 0.55;
    this.markMat = new THREE.MeshBasicMaterial({ color: boss.phase === 2 ? 0xff4050 : 0x9fe8f4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mark = new THREE.Mesh(boss.trapRingGeo, this.markMat);
    this.mark.position.set(this.p.x, 0.25, this.p.z);
    this.mark.scale.setScalar(0.7);
    this.drop = new THREE.Mesh(boss.dropGeo, boss.phase === 2 ? boss.mats.bloodTear : boss.mats.tear);
    this.drop.visible = false;
    boss.game.scene.add(this.mark, this.drop);
  }

  update(dt) {
    const g = this.boss.game;
    this.t += dt;
    const lead = this.t - this.delay;
    if (lead < 0) return true;
    const k = lead / this.fall;
    this.markMat.opacity = 0.25 + 0.45 * k;
    this.mark.scale.setScalar(lerp(1.3, 0.75, k));
    if (k < 1) {
      this.drop.visible = true;
      this.drop.position.set(this.p.x, lerp(18, 0.3, k * k), this.p.z);
      return true;
    }
    g.audio.play('drip', { gap: 0.03 });
    g.fx.burst(new THREE.Vector3(this.p.x, 0.3, this.p.z), { count: 12, color: this.boss.phase === 2 ? [1, 0.35, 0.35] : WATER_DUST, speed: 4, size: 0.3, life: 0.5, gravity: 14, up: 4 });
    g.fx.ring(this.p, { r0: 0.2, r1: 1.8, dur: 0.4, color: WATER_RING, width: 0.25, y: 0.24 });
    const pl = g.player;
    if (Math.hypot(pl.pos.x - this.p.x, pl.pos.z - this.p.z) < 1.0 && pl.pos.y < 1.6) pl.takeDamage(this.boss.dmg(false), this.p);
    this.dispose();
    return false;
  }

  dispose() {
    this.boss.game.scene.remove(this.mark, this.drop);
    this.markMat.dispose();
  }
}

// ------------------------------------------------------------------ boss
export class Abbess {
  constructor(game) {
    this.game = game;
    this.id = 'abbess';
    this.arena = 'drowned';
    this.music = { p1: 'drowned', p2: 'drowned' };
    this.title = { small: 'Хозяйка Затонувшего Собора', big: 'НАСТОЯТЕЛЬНИЦА' };
    this.hudName = 'Утопленная Настоятельница';

    const face = faceTextures();
    this.mats = {
      robe: new THREE.MeshStandardMaterial({ map: robeTexture(), roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
      lace: new THREE.MeshStandardMaterial({ map: laceTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5, transparent: true, opacity: 0.88, emissive: 0xbfe6ee, emissiveIntensity: 0.22 }),
      face: new THREE.MeshStandardMaterial({ map: face.map, emissiveMap: face.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.28 }),
      hood: new THREE.MeshStandardMaterial({ color: 0x0c1417, roughness: 0.7 }),
      bone: new THREE.MeshStandardMaterial({ color: 0xe4e6e1, roughness: 0.45 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x5c3b2a, roughness: 0.62, metalness: 0.75, emissive: 0xff2030, emissiveIntensity: 0 }),
      bell: new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.45, metalness: 0.85, envMapIntensity: 1.2 }),
      ribbon: new THREE.MeshStandardMaterial({ color: 0x8e1424, roughness: 0.7, side: THREE.DoubleSide }),
      drowned: new THREE.MeshStandardMaterial({ color: 0xa9bcbc, roughness: 0.6, emissive: 0x2a4a50, emissiveIntensity: 0.4 }),
      tear: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1.6, 1.9) }),
      bloodTear: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.35, 0.35) }),
    };
    this.flashMats = [this.mats.robe, this.mats.bone, this.mats.face];

    this.robeUniforms = { uTime: { value: 0 } };
    this.mats.robe.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.robeUniforms.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        float sway = clamp(1.0 - position.y / 4.0, 0.0, 1.0);
        transformed.x += sin(uTime * 1.3 + position.y * 1.7 + position.z) * 0.12 * sway;
        transformed.z += cos(uTime * 1.1 + position.y * 1.3 + position.x) * 0.12 * sway;`);
    };

    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.limbs = new THREE.Group();
    game.scene.add(this.limbs);
    this.buildBody();
    this.buildArms();
    this.buildStaff();

    // Shared hazard assets
    this.waveGeo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true).translate(0, 0.5, 0);
    this.trapRingGeo = new THREE.RingGeometry(1.2, 1.38, 48).rotateX(-Math.PI / 2);
    this.armGeo = new THREE.CylinderGeometry(0.1, 0.14, 1.9, 7).translate(0, 0.95, 0);
    this.handGeo = (() => {
      const parts = [new THREE.BoxGeometry(0.28, 0.32, 0.1)];
      for (let i = 0; i < 4; i++) {
        const f = new THREE.CylinderGeometry(0.03, 0.022, 0.38, 5).translate(0, 0.19, 0);
        f.rotateZ((i - 1.5) * 0.28);
        f.translate((i - 1.5) * 0.07, 0.14, 0);
        parts.push(f);
      }
      return mergeAll(parts);
    })();
    this.dropGeo = new THREE.SphereGeometry(0.22, 10, 8).scale(1, 2.6, 1);

    this.light = new THREE.PointLight(0x9fe0f0, 0, 14, 1.8);
    game.scene.add(this.light);

    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.mid = new THREE.Vector3();
    this.end = new THREE.Vector3();
    this.gripW = new THREE.Vector3();
    this.dirW = new THREE.Vector3(0, 1, 0);
    this.bellW = new THREE.Vector3();
    this.buttW = new THREE.Vector3();
    this.handLW = new THREE.Vector3();
    this.elbowLW = new THREE.Vector3();
    this.prevBell = new THREE.Vector3();
    this.capsules = [0, 1, 2].map(() => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 1 }));
    this.hazards = [];
    this.shown = true;
    this.reset();
  }

  // ---------------------------------------------------------------- model
  buildBody() {
    const M = this.mats;
    const skirtProfile = [[2.45, -1.2], [2.35, 0], [2.1, 1.3], [1.75, 2.6], [1.45, 3.5], [1.3, 3.9]].map(([r, y]) => new THREE.Vector2(r, y));
    const skirt = new THREE.Mesh(new THREE.LatheGeometry(skirtProfile, 28), M.robe);
    skirt.castShadow = true;
    this.group.add(skirt);

    const spine = (this.spine = new THREE.Group());
    spine.position.y = 3.6;
    spine.rotation.order = 'YXZ';
    this.group.add(spine);
    const torsoProfile = [[1.32, 0], [1.28, 1.2], [1.38, 2.2], [1.15, 2.6], [0.55, 2.95], [0.4, 3.1]].map(([r, y]) => new THREE.Vector2(r, y));
    const torso = new THREE.Mesh(new THREE.LatheGeometry(torsoProfile, 24), M.robe);
    torso.scale.set(1, 1, 0.8);
    torso.castShadow = true;
    spine.add(torso);

    const head = (this.head = new THREE.Group());
    head.position.set(0, 3.1, 0.55);
    head.scale.setScalar(1.35);
    spine.add(head);
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.66, 18, 14), M.hood);
    hood.position.set(0, 0.12, -0.18);
    hood.scale.set(1, 1.08, 1.05);
    head.add(hood);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.56, 26, 20, Math.PI / 2 - 1.0, 2.0, 0.35, 2.2), M.face);
    face.scale.set(0.82, 1.12, 0.78);
    face.position.set(0, -0.02, 0.1);
    face.castShadow = true;
    head.add(face);
    // Crown of thorns
    const crown = new THREE.Group();
    crown.position.set(0, 0.46, -0.05);
    crown.rotation.x = -0.25;
    crown.add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 28).rotateX(Math.PI / 2), M.rust));
    crown.add(new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.03, 5, 28).rotateX(Math.PI / 2 + 0.2), M.rust));
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.22 + (i % 3) * 0.1, 4), M.rust);
      sp.position.set(Math.sin(a) * 0.56, 0.08, Math.cos(a) * 0.56);
      sp.rotation.set(Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6);
      crown.add(sp);
    }
    head.add(crown);

    // Lace veil: anchored around the crown, from ear to ear over the back.
    this.veil = new Cloth(13, 15, M.lace);
    this.veil.mesh.castShadow = false;
    this.game.scene.add(this.veil.mesh);
    this.veilAnchorsLocal = [];
    // From beside the face, over the crown and back: the sides drape in front of the shoulders.
    for (let i = 0; i < 13; i++) {
      const a = lerp(-2.35, 2.35, i / 12);
      const side = Math.abs(Math.sin(a));
      this.veilAnchorsLocal.push(new THREE.Vector3(Math.sin(a) * 0.66, 0.42 - side * 0.3 - Math.max(0, -Math.cos(a)) * 0.25, -Math.cos(a) * 0.58 + 0.08));
    }
    this.veilAnchors = this.veilAnchorsLocal.map((v) => v.clone());
  }

  buildArms() {
    const M = this.mats;
    const seg = (r0, r1, len, mat, open = false) => {
      const geo = new THREE.CylinderGeometry(r1, r0, len, 12, 1, open).rotateX(Math.PI / 2).translate(0, 0, len / 2);
      const m = new THREE.Mesh(geo, mat);
      m.userData.len = len;
      m.castShadow = true;
      this.limbs.add(m);
      return m;
    };
    const hand = (curl) => {
      const g = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.42).translate(0, 0, 0.21), M.bone);
      g.add(palm);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Group();
        f.position.set((i - 1.5) * 0.085, 0, 0.42);
        f.rotation.x = curl;
        f.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.55, 5).rotateX(Math.PI / 2).translate(0, 0, 0.27), M.bone));
        g.add(f);
      }
      const thumb = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.022, 0.35, 5).rotateX(Math.PI / 2).translate(0, 0, 0.17), M.bone);
      thumb.position.set(0.17, 0, 0.12);
      thumb.rotation.y = 0.7;
      g.add(thumb);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.limbs.add(g);
      return g;
    };
    this.arm = {
      R: { upper: seg(0.34, 0.3, 2.4, M.robe), fore: seg(0.3, 0.55, 2.4, M.robe, true), hand: hand(1.2), shoulder: new THREE.Vector3(-1.15, 2.55, 0.15) },
      L: { upper: seg(0.34, 0.3, 2.4, M.robe), fore: seg(0.3, 0.55, 2.4, M.robe, true), hand: hand(0.35), shoulder: new THREE.Vector3(1.15, 2.55, 0.15) },
    };
  }

  buildStaff() {
    const M = this.mats;
    const st = (this.staff = new THREE.Group());
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, STAFF_UP + STAFF_DOWN, 8), M.rust);
    shaft.position.y = (STAFF_UP - STAFF_DOWN) / 2;
    st.add(shaft);
    for (const y of [-2.5, 0.4, 2.8, 4.4]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.14, 8), M.rust);
      ring.position.y = y;
      st.add(ring);
    }
    // Gothic finial with small spires and a cross.
    const top = STAFF_UP;
    const fin = new THREE.Group();
    fin.position.y = top;
    fin.add(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.5, 6).translate(0, -0.25, 0).rotateX(Math.PI), M.rust));
    fin.add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.4, 6).translate(0, 0.7, 0), M.rust));
    for (const s of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.8, 5).translate(0, 0.4, 0), M.rust);
      sp.position.set(s * 0.32, -0.1, 0);
      fin.add(sp);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), M.rust);
      arm.position.set(s * 0.17, -0.1, 0);
      fin.add(arm);
    }
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), M.rust);
    crossV.position.y = 1.6;
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.06), M.rust);
    crossH.position.y = 1.68;
    fin.add(crossV, crossH);
    st.add(fin);
    // Bell on a crossbar below the finial.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08), M.rust);
    bar.position.set(-0.45, top - 0.75, 0);
    st.add(bar);
    const bellPivot = (this.bellPivot = new THREE.Group());
    bellPivot.position.set(-0.85, top - 0.78, 0);
    st.add(bellPivot);
    const bellProfile = [[0.02, 0], [0.18, -0.05], [0.3, -0.25], [0.34, -0.6], [0.5, -0.9], [0.56, -0.98], [0.5, -1.0]].map(([r, y]) => new THREE.Vector2(r, y));
    const bell = new THREE.Mesh(new THREE.LatheGeometry(bellProfile, 20), M.bell);
    bell.material.side = THREE.DoubleSide;
    bellPivot.add(bell);
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), M.rust);
    clapper.position.y = -0.85;
    bellPivot.add(clapper);
    this.ribbons = [];
    for (let i = 0; i < 3; i++) {
      const rb = new THREE.Group();
      rb.position.set((i - 1) * 0.3, -0.95, (i % 2) * 0.2 - 0.1);
      const len = 1.4 + i * 0.35;
      rb.add(new THREE.Mesh(new THREE.PlaneGeometry(0.12, len).translate(0, -len / 2, 0), M.ribbon));
      bellPivot.add(rb);
      this.ribbons.push(rb);
    }
    st.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.game.scene.add(st);
    this.bellAng = 0;
    this.bellVel = 0;
  }

  // ---------------------------------------------------------------- lifecycle
  setVisible(v) {
    this.shown = v;
    this.group.visible = this.limbs.visible = this.staff.visible = this.veil.mesh.visible = v;
    this.light.visible = v;
  }

  reset() {
    this.pos = new THREE.Vector3(0, 0, -7);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.difficulty = this.game.difficulty || 'normal';
    this.maxHp = this.difficulty === 'hard' ? 2900 : 2500;
    this.hp = this.maxHp;
    this.phase = 1;
    this.alive = true;
    this.active = false;
    this.airborne = false;
    this.uninterruptible = false;
    this.submerged = false;
    this.flash = 0;
    this.staggerDmg = 0;
    this.pendingStagger = false;
    this.pendingPhase = false;
    this.lastAttack = '';
    this.phaseGlow = 0;
    this.airPressure = 0;
    this.deathT = -1;
    this.pose = { ...POSES.dormant };
    this.poseTarget = POSES.dormant;
    this.poseRate = 5;
    this.co = null;
    this.wakeT = 0;
    for (const h of this.hazards) h.dispose();
    this.hazards.length = 0;
    this.mats.face.emissiveIntensity = 0;
    this.mats.rust.emissiveIntensity = 0;
    this.light.intensity = 0;
    this.setVisible(this.shown);
    this.updateSkeleton(0);
    this.veil.build(this.veilAnchors, new THREE.Vector3(Math.sin(this.yaw + Math.PI), 0, Math.cos(this.yaw + Math.PI)).multiplyScalar(0.3));
    this.prevBell.copy(this.bellW);
  }

  get spd() {
    return (this.phase === 2 ? 1.2 : 1) * (this.difficulty === 'hard' ? 1.08 : 1);
  }

  dmg(heavy) {
    if (this.difficulty === 'hard') return heavy || this.phase === 2 ? 2 : 1;
    return heavy && this.phase === 2 ? 2 : 1;
  }

  fwd(out = this.v3) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  aimPoint() {
    return this.spine.localToWorld(new THREE.Vector3(0, 1.6, 0.3));
  }

  setPose(name, rate = 6) {
    this.poseTarget = POSES[name];
    this.poseRate = rate;
  }

  awaken() {
    this.active = true;
    this.co = this.introSeq();
  }

  // ---------------------------------------------------------------- damage
  receiveHit(center, r) {
    if (!this.alive || this.submerged || this.pose.sink < -4) return null;
    let best = null, bestD = Infinity;
    for (const c of this.capsules) {
      const d = distPointSegment(center, c.a, c.b, this.v1) - c.r;
      if (d < r && d < bestD) {
        bestD = d;
        const n = this.v2.subVectors(center, this.v1);
        const len = n.length() || 1;
        best = { point: this.v1.clone().addScaledVector(n, c.r / len) };
      }
    }
    return best;
  }

  takeDamage(amount) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 1;
    this.game.hud.bossHp(this.hp / this.maxHp);
    if (this.hp <= 0) { this.die(); return; }
    if (this.phase === 1 && this.hp <= this.maxHp * 0.5) {
      this.phase = 2;
      this.pendingPhase = true;
      this.pendingStagger = false;
      return;
    }
    if (!this.uninterruptible) {
      this.staggerDmg += amount;
      if (this.staggerDmg >= (this.difficulty === 'hard' ? 560 : 480)) {
        this.staggerDmg = 0;
        this.pendingStagger = true;
      }
    }
  }

  die() {
    this.alive = false;
    this.hp = 0;
    this.submerged = false;
    this.co = this.deathSeq();
    this.hazards.forEach((h) => h.dispose());
    this.hazards.length = 0;
    this.game.onBossDeath();
  }

  pushOut(p, r) {
    if (!this.alive || this.pose.sink < -4) return;
    if (p.y > 3.8) return;
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const R = 2.25 + r;
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

  clampArena(margin = 2.6) {
    const r = Math.hypot(this.pos.x, this.pos.z);
    const max = ARENA_RADIUS - margin;
    if (r > max) { this.pos.x *= max / r; this.pos.z *= max / r; }
  }

  glide(dt, tx, tz, accel = 2.5) {
    this.vel.x = damp(this.vel.x, tx, accel, dt);
    this.vel.z = damp(this.vel.z, tz, accel, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.clampArena();
  }

  brake(dt) { this.glide(dt, 0, 0, 4); }

  glint(at, size = 3.4) {
    this.game.fx.glint(() => (at === 'hand' ? this.handLW.clone() : this.bellW.clone()), { size, dur: 0.45 });
    this.game.audio.play('glint');
  }

  ringBell(strength = 1) {
    this.bellVel += 5 * strength * (Math.random() < 0.5 ? -1 : 1);
  }

  predictPlayer(t, jitter = 0) {
    const p = this.game.player;
    const out = p.pos.clone().addScaledVector(p.vel, t);
    out.x += rand(-jitter, jitter);
    out.z += rand(-jitter, jitter);
    out.y = 0;
    const r = Math.hypot(out.x, out.z);
    const max = ARENA_RADIUS - 1;
    if (r > max) { out.x *= max / r; out.z *= max / r; }
    return out;
  }

  splash(at, strength = 1) {
    const g = this.game;
    const p = this.v1.set(at.x, 0.3, at.z);
    g.fx.burst(p, { count: Math.round(30 * strength), color: WATER_DUST, speed: 7 * strength, size: 0.45, life: 0.9, gravity: 14, up: 6 * strength, drag: 1 });
    g.fx.ring(at, { r0: 0.4, r1: 5 * strength, dur: 0.6, color: WATER_RING, width: 0.2, y: 0.24 });
    g.fx.ring(at, { r0: 0.2, r1: 3 * strength, dur: 0.9, color: WATER_RING, width: 0.15, y: 0.24 });
  }

  // ---------------------------------------------------------------- behaviour
  *introSeq() {
    const g = this.game;
    this.setPose('dormant', 2);
    yield* this.wait(0.5);
    this.setPose('idle', 1.4);
    g.audio.play('splash', { vol: 0.8 });
    yield* this.wait(1.3, (dt) => this.faceToward(g.player.pos, 1.2, dt));
    this.setPose('tollRaise', 4);
    yield* this.wait(0.55);
    this.setPose('tollStrike', 14);
    yield* this.wait(0.12);
    this.ringBell(1.4);
    g.audio.play('bell');
    g.cam.shake(0.8);
    g.ambient.blast(0.8);
    this.splash(this.buttW, 1.2);
    g.showTitle();
    yield* this.wait(1.6, () => g.cam.shake(0.12));
    this.setPose('idle', 3);
    yield* this.wait(0.5);
    g.onIntroDone();
    yield* this.brain();
  }

  *brain() {
    while (true) {
      yield* this.stalk(rand(0.5, 1.2) / this.spd);
      const atk = this.chooseAttack();
      this.lastAttack = atk;
      yield* this[atk]();
    }
  }

  chooseAttack() {
    const d = this.playerDist();
    if (this.airPressure > 0.45 && d < 6 && (this.lastAttack !== 'atkGeyser' || Math.random() < 0.5)) return 'atkGeyser';
    const p2 = this.phase === 2;
    const opts = [];
    const add = (n, w) => { if (n !== this.lastAttack) opts.push([n, w]); };
    if (d < 5.5) {
      add('atkSleeve', 3); add('atkToll', 2); add('atkSubmerge', 1.2); add('atkHands', 1);
    } else if (d < 11) {
      add('atkSlam', 3); add('atkToll', 1.8); add('atkTide', 2); add('atkHands', 1.8);
      if (p2) add('atkTears', 2);
    } else {
      add('atkTide', 2.4); add('atkHands', 2); add('atkSubmerge', 2); add('atkSlam', 1);
      add('atkTears', p2 ? 2.5 : 0.8);
    }
    const total = opts.reduce((s, o) => s + o[1], 0);
    let r = Math.random() * total;
    for (const [n, w] of opts) { r -= w; if (r <= 0) return n; }
    return opts[0][0];
  }

  *stalk(dur) {
    const g = this.game;
    this.setPose('idle', 3);
    const strafe = Math.random() < 0.5 ? -1 : 1;
    const speed = this.phase === 2 ? 3.4 : 2.6;
    yield* this.wait(dur, (dt, k, e) => {
      this.faceToward(g.player.pos, 1.8, dt);
      const d = this.playerDist();
      const f = this.fwd();
      let tx = 0, tz = 0;
      if (d > 10) { tx = f.x * speed; tz = f.z * speed; }
      else if (d < 5) { tx = -f.x * speed * 0.8; tz = -f.z * speed * 0.8; }
      else { tx = f.z * strafe * speed * 0.5; tz = -f.x * strafe * speed * 0.5; }
      this.glide(dt, tx, tz);
      return e > 0.3 && (d < 3.8 || this.airPressure > 0.45);
    });
  }

  *atkToll() {
    const g = this.game;
    const s = this.spd;
    this.setPose('tollRaise', 3.5);
    let glinted = false;
    yield* this.wait(0.9 / s, (dt, k) => {
      this.brake(dt);
      this.faceToward(g.player.pos, 1.5, dt);
      if (k > 0.5 && !glinted) { glinted = true; this.glint('bell'); this.ringBell(0.6); }
    });
    this.setPose('tollStrike', 16);
    yield* this.wait(0.12);
    const n = this.phase === 2 ? 3 : 2;
    const at = this.buttW.clone();
    at.y = 0;
    for (let i = 0; i < n; i++) {
      this.ringBell(1.2);
      g.audio.play('bell', { gap: 0.05, vol: i === 0 ? 1 : 0.7 });
      g.cam.shake(0.45);
      this.splash(at, 0.9);
      this.hazards.push(new Shockwave(this, at, { speed: 10.5, maxR: 21, heavy: false, height: 0.85, color: [0.35, 0.8, 0.95], dust: WATER_DUST }));
      yield* this.wait(0.55 / s);
    }
    this.setPose('idle', 3);
    yield* this.wait(0.6 / s);
  }

  *atkSlam() {
    const g = this.game;
    const s = this.spd;
    const count = this.phase === 2 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      // Glide to put the heroine at bell's reach.
      yield* this.wait(i === 0 ? 0.5 : 0.2, (dt) => {
        this.faceToward(g.player.pos, 2.5, dt);
        const d = this.playerDist();
        const f = this.fwd();
        const want = clamp((d - 7.4) * 2.5, -4, 5);
        this.glide(dt, f.x * want, f.z * want, 5);
      });
      this.setPose('slamWind', i === 0 ? 5 : 8);
      const marker = this.makeMarker();
      let glinted = false;
      yield* this.wait((i === 0 ? 0.85 : 0.6) / s, (dt, k) => {
        this.brake(dt);
        this.faceToward(g.player.pos, 2.4, dt);
        const f = this.fwd();
        marker.position.set(this.pos.x + f.x * 7.9, 0.26, this.pos.z + f.z * 7.9);
        marker.material.opacity = 0.35 + Math.sin(g.time * 26) * 0.25 + k * 0.3;
        if (k > 0.55 && !glinted) { glinted = true; this.glint('bell'); }
      });
      this.setPose('slamStrike', 20);
      g.audio.play('bossSwing', { pitch: 0.6 });
      const impact = marker.position.clone();
      impact.y = 0;
      yield* this.wait(0.22, () => {
        if (g.player.hitBySphere(this.bellW, 1.0)) g.player.takeDamage(this.dmg(true), this.bellW);
      });
      g.scene.remove(marker);
      marker.material.dispose();
      this.ringBell(1.5);
      g.audio.play('bell', { vol: 0.8, gap: 0.05 });
      g.audio.play('slam', { vol: 0.7 });
      g.cam.shake(0.8);
      g.ambient.blast(0.8);
      this.splash(impact, 1.2);
      g.fx.flash(this.v1.set(impact.x, 1, impact.z), 0x9fe0f0, 40, 0.25, 14);
      const pl = g.player;
      if (Math.hypot(pl.pos.x - impact.x, pl.pos.z - impact.z) < 2.8 && pl.pos.y < 2.2) pl.takeDamage(this.dmg(true), impact);
      this.hazards.push(new Shockwave(this, impact, { speed: 9, maxR: 7, heavy: false, height: 0.6, color: [0.35, 0.8, 0.95], dust: WATER_DUST }));
      yield* this.wait((i < count - 1 ? 0.35 : 0.85) / s);
    }
    this.setPose('idle', 3);
    yield* this.wait(0.35);
  }

  *atkTide() {
    const g = this.game;
    const s = this.spd;
    this.setPose('tideWind', 4);
    let glinted = false;
    yield* this.wait(0.85 / s, (dt, k) => {
      this.brake(dt);
      this.faceToward(g.player.pos, 2, dt);
      if (k > 0.45 && !glinted) { glinted = true; this.glint('hand', 2.8); }
      // Water gathers in front of her.
      if (Math.random() < 0.8) {
        const a = this.yaw + rand(-1, 1);
        g.fx.glow.spawn(this.pos.x + Math.sin(a) * 3.2, 0.3, this.pos.z + Math.cos(a) * 3.2, -Math.sin(a) * 1.5, rand(0.5, 2), -Math.cos(a) * 1.5, 0.7, 0.95, 1, 0.35, 0.5, 2, 1);
      }
    });
    this.setPose('tideStrike', 8);
    g.audio.play('wave');
    this.hazards.push(new TideWave(this, this.pos, this.yaw, { halfAngle: 1.0, speed: 9.5 * s, height: 1.45 }));
    if (this.phase === 2) {
      yield* this.wait(0.75 / s);
      g.audio.play('wave', { vol: 0.8 });
      this.hazards.push(new TideWave(this, this.pos, this.yaw + (Math.random() < 0.5 ? 0.9 : -0.9), { halfAngle: 0.8, speed: 11, height: 1.45 }));
    }
    yield* this.wait(0.9 / s);
    this.setPose('idle', 3);
    yield* this.wait(0.3);
  }

  *atkHands() {
    const g = this.game;
    const s = this.spd;
    this.setPose('hands', 4);
    g.audio.play('choirHum');
    yield* this.wait(0.6 / s, (dt) => { this.brake(dt); this.faceToward(g.player.pos, 1.5, dt); });
    const n = this.phase === 2 ? 8 : 6;
    for (let i = 0; i < n; i++) {
      this.hazards.push(new DrownedHands(this, this.predictPlayer(0.35, i === 0 ? 0 : 0.9), 0.75 / s));
      yield* this.wait(0.3 / s, (dt) => this.brake(dt));
    }
    yield* this.wait(0.5);
    this.setPose('idle', 3);
    yield* this.wait(0.35 / s);
  }

  *atkSubmerge() {
    const g = this.game;
    const s = this.spd;
    this.uninterruptible = true;
    this.setPose('submerge', 1.8);
    g.audio.play('splash', { vol: 1.2 });
    yield* this.wait(1.3, (dt) => {
      this.brake(dt);
      if (Math.random() < 0.5) g.fx.glow.spawn(this.pos.x + rand(-2, 2), 0.3, this.pos.z + rand(-2, 2), 0, rand(1, 3), 0, 0.7, 0.95, 1, 0.3, 0.5, 4, 1);
    });
    this.submerged = true;
    // A wake of ripples hunts the heroine.
    const w = this.pos.clone();
    let ringT = 0;
    yield* this.wait(2.0 / s, (dt, k, e) => {
      const p = g.player.pos;
      const dx = p.x - w.x, dz = p.z - w.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.3) { w.x += (dx / d) * 7.5 * s * dt; w.z += (dz / d) * 7.5 * s * dt; }
      ringT -= dt;
      if (ringT <= 0) {
        ringT = 0.12;
        g.fx.ring(w, { r0: 0.3, r1: 1.8, dur: 0.6, color: WATER_RING, width: 0.25, y: 0.24 });
      }
      return e > 0.6 && d < 0.8;
    });
    // Bubbles, then she bursts up.
    const at = w.clone();
    yield* this.wait(0.55 / s, () => {
      g.fx.glow.spawn(at.x + rand(-1.5, 1.5), 0.3, at.z + rand(-1.5, 1.5), 0, rand(2, 5), 0, 0.8, 1, 1, 0.3, 0.4, 2, 0);
      if (Math.random() < 0.2) g.fx.ring(at, { r0: 0.2, r1: 2.5, dur: 0.4, color: WATER_RING, width: 0.3, y: 0.24 });
    });
    this.pos.set(at.x, 0, at.z);
    this.clampArena();
    this.faceToward(g.player.pos, 100, 1);
    this.updateSkeleton(0);
    this.veil.build(this.veilAnchors, this.fwd(new THREE.Vector3()).multiplyScalar(-0.3));
    this.submerged = false;
    this.setPose('roar', 11);
    g.audio.play('emerge');
    g.cam.shake(1.0);
    this.splash(at, 1.6);
    const pl = g.player;
    if (Math.hypot(pl.pos.x - at.x, pl.pos.z - at.z) < 3.6 && pl.pos.y < 3) pl.takeDamage(this.dmg(true), at);
    this.hazards.push(new Shockwave(this, at, { speed: 10, maxR: 9, heavy: false, height: 0.7, color: [0.35, 0.8, 0.95], dust: WATER_DUST }));
    this.uninterruptible = false;
    yield* this.wait(0.5);
    this.setPose('idle', 3);
    yield* this.wait(0.8 / s);
  }

  *atkTears() {
    const g = this.game;
    const s = this.spd;
    this.setPose('tears', 3);
    g.audio.play('choirHum', { pitch: 1.2 });
    yield* this.wait(0.7, (dt) => this.brake(dt));
    const n = this.phase === 2 ? 18 : 11;
    for (let i = 0; i < n; i++) {
      const target = i % 3 === 0 ? this.predictPlayer(0.6) : this.predictPlayer(0.2, 6);
      this.hazards.push(new TearDrop(this, target, (i * 0.14) / s));
    }
    yield* this.wait((n * 0.14 + 0.8) / s, (dt) => this.brake(dt));
    this.setPose('idle', 3);
    yield* this.wait(0.4);
  }

  // Anti-air: a ring-shaped column of water erupts around her.
  *atkGeyser() {
    const g = this.game;
    const s = this.spd;
    this.airPressure = 0;
    this.setPose('hands', 9);
    g.audio.play('splash', { pitch: 0.7 });
    yield* this.wait(0.42 / s, (dt, k) => {
      this.brake(dt);
      const a = rand(0, Math.PI * 2), r = rand(2.4, 4.4);
      g.fx.glow.spawn(this.pos.x + Math.cos(a) * r, 0.3, this.pos.z + Math.sin(a) * r, 0, rand(2, 5), 0, 0.7, 0.95, 1, 0.3, 0.45, 2, 0);
      if (Math.random() < 0.25) g.fx.ring(this.pos, { r0: 2.2, r1: 4.6 * k + 1, dur: 0.35, color: WATER_RING, width: 0.3, y: 0.24 });
    });
    g.audio.play('emerge', { vol: 0.8 });
    g.cam.shake(0.6);
    for (let i = 0; i < 90; i++) {
      const a = rand(0, Math.PI * 2), r = rand(2.3, 4.6);
      g.fx.glow.spawn(this.pos.x + Math.cos(a) * r, 0.3, this.pos.z + Math.sin(a) * r, Math.cos(a) * 1.5, rand(9, 16), Math.sin(a) * 1.5, 0.75, 0.95, 1, rand(0.35, 0.6), rand(0.7, 1.1), 16, 0.6);
    }
    g.fx.ring(this.pos, { r0: 2.2, r1: 5.5, dur: 0.5, color: WATER_RING, width: 0.35, y: 0.24 });
    const pl = g.player;
    const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    if (d < 4.8 && pl.pos.y < 7.5) pl.takeDamage(this.dmg(false), this.pos);
    yield* this.wait(0.7 / s);
    this.setPose('idle', 3);
    yield* this.wait(0.3);
  }

  *atkSleeve() {
    const g = this.game;
    const s = this.spd;
    this.setPose('sleeveWind', 6);
    let glinted = false;
    yield* this.wait(0.6 / s, (dt, k) => {
      this.brake(dt);
      this.faceToward(g.player.pos, 2.5, dt);
      if (k > 0.4 && !glinted) { glinted = true; this.glint('hand', 2.6); }
    });
    g.audio.play('bossSwing', { pitch: 0.7 });
    const pose = { ...POSES.sleeveWind };
    this.poseTarget = pose;
    this.poseRate = 40;
    yield* this.wait(0.38, (dt, k) => {
      const e = easeInOutSine(k);
      const a = lerp(1.45, -1.3, e);
      pose.lx = Math.sin(a) * 3.3;
      pose.lz = Math.cos(a) * 3.3;
      pose.ly = 1.7;
      pose.lean = 0.7;
      const pl = g.player;
      if (pl.hitBySegment(this.elbowLW, this.handLW, 0.8) || pl.hitBySphere(this.handLW, 1.0)) pl.takeDamage(this.dmg(false), this.pos);
      if (Math.random() < 0.7) g.fx.glow.spawn(this.handLW.x, 0.3, this.handLW.z, rand(-2, 2), rand(1, 3), rand(-2, 2), 0.7, 0.95, 1, 0.35, 0.5, 8, 1);
    });
    this.setPose('idle', 3);
    yield* this.wait(0.65 / s);
  }

  *phaseSeq() {
    const g = this.game;
    this.uninterruptible = true;
    this.hazards.forEach((h) => h.dispose());
    this.hazards.length = 0;
    this.setPose('roar', 3);
    yield* this.wait(0.6);
    g.audio.play('bell', { vol: 1.2 });
    g.audio.play('choirHum', { pitch: 0.8, vol: 1.4 });
    g.onBossPhase2();
    g.cam.shake(1.2);
    g.ambient.blast(1.5);
    const pl = g.player;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 9 && !pl.dead) {
      pl.vel.set((dx / d) * 15, 7, (dz / d) * 15);
      pl.pos.y = Math.max(pl.pos.y, 0.01);
      pl.onGround = false;
    }
    for (let i = 0; i < 3; i++) g.fx.ring(this.pos, { r0: 1, r1: 14 + i * 4, dur: 0.8 + i * 0.3, color: [1, 0.4, 0.45], width: 0.15, y: 0.24 });
    yield* this.wait(1.8, (dt) => {
      g.cam.shake(0.15);
      this.phaseGlow = Math.min(1, this.phaseGlow + dt * 0.8);
      if (Math.random() < 0.3) this.ringBell(0.3);
    });
    g.audio.play('bell', { vol: 0.7 });
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
    g.fx.sparkBurst(this.aimPoint(), { count: 30, color: [0.8, 1, 1], speed: 16 });
    this.splash(this.pos, 1);
    this.setPose('stagger', 5);
    this.vel.set(0, 0, 0);
    yield* this.wait(2.1);
    this.setPose('idle', 2.5);
    yield* this.wait(0.6);
    yield* this.brain();
  }

  *deathSeq() {
    const g = this.game;
    this.setPose('stagger', 6);
    yield* this.wait(1.2, () => { if (Math.random() < 0.4) g.fx.sparkBurst(this.aimPoint(), { count: 3, color: [0.8, 1, 1], speed: 10 }); });
    this.setPose('dead', 0.5);
    for (let i = 0; i < 3; i++) {
      this.ringBell(0.8);
      g.audio.play('bell', { vol: 0.6 - i * 0.15, gap: 0.05 });
      yield* this.wait(1.3);
    }
    this.splash(this.pos, 1.5);
    while (true) {
      const dt = yield;
      this.deathT += dt;
    }
  }

  makeMarker() {
    const m = new THREE.Mesh(this.trapRingGeo, new THREE.MeshBasicMaterial({ color: 0x9fe8f4, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.scale.setScalar(2.2);
    this.game.scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game;
    if (this.active && this.co) {
      if (this.pendingPhase && !this.submerged && this.alive) {
        this.pendingPhase = false;
        this.uninterruptible = false;
        this.co = this.phaseSeq();
      } else if (this.pendingStagger && !this.uninterruptible && !this.submerged && this.alive) {
        this.pendingStagger = false;
        this.co = this.staggerSeq();
      }
      const r = this.co.next(dt);
      if (r.done) this.co = this.brain();
    }

    // How long the heroine has been hovering above her robe (pogo pressure).
    const pl = g.player;
    const near = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) < 4.8;
    this.airPressure = near && pl.pos.y > 1.2 ? this.airPressure + dt : Math.max(0, this.airPressure - dt * 0.5);

    const tgt = this.poseTarget;
    const k = 1 - Math.exp(-this.poseRate * dt);
    for (const key of KEYS) this.pose[key] += (tgt[key] - this.pose[key]) * k;

    this.flash = Math.max(0, this.flash - dt * 7);
    this.robeUniforms.uTime.value = g.time;
    this.updateSkeleton(dt);

    for (let i = this.hazards.length - 1; i >= 0; i--) {
      if (!this.hazards[i].update(dt)) this.hazards.splice(i, 1);
    }

    const f = this.flash;
    this.mats.robe.emissive.setRGB(f * 0.25, f * 0.28, f * 0.3);
    this.mats.bone.emissive.setRGB(f * 0.3, f * 0.3, f * 0.3);
    this.mats.face.emissiveIntensity = this.phaseGlow * (1.4 + Math.sin(g.time * 4) * 0.4) + f * 0.3;
    this.mats.rust.emissiveIntensity = this.phaseGlow * 1.2;
    this.light.intensity = 2 + this.phaseGlow * 10;
    this.light.color.setRGB(lerp(0.62, 1.0, this.phaseGlow), lerp(0.88, 0.3, this.phaseGlow), lerp(0.95, 0.35, this.phaseGlow));
    this.light.position.copy(this.aimPoint()).add(this.fwd(this.v1).multiplyScalar(1.2));

    // Wake ripples while gliding.
    this.wakeT -= dt;
    if (this.wakeT <= 0 && this.pose.sink > -3 && this.shown) {
      this.wakeT = Math.hypot(this.vel.x, this.vel.z) > 0.8 ? 0.35 : 1.1;
      g.fx.ring(this.pos, { r0: 2.3, r1: 4.5, dur: 1.4, color: WATER_RING, width: 0.08, y: 0.23 });
    }
    if (!this.alive && this.deathT > 0) this.phaseGlow = Math.max(0, this.phaseGlow - dt * 0.4);
  }

  updateSkeleton(dt) {
    const pose = this.pose;
    this.prevBell.copy(this.bellW);
    const t = this.game.time;
    const breathe = Math.sin(t * 1.1) * 0.06;
    this.group.position.set(this.pos.x, pose.sink + breathe * 0.5, this.pos.z);
    this.group.rotation.y = this.yaw;
    this.spine.rotation.set(pose.lean + breathe * 0.2, 0, 0);
    this.head.rotation.x = pose.bow;
    const hidden = pose.sink < -8.5;
    this.group.visible = this.limbs.visible = this.staff.visible = this.shown && !hidden;
    this.veil.mesh.visible = this.shown && pose.sink > -9.5;
    this.group.updateMatrixWorld(true);

    // Staff
    this.gripW.set(pose.gx, pose.gy + breathe, pose.gz).applyMatrix4(this.group.matrixWorld);
    const cp = Math.cos(pose.sp);
    this.dirW.set(Math.sin(pose.sy) * cp, Math.sin(pose.sp), Math.cos(pose.sy) * cp).applyAxisAngle(UP, this.yaw).normalize();
    this.staff.position.copy(this.gripW);
    this.staff.quaternion.setFromUnitVectors(UP, this.dirW);
    this.bellW.copy(this.gripW).addScaledVector(this.dirW, STAFF_UP - 1.5);
    this.buttW.copy(this.gripW).addScaledVector(this.dirW, -STAFF_DOWN);
    // Bell swing: damped spring driven by staff motion.
    const accel = -this.bellAng * 18 - this.bellVel * 1.6 + (this.bellW.x - this.prevBell.x) * 3;
    this.bellVel += accel * dt;
    this.bellAng += this.bellVel * dt;
    this.bellPivot.rotation.z = this.bellAng;
    this.ribbons.forEach((rb, i) => {
      rb.rotation.z = Math.sin(t * 1.7 + i * 1.3) * 0.18 - this.bellAng * 0.6;
      rb.rotation.x = Math.sin(t * 1.3 + i) * 0.15;
    });

    // Arms
    const right = this.v2.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    for (const side of ['R', 'L']) {
      const A = this.arm[side];
      const sh = this.spine.localToWorld(this.v3.copy(A.shoulder));
      const target = side === 'R' ? this.gripW.clone() : this.v1.set(pose.lx, pose.ly + pose.sink, pose.lz).applyAxisAngle(UP, this.yaw).add(this.pos);
      // Elbows point down and back, slightly outward, like a hunched old woman.
      const pole = right.clone().multiplyScalar(side === 'R' ? 0.35 : -0.35).add({ x: 0, y: -1, z: 0 }).addScaledVector(this.fwd(this.v3.clone()), -0.7);
      solveTwoBone(sh, target, 2.4, 2.4, pole, this.mid, this.end);
      this.placeLimb(A.upper, sh, this.mid);
      this.placeLimb(A.fore, this.mid, this.end);
      A.hand.position.copy(this.end);
      A.hand.lookAt(this.v1.copy(this.end).add(this.v3.subVectors(this.end, this.mid)));
      if (side === 'L') { this.handLW.copy(this.end); this.elbowLW.copy(this.mid); }
    }

    // Hurt capsules
    const C = this.capsules;
    C[0].a.set(this.pos.x, Math.max(0.2, pose.sink + 0.2), this.pos.z);
    C[0].b.copy(this.spine.localToWorld(this.v1.set(0, 0, 0)));
    C[0].r = 2.05;
    C[1].a.copy(this.spine.localToWorld(this.v1.set(0, 0.4, 0)));
    C[1].b.copy(this.spine.localToWorld(this.v1.set(0, 2.5, 0.2)));
    C[1].r = 1.35;
    C[2].a.copy(this.head.localToWorld(this.v1.set(0, -0.3, 0.1)));
    C[2].b.copy(this.head.localToWorld(this.v1.set(0, 0.3, 0)));
    C[2].r = 0.75;

    // Veil
    for (let i = 0; i < this.veilAnchorsLocal.length; i++) {
      this.veilAnchors[i].copy(this.veilAnchorsLocal[i]);
      this.head.localToWorld(this.veilAnchors[i]);
    }
    if (dt > 0) {
      const wind = this.v1.set(-this.vel.x * 2 + 1.5, 0, -this.vel.z * 2 + 1);
      const cols = [
        { a: C[2].a, b: C[2].b, r: 0.85 },
        { a: C[1].a, b: C[1].b, r: 1.45 },
        { a: C[0].a, b: C[0].b, r: 2.1 },
      ];
      this.veil.step(this.veilAnchors, cols, wind, dt);
    }
  }

  placeLimb(mesh, a, b) {
    mesh.position.copy(a);
    mesh.lookAt(b);
    mesh.scale.set(1, 1, Math.max(0.01, a.distanceTo(b) / mesh.userData.len));
  }
}

function mergeAll(parts) {
  // Small inline merge (keeps this module free of addon imports).
  let count = 0;
  for (const p of parts) count += (p.index ? p.toNonIndexed() : p).attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const p0 of parts) {
    const p = p0.index ? p0.toNonIndexed() : p0;
    pos.set(p.attributes.position.array, o * 3);
    nor.set(p.attributes.normal.array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
