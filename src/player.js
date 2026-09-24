import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, rand, wrapAngle, easeOutCubic, distPointSegment, distSegmentSegment } from './utils.js';
import { ARENA_RADIUS } from './arena.js';
import { buildVespera, animateVespera } from './heroine.js';

const GRAVITY = 38;
const RUN_SPEED = 7.4;
const JUMP_V = 13.2;
const DJUMP_V = 11.8;
const DASH_SPEED = 23;
const DASH_TIME = 0.2;
const RADIUS = 0.34;

// Ground combo: horizontal slash, rising back-slash, overhead chop.
const COMBO = [
  { dur: 0.3, act: [0.05, 0.13], from: { y: -2.0, p: 0.15 }, to: { y: 1.7, p: 0.2 }, dmg: 13, lunge: 3.5, roll: 0.2, reach: 1.25, r: 1.25 },
  { dur: 0.3, act: [0.05, 0.13], from: { y: 1.8, p: -0.1 }, to: { y: -1.8, p: -0.35 }, dmg: 13, lunge: 3.5, roll: -0.35, reach: 1.25, r: 1.25 },
  { dur: 0.42, act: [0.1, 0.19], from: { y: 0.0, p: -1.6 }, to: { y: 0.0, p: 0.9 }, dmg: 21, lunge: 7, roll: Math.PI / 2, reach: 1.45, r: 1.35, chop: true },
];

