import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp } from './utils.js';

// Third-person camera with a boss lock-on, cinematic modes and trauma shake.
export class CameraRig {
  constructor(camera, game) {
    this.camera = camera;
    this.game = game;
    this.yaw = 0;
    this.pitch = 0.26;
    this.dist = 8.6;
    this.locked = true;
    this.lockOffset = 0;
    this.mode = 'menu';
    this.modeT = 0;
    this.focus = new THREE.Vector3(0, 2, 0);
    this.trauma = 0;
    this.t = 0;
    this.tmp = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 6, 20);
    this.manualPitchT = 0;
  }

  shake(amount) {
    this.trauma = Math.min(1.4, this.trauma + amount);
  }

  setMode(mode) {
    this.mode = mode;
    this.modeT = 0;
  }

  toggleLock() {
    this.locked = !this.locked;
    this.lockOffset = 0;
  }

  update(dt, rawDt) {
    const g = this.game;
    const P = g.player, B = g.boss;
    const inp = g.input;
    this.t += rawDt;
    this.modeT += rawDt;

    const cam = this.camera;
    let focusTarget = this.tmp;
    let desiredPos = null;

    if (this.mode === 'menu') {
      const a = this.t * 0.05 + 0.3;
      desiredPos = new THREE.Vector3(Math.sin(a) * 15, 3.2 + Math.sin(this.t * 0.2) * 0.6, Math.cos(a) * 15 + 2);
      focusTarget.set(B.pos.x, 3.2, B.pos.z);
    } else if (this.mode === 'intro') {
      // Low angle over the heroine's shoulder, slowly pushing in toward the boss.
      const k = Math.min(1, this.modeT / 4.5);
      const toP = Math.atan2(P.pos.x - B.pos.x, P.pos.z - B.pos.z);
      this.yaw = toP + lerp(0.5, 0.18, k);
      const d = lerp(9, 6.6, k);
      const base = P.pos.clone();
      desiredPos = new THREE.Vector3(base.x + Math.sin(this.yaw) * d, lerp(1.2, 2.3, k), base.z + Math.cos(this.yaw) * d);
      const head = B.alive ? B.aimPoint() : B.pos;
      focusTarget.lerpVectors(new THREE.Vector3(P.pos.x, 1.5, P.pos.z), head, 0.6);
      this.pitch = 0.26;
    } else if (this.mode === 'victory') {
      const a = this.modeT * 0.12 + this.yaw;
      desiredPos = new THREE.Vector3(B.pos.x + Math.sin(a) * 11, 3.5, B.pos.z + Math.cos(a) * 11);
      focusTarget.set(B.pos.x, 1.6, B.pos.z);
    } else {
      // play / death
      let dx = 0, dy = 0;
      if (this.mode === 'play') {
        dx = inp.mouseDX * 0.0024 + inp.padLook.x * 2.8 * rawDt;
        dy = inp.mouseDY * 0.002 + inp.padLook.y * 1.8 * rawDt;
      }
      const bossOk = B.alive && B.active;
      if (this.locked && bossOk) {
        const want = Math.atan2(P.pos.x - B.pos.x, P.pos.z - B.pos.z);
        const hd = Math.hypot(P.pos.x - B.pos.x, P.pos.z - B.pos.z);
        this.lockOffset = clamp(this.lockOffset - dx, -0.9, 0.9);
        this.lockOffset = damp(this.lockOffset, 0, 0.8, rawDt);
        const rate = hd < 2.5 ? 0.8 : 4.2;
        this.yaw = dampAngle(this.yaw, want + this.lockOffset, rate, rawDt);
        if (Math.abs(dy) > 0.0005) this.manualPitchT = 1.5;
        this.manualPitchT = Math.max(0, this.manualPitchT - rawDt);
        this.pitch = clamp(this.pitch + dy, -0.15, 1.0);
        // Look up when the boss is airborne / looming close.
        const want2 = clamp(0.27 - (hd < 7 ? (7 - hd) * 0.025 : 0) - B.pos.y * 0.035, -0.12, 0.5);
        if (this.manualPitchT <= 0) this.pitch = damp(this.pitch, want2, B.pos.y > 1 ? 4 : 1.5, rawDt);
        const head = B.aimPoint();
        const pf = new THREE.Vector3(P.pos.x, P.pos.y * 0.6 + 1.4, P.pos.z);
        const kx = clamp(0.26 - hd * 0.005, 0.1, 0.26);
        focusTarget.set(lerp(pf.x, head.x, kx), lerp(pf.y, head.y, hd < 7 ? lerp(0.32, 0.14, hd / 7) : 0.14), lerp(pf.z, head.z, kx));
        focusTarget.y = Math.max(focusTarget.y, 1.4 + B.pos.y * 0.62);
      } else {
        this.yaw -= dx;
        this.pitch = clamp(this.pitch + dy, -0.2, 1.1);
        focusTarget.set(P.pos.x, P.pos.y * 0.7 + 1.4, P.pos.z);
      }
      let dist = this.dist;
      if (this.mode === 'death') dist = lerp(this.dist, 4.2, Math.min(1, this.modeT / 2));
      const cp = Math.cos(this.pitch);
      desiredPos = new THREE.Vector3(
        focusTarget.x + Math.sin(this.yaw) * cp * dist,
        focusTarget.y + Math.sin(this.pitch) * dist + 0.6,
        focusTarget.z + Math.cos(this.yaw) * cp * dist,
      );
    }

    // Smooth follow
    const followRate = this.mode === 'play' ? 14 : 3;
    this.focus.x = damp(this.focus.x, focusTarget.x, followRate, rawDt);
    this.focus.y = damp(this.focus.y, focusTarget.y, followRate * 0.45, rawDt);
    this.focus.z = damp(this.focus.z, focusTarget.z, followRate, rawDt);
    if (this.mode === 'play') this.pos.copy(desiredPos);
    else this.pos.lerp(desiredPos, 1 - Math.exp(-2.5 * rawDt));

    // Keep inside the hall.
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 25) { this.pos.x *= 25 / r; this.pos.z *= 25 / r; }
    this.pos.y = Math.max(this.pos.y, 0.45);

    // Shake
    this.trauma = Math.max(0, this.trauma - rawDt * 1.7);
    const s = this.trauma * this.trauma;
    const t = this.t * 38;
    const sx = (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 1.7)) * 0.5 * s * 0.45;
    const sy = (Math.sin(t * 1.3 + 3.1) + Math.sin(t * 2.9)) * 0.5 * s * 0.35;
    cam.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    cam.lookAt(this.focus);
    cam.rotateZ(Math.sin(t * 0.9 + 5) * s * 0.03);
  }
}