// ------------------------------------------------------------------ player
export class Player {
  constructor(game) {
    this.game = game;
    this.model = buildVespera();
    game.scene.add(this.model.root);
    this.pins = [];
    this.pinGeo = new THREE.CylinderGeometry(0.02, 0.005, 0.7, 5).rotateX(Math.PI / 2);
    this.pinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe0e8, emissiveIntensity: 2 });
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.pos = new THREE.Vector3(0, 0, 11);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.maxHp = 7;
    this.hp = this.maxHp;
    this.maxSilk = 9;
    this.silk = 0;
    this.maxPins = 5;
    this.pinCount = this.maxPins;
    this.pinTimer = 0;
    this.onGround = true;
    this.airJumps = 1;
    this.airDash = true;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.attackBuffer = 0;
    this.jumpCut = false;
    this.state = 'normal';
    this.stateT = 0;
    this.invuln = 0;
    this.dashCd = 0;
    this.combo = 0;
    this.comboWindow = 0;
    this.attackCd = 0;
    this.swingHit = false;
    this.stormTick = 0;
    this.runPhase = 0;
    this.landSquash = 0;
    this.throwT = 0;
    this.dead = false;
    this.controllable = true;
    this.dashDir = new THREE.Vector3();
    this.lastMoveDir = new THREE.Vector3(0, 0, -1);
    this.model.root.visible = true;
    this.model.armR.rotation.set(1.0, -0.5, 0);
    for (const p of this.pins) this.game.scene.remove(p.mesh);
    this.pins.length = 0;
    this.spin = 0;
    this.hurtFlash = 0;
    this.blink = 0;
  }

  get center() { return this.tmp.set(this.pos.x, this.pos.y + 0.6, this.pos.z); }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  // Capsule used for incoming damage.
  capsule() {
    return [
      new THREE.Vector3(this.pos.x, this.pos.y + 0.22, this.pos.z),
      new THREE.Vector3(this.pos.x, this.pos.y + 1.0, this.pos.z),
    ];
  }

  hitBySegment(a, b, r) {
    const [c0, c1] = this.capsule();
    return distSegmentSegment(a, b, c0, c1) < r + RADIUS;
  }

  hitBySphere(c, r) {
    const [c0, c1] = this.capsule();
    return distPointSegment(c, c0, c1) < r + RADIUS;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game;
    const input = g.input;
    const boss = g.boss;

    this.stateT += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.comboWindow = Math.max(0, this.comboWindow - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.attackBuffer = Math.max(0, this.attackBuffer - dt);
    this.throwT = Math.max(0, this.throwT - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);

    if (this.pinCount < this.maxPins) {
      this.pinTimer += dt;
      if (this.pinTimer > 4.5) { this.pinTimer = 0; this.pinCount++; }
    }

    // --- intents
    const canAct = this.controllable && !this.dead;
    let mv = { x: 0, y: 0 };
    if (canAct) {
      mv = input.moveVector();
      if (input.hit('jump')) this.jumpBuffer = 0.14;
      if (input.hit('attack')) this.attackBuffer = 0.16;
    }
    const camYaw = g.cam.yaw;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    const moveDir = this.tmp2.set(rx * mv.x + fx * mv.y, 0, rz * mv.x + fz * mv.y);
    const moveMag = Math.min(1, moveDir.length());
    if (moveMag > 0.05) { moveDir.normalize(); this.lastMoveDir.copy(moveDir); }

    const busy = this.state !== 'normal';

    // --- actions available from most states
    if (canAct) {
      // Dash cancels attacks (not hurt / bind).
      if (input.hit('dash') && this.dashCd <= 0 && (this.onGround || this.airDash) &&
        ['normal', 'attack', 'storm'].includes(this.state)) {
        this.startDash(moveMag > 0.05 ? moveDir : this.forward(this.tmp));
      } else if (input.hit('bind') && this.silk >= this.maxSilk && ['normal', 'attack'].includes(this.state)) {
        this.startBind();
      } else if (input.hit('skill') && this.silk >= 3 && ['normal', 'attack'].includes(this.state)) {
        this.startStorm();
      } else if (input.hit('tool') && this.pinCount > 0 && this.state === 'normal' && this.throwT <= 0) {
        this.throwPin();
      }
    }

    // --- state machine
    switch (this.state) {
      case 'normal': {
        // Jump
        if (this.jumpBuffer > 0) {
          if (this.onGround || this.coyote > 0) {
            this.vel.y = JUMP_V;
            this.onGround = false;
            this.coyote = 0;
            this.jumpBuffer = 0;
            this.jumpCut = false;
            g.audio.play('jump');
            g.fx.burst(this.pos, { count: 6, color: [0.8, 0.7, 0.7], speed: 2, size: 0.25, life: 0.4, gravity: 0, up: 0.5 });
          } else if (this.airJumps > 0) {
            this.airJumps--;
            this.vel.y = DJUMP_V;
            this.jumpBuffer = 0;
            this.jumpCut = false;
            g.audio.play('doubleJump');
            this.flap = 1;
            g.fx.ring(this.pos, { r0: 0.2, r1: 1.4, dur: 0.3, color: [1, 0.95, 0.95], width: 0.35, y: this.pos.y + 0.1 });
            g.fx.burst(this.center, { count: 14, color: [1, 1, 1], speed: 3, size: 0.2, life: 0.4, gravity: 3 });
          }
        }
        // Variable jump height
        if (!this.jumpCut && this.vel.y > 0 && !input.down('jump')) {
          this.vel.y *= 0.5;
          this.jumpCut = true;
        }
        // Attack
        if (this.attackBuffer > 0 && this.attackCd <= 0) {
          this.attackBuffer = 0;
          if (this.onGround) this.startGroundAttack();
          else this.startDive();
        }
        this.move(moveDir, moveMag, dt, 1);
        break;
      }
      case 'attack': {
        const A = COMBO[this.combo];
        const t = this.stateT;
        if (t >= A.act[0] && t <= A.act[1] + 0.02 && !this.swingHit) this.checkNailHit(A);
        // Buffered follow-up attack chains the combo
        if (t > A.act[1] + 0.04 && this.attackBuffer > 0 && this.attackCd <= 0 && this.onGround) {
          this.attackBuffer = 0;
          this.startGroundAttack();
          break;
        }
        if (t > A.dur * 0.6 && this.jumpBuffer > 0) { this.state = 'normal'; break; }
        // Slide from lunge
        this.vel.x = damp(this.vel.x, 0, 12, dt);
        this.vel.z = damp(this.vel.z, 0, 12, dt);
        if (t >= A.dur) {
          this.state = 'normal';
          this.comboWindow = 0.35;
        }
        break;
      }
      case 'dive': {
        this.vel.x = this.dashDir.x * 12;
        this.vel.z = this.dashDir.z * 12;
        this.vel.y = -17;
        if (!this.swingHit && boss && boss.alive) {
          const c = this.tmp.copy(this.pos).addScaledVector(this.dashDir, 0.45);
          c.y += 0.15;
          const hit = boss.receiveHit(c, 0.85);
          if (hit) {
            this.swingHit = true;
            this.onHitBoss(hit, 13, 'dive');
            // Pogo!
            this.state = 'normal';
            this.vel.y = 12;
            this.attackCd = 0.2;
            this.vel.x = -this.dashDir.x * 3;
            this.vel.z = -this.dashDir.z * 3;
            this.airJumps = 1;
            this.airDash = true;
            this.jumpCut = true;
            g.audio.play('pogo');
          }
        }
        if (this.stateT > 0.75) this.state = 'normal';
        break;
      }
      case 'dash': {
        this.vel.x = this.dashDir.x * DASH_SPEED;
        this.vel.z = this.dashDir.z * DASH_SPEED;
        this.vel.y = 0;
        if (Math.random() < 0.7) {
          g.fx.burst(this.tmp.copy(this.pos).add({ x: 0, y: 0.6, z: 0 }), { count: 1, color: [1, 0.35, 0.45], speed: 0.5, size: 0.35, life: 0.3, gravity: 0 });
        }
        if (this.stateT >= DASH_TIME) {
          this.state = 'normal';
          this.vel.x *= 0.35;
          this.vel.z *= 0.35;
        }
        break;
      }
      case 'storm': {
        this.spin += dt * 30;
        this.vel.x = damp(this.vel.x, moveDir.x * 3 * moveMag, 8, dt);
        this.vel.z = damp(this.vel.z, moveDir.z * 3 * moveMag, 8, dt);
        if (!this.onGround) this.vel.y = Math.max(this.vel.y, -1.5);
        this.stormTick -= dt;
        if (this.stormTick <= 0) {
          this.stormTick = 0.1;
          const c = this.tmp.copy(this.pos);
          c.y += 0.6;
          if (boss && boss.alive) {
            const hit = boss.receiveHit(c, 2.3);
            if (hit) this.onHitBoss(hit, 9, 'storm');
          }
          const a = rand(0, Math.PI * 2);
          g.fx.slash({ origin: c.clone(), yaw: a, roll: rand(-0.4, 0.4), radius: rand(1.7, 2.3), a0: 0, a1: 2.6, dur: 0.16, color: [1, 0.9, 0.95], thick: 0.3, trail: 0.8 });
        }
        if (this.stateT >= 0.7) { this.state = 'normal'; this.spin = 0; }
        break;
      }
      case 'bind': {
        this.vel.x = damp(this.vel.x, 0, 10, dt);
        this.vel.z = damp(this.vel.z, 0, 10, dt);
        if (!this.onGround) this.vel.y = Math.max(this.vel.y, -0.8);
        if (Math.random() < 0.8) {
          const a = rand(0, Math.PI * 2);
          const r = rand(0.6, 1.1);
          g.fx.glow.spawn(this.pos.x + Math.cos(a) * r, this.pos.y + rand(0.1, 1.2), this.pos.z + Math.sin(a) * r,
            -Math.cos(a) * 2, 0.5, -Math.sin(a) * 2, 1, 0.95, 0.95, 0.22, 0.4, 0, 1);
        }
        if (this.stateT >= 0.7) {
          const before = this.hp;
          this.hp = Math.min(this.maxHp, this.hp + 3);
          this.silk = 0;
          this.state = 'normal';
          g.audio.play('bind');
          g.fx.burst(this.center, { count: 40, color: [1, 0.95, 0.95], speed: 6, size: 0.3, life: 0.7, gravity: 1 });
          g.fx.ring(this.pos, { r0: 0.3, r1: 3, dur: 0.5, color: [1, 0.9, 0.95], width: 0.2, y: this.pos.y + 0.05 });
          g.fx.flash(this.center, 0xffe8f0, 20, 0.3, 8);
          g.hud.healed(before, this.hp);
        }
        break;
      }
      case 'hurt': {
        this.vel.x = damp(this.vel.x, 0, 3, dt);
        this.vel.z = damp(this.vel.z, 0, 3, dt);
        if (this.stateT > 0.32) this.state = 'normal';
        break;
      }
      case 'dead': {
        this.vel.x = damp(this.vel.x, 0, 4, dt);
        this.vel.z = damp(this.vel.z, 0, 4, dt);
        break;
      }
      default: break;
    }

    // --- physics integration
    const useGravity = this.state !== 'dash' && this.state !== 'dive';
    if (useGravity) {
      const gmul = this.vel.y < 0 ? 1.25 : 1;
      this.vel.y = Math.max(this.vel.y - GRAVITY * gmul * dt, -32);
    }
    this.pos.addScaledVector(this.vel, dt);

    // Ground
    const wasGround = this.onGround;
    if (this.pos.y <= 0) {
      if (!wasGround) this.onLand();
      this.pos.y = 0;
      this.vel.y = Math.max(0, this.vel.y);
      this.onGround = true;
      this.airJumps = 1;
      this.airDash = true;
    } else if (this.pos.y > 0.001) {
      if (wasGround) this.coyote = this.vel.y > 0 ? 0 : 0.1;
      this.onGround = false;
    }

    // Arena boundary
    const hr = Math.hypot(this.pos.x, this.pos.z);
    if (hr > ARENA_RADIUS) {
      const k = ARENA_RADIUS / hr;
      this.pos.x *= k;
      this.pos.z *= k;
    }

    // Push out of the boss body.
    if (boss && boss.alive) boss.pushOut(this.pos, RADIUS);

    // Facing
    if (this.state === 'normal' && moveMag > 0.1) {
      this.yaw = dampAngle(this.yaw, Math.atan2(moveDir.x, moveDir.z), 16, dt);
    } else if (this.state === 'dash') {
      this.yaw = dampAngle(this.yaw, Math.atan2(this.dashDir.x, this.dashDir.z), 25, dt);
    }

    this.updatePins(dt);
    this.animate(dt, moveMag);
  }

  move(dir, mag, dt, mul) {
    const target = RUN_SPEED * mag * mul;
    const accel = this.onGround ? 16 : 7;
    this.vel.x = damp(this.vel.x, dir.x * target, accel, dt);
    this.vel.z = damp(this.vel.z, dir.z * target, accel, dt);
  }

  onLand() {
    const g = this.game;
    if (this.vel.y < -12) {
      this.landSquash = 1;
      g.audio.play('land');
      g.fx.burst(this.pos, { count: 8, color: [0.6, 0.5, 0.5], speed: 2.5, size: 0.3, life: 0.4, gravity: 0, up: 0.3 });
    }
    if (this.state === 'dive') {
      this.state = 'normal';
      this.attackCd = 0.12;
      g.fx.burst(this.pos, { count: 10, color: [0.9, 0.8, 0.8], speed: 3.5, size: 0.28, life: 0.35, gravity: 0 });
    }
  }

  faceBossIfNear(maxDist) {
    const boss = this.game.boss;
    if (!boss || !boss.alive) return;
    const dx = boss.pos.x - this.pos.x, dz = boss.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < maxDist) {
      const want = Math.atan2(dx, dz);
      const locked = this.game.cam.locked;
      if (locked || Math.abs(wrapAngle(want - this.yaw)) < 1.9) this.yaw = want;
    }
  }

  startGroundAttack() {
    const g = this.game;
    this.combo = this.comboWindow > 0 || this.state === 'attack' ? (this.combo + 1) % 3 : 0;
    const A = COMBO[this.combo];
    this.state = 'attack';
    this.stateT = 0;
    this.swingHit = false;
    this.faceBossIfNear(6);
    const f = this.forward(this.tmp);
    this.vel.x = f.x * A.lunge;
    this.vel.z = f.z * A.lunge;
    this.attackCd = this.combo === 2 ? 0.5 : 0.34;
    g.audio.play('slash', { pitch: this.combo === 2 ? 0.8 : 1 + this.combo * 0.08 });
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + 0.66, this.pos.z);
    if (A.chop) {
      g.fx.slash({ origin, yaw: this.yaw, roll: Math.PI / 2, radius: 1.75, a0: 2.2, a1: -0.9, dur: 0.24, color: [1, 0.82, 0.88], thick: 0.5, trail: 0.8 });
    } else {
      g.fx.slash({ origin, yaw: this.yaw, roll: A.roll, radius: 1.6, a0: A.from.y, a1: A.to.y, dur: 0.2, color: [1, 0.82, 0.88], thick: 0.45, trail: 0.75 });
    }
  }

  startDive() {
    const g = this.game;
    this.state = 'dive';
    this.stateT = 0;
    this.swingHit = false;
    this.faceBossIfNear(9);
    this.forward(this.dashDir);
    g.audio.play('slash', { pitch: 1.25 });
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + 0.5, this.pos.z);
    g.fx.slash({ origin, yaw: this.yaw, roll: Math.PI / 2, radius: 1.3, a0: 1.4, a1: -1.3, dur: 0.22, color: [1, 0.85, 0.9], thick: 0.4, trail: 0.7 });
  }

  startDash(dir) {
    const g = this.game;
    this.state = 'dash';
    this.stateT = 0;
    this.dashDir.copy(dir).setY(0).normalize();
    this.dashCd = 0.48;
    this.invuln = Math.max(this.invuln, DASH_TIME + 0.06);
    if (!this.onGround) this.airDash = false;
    g.audio.play('dash');
    g.fx.burst(this.center, { count: 12, color: [1, 0.3, 0.4], speed: 3, size: 0.35, life: 0.35, gravity: 0, dir: this.dashDir.clone().negate(), spread: 0.8 });
  }

  startBind() {
    this.state = 'bind';
    this.stateT = 0;
    this.game.audio.play('bindStart');
    if (!this.onGround) this.vel.y = Math.max(this.vel.y, 2);
  }

  startStorm() {
    this.silk -= 3;
    this.state = 'storm';
    this.stateT = 0;
    this.stormTick = 0;
    this.game.audio.play('storm');
    this.game.hud.silkChanged();
    if (!this.onGround) this.vel.y = Math.max(this.vel.y, 3);
  }

  throwPin() {
    const g = this.game;
    this.pinCount--;
    this.throwT = 0.22;
    const start = new THREE.Vector3(this.pos.x, this.pos.y + 0.75, this.pos.z);
    let dir;
    const boss = g.boss;
    if (boss && boss.alive && (g.cam.locked || start.distanceTo(boss.pos) < 20)) {
      dir = boss.aimPoint().sub(start).normalize();
      this.yaw = Math.atan2(dir.x, dir.z);
    } else {
      dir = this.forward().clone();
    }
    const mesh = new THREE.Mesh(this.pinGeo, this.pinMat);
    mesh.position.copy(start);
    mesh.lookAt(start.clone().add(dir));
    g.scene.add(mesh);
    this.pins.push({ mesh, vel: dir.multiplyScalar(42), life: 0.9 });
    g.audio.play('throw');
  }

  updatePins(dt) {
    const g = this.game;
    for (let i = this.pins.length - 1; i >= 0; i--) {
      const p = this.pins[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (Math.random() < 0.8) {
        const q = p.mesh.position;
        g.fx.glow.spawn(q.x, q.y, q.z, 0, 0, 0, 1, 0.9, 0.95, 0.15, 0.18, 0, 0);
      }
      let dead = p.life <= 0 || p.mesh.position.y < 0;
      if (!dead && g.boss && g.boss.alive) {
        const hit = g.boss.receiveHit(p.mesh.position, 0.35);
        if (hit) {
          this.onHitBoss(hit, 14, 'pin');
          dead = true;
        }
      }
      if (dead) {
        g.scene.remove(p.mesh);
        this.pins.splice(i, 1);
      }
    }
  }

  checkNailHit(A) {
    const boss = this.game.boss;
    if (!boss || !boss.alive) return;
    const f = this.forward(this.tmp2);
    const c = this.tmp.copy(this.pos).addScaledVector(f, A.reach);
    c.y += A.chop ? 0.9 : 0.62;
    const hit = boss.receiveHit(c, A.r);
    if (hit) {
      this.swingHit = true;
      this.onHitBoss(hit, A.dmg, 'nail');
      if (this.onGround) {
        this.vel.x = -f.x * 5;
        this.vel.z = -f.z * 5;
      }
    }
  }

  onHitBoss(hit, dmg, kind) {
    const g = this.game;
    const dir = hit.point.clone().sub(this.center).normalize();
    g.boss.takeDamage(dmg, hit.point, dir);
    if (kind === 'nail' || kind === 'dive') {
      this.silk = Math.min(this.maxSilk, this.silk + (kind === 'nail' ? 1 : 0.5));
      g.hud.silkChanged();
    }
    g.hitStop = Math.max(g.hitStop, kind === 'storm' ? 0.02 : 0.065);
    g.cam.shake(kind === 'storm' ? 0.08 : 0.22);
    g.audio.play(kind === 'storm' ? 'hit' : 'hit', { pitch: rand(0.9, 1.1), vol: kind === 'storm' ? 0.5 : 1, gap: 0.05 });
    g.fx.sparkBurst(hit.point, { count: kind === 'storm' ? 6 : 16, color: [1, 0.85, 0.7], speed: 16, dir, spread: 1.2 });
    g.fx.burst(hit.point, { count: kind === 'storm' ? 4 : 12, color: [1, 0.2, 0.3], speed: 6, size: 0.35, life: 0.5, gravity: 8, dir, spread: 1 });
    g.fx.burst(hit.point, { count: 4, color: [0.05, 0.02, 0.03], speed: 4, size: 0.25, life: 0.6, gravity: 12, dark: true });
    if (kind !== 'storm') g.fx.flash(hit.point, 0xffe0d0, 25, 0.1, 8);
  }

  takeDamage(amount, sourcePos) {
    const g = this.game;
    if (this.invuln > 0 || this.dead || !this.controllable) return false;
    const before = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    g.stats.hitsTaken++;
    g.hud.damaged(before, this.hp);
    this.invuln = 1.15;
    this.blink = 1.15;
    this.hurtFlash = 0.35;
    const away = this.tmp.set(this.pos.x - sourcePos.x, 0, this.pos.z - sourcePos.z);
    if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
    away.normalize();
    this.vel.set(away.x * 10, 8, away.z * 10);
    this.onGround = false;
    this.pos.y = Math.max(this.pos.y, 0.01);
    this.state = 'hurt';
    this.stateT = 0;
    g.hitStop = 0.14;
    g.cam.shake(0.7);
    g.audio.play('hurt');
    g.post.damagePulse();
    g.fx.burst(this.center, { count: 22, color: [0.04, 0.02, 0.03], speed: 7, size: 0.3, life: 0.8, gravity: 14, dark: true });
    g.fx.sparkBurst(this.center, { count: 12, color: [1, 1, 1], speed: 12 });
    if (this.hp <= 0) this.die();
    return true;
  }

  die() {
    const g = this.game;
    this.dead = true;
    this.state = 'dead';
    this.stateT = 0;
    g.audio.play('deathPlayer');
    g.onPlayerDeath();
  }

  // ---------------------------------------------------------------- animation
  animate(dt, moveMag) {
    const m = this.model;
    const t = this.game.time;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const runK = this.onGround ? clamp(hs / RUN_SPEED, 0, 1) : 0;

    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw + (this.state === 'storm' ? this.spin : 0);

    // Blink while invulnerable after being hurt
    this.blink = Math.max(0, (this.blink || 0) - dt);
    m.root.visible = !(this.blink > 0 && this.blink < 1.0 && Math.floor(t * 18) % 2 === 0);
    if (this.dead && this.stateT > 1.2) m.root.visible = false;

    this.runPhase += hs * dt * 2.3;
    this.landSquash = Math.max(0, this.landSquash - dt * 5);

    // Body bob / lean
    const bob = Math.abs(Math.sin(this.runPhase)) * 0.05 * runK;
    let lean = runK * 0.28;
    if (this.state === 'dash') lean = 0.75;
    if (this.state === 'dive') lean = 0.9;
    if (this.state === 'hurt') lean = -0.5;
    if (this.state === 'dead') lean = lerp(-0.4, -1.4, clamp(this.stateT, 0, 1));
    if (this.state === 'bind') lean = 0.4;
    m.body.position.y = bob - this.landSquash * 0.08 + (this.state === 'dead' ? -clamp(this.stateT, 0, 1) * 0.3 : 0);
    m.body.rotation.x = damp(m.body.rotation.x, lean, 14, dt);
    m.body.scale.set(1 + this.landSquash * 0.12, 1 - this.landSquash * 0.12, 1 + this.landSquash * 0.12);

    // Legs
    for (let i = 0; i < 2; i++) {
      const L = m.legs[i];
      const ph = this.runPhase + i * Math.PI;
      let hipX, kneeX;
      if (this.onGround && this.state !== 'dash') {
        hipX = -Math.sin(ph) * 0.95 * runK;
        kneeX = Math.max(0, Math.cos(ph)) * 1.3 * runK + 0.1;
        if (this.state === 'attack') { hipX = i === 0 ? -0.5 : 0.45; kneeX = 0.4; }
      } else if (this.state === 'dash') {
        hipX = i === 0 ? 0.6 : 1.0; kneeX = 0.9;
      } else if (this.state === 'dive') {
        hipX = -0.2; kneeX = 0.2;
      } else {
        const up = this.vel.y > 0;
        hipX = up ? (i === 0 ? -0.9 : 0.2) : -0.5 + i * 0.3;
        kneeX = up ? (i === 0 ? 1.5 : 0.6) : 0.9;
      }
      L.hip.rotation.x = damp(L.hip.rotation.x, hipX, 20, dt);
      L.knee.rotation.x = damp(L.knee.rotation.x, kneeX, 20, dt);
    }

    // Right arm / needle pose
    let ay = -0.45, ap = 1.05, az = 0, twist = 0;
    if (this.state === 'attack') {
      const A = COMBO[this.combo];
      const tt = this.stateT;
      let k;
      if (tt < A.act[0]) k = 0;
      else if (tt < A.act[1]) k = easeOutCubic((tt - A.act[0]) / (A.act[1] - A.act[0]));
      else k = 1;
      ay = lerp(A.from.y, A.to.y, k);
      ap = lerp(A.from.p, A.to.p, k);
      if (A.chop) { az = 0; }
      twist = ay * 0.35;
      m.armR.rotation.set(ap, ay, az);
    } else if (this.state === 'dive') {
      m.armR.rotation.set(1.25, 0, 0);
    } else if (this.state === 'storm') {
      m.armR.rotation.set(0.1, -1.57, 0);
    } else if (this.state === 'bind') {
      m.armR.rotation.set(-1.1, -0.4, 0);
    } else if (this.throwT > 0) {
      m.armR.rotation.set(-0.3, 0.3, 0);
    } else {
      if (!this.onGround) { ay = -0.9; ap = 0.4; }
      if (this.state === 'dash') { ay = -1.2; ap = 1.6; }
      const r = m.armR.rotation;
      r.x = damp(r.x, ap, 14, dt);
      r.y = damp(r.y, ay, 14, dt);
      r.z = 0;
    }
    m.torso.rotation.y = damp(m.torso.rotation.y, twist, 18, dt);
    m.armL.rotation.set(this.state === 'bind' ? -1.1 : 0.9 + Math.sin(this.runPhase) * 0.5 * runK, 0.4, 0);
    m.head.rotation.x = this.state === 'bind' ? 0.35 : -m.body.rotation.x * 0.4;

    // Wings and candle flame
    this.flap = Math.max(0, (this.flap || 0) - dt * 2.5);
    animateVespera(m, {
      t, name: this.state, speed: hs, vy: this.vel.y, onGround: this.onGround,
      hpFrac: this.hp / this.maxHp, flap: this.flap, deadT: this.stateT,
    }, dt);
  }
}
