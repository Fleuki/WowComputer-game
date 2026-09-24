import { damp } from './utils.js';

const MASK_SVG = `<svg viewBox="0 0 24 34"><path class="m-body" d="M5 1.5 C6 6 7 9.5 8.2 11.6 C5.2 12.8 3.5 16 3.5 20 C3.5 26.5 8 32 12 33 C16 32 20.5 26.5 20.5 20 C20.5 16 18.8 12.8 15.8 11.6 C17 9.5 18 6 19 1.5 C16.5 5.5 15.2 8.5 14.3 10.9 C12.8 10.6 11.2 10.6 9.7 10.9 C8.8 8.5 7.5 5.5 5 1.5 Z"/><ellipse class="m-eye" cx="8.8" cy="21" rx="2.1" ry="3.4" transform="rotate(18 8.8 21)"/><ellipse class="m-eye" cx="15.2" cy="21" rx="2.1" ry="3.4" transform="rotate(-18 15.2 21)"/></svg>`;

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('hud');
    this.masksEl = document.getElementById('masks');
    this.spool = document.getElementById('spool');
    this.spoolFill = document.getElementById('spool-fill');
    this.pinCount = document.getElementById('pin-count');
    this.toolPins = document.getElementById('tool-pins');
    this.toolStorm = document.getElementById('tool-storm');
    this.toolBind = document.getElementById('tool-bind');
    this.bossHud = document.getElementById('boss-hud');
    this.bossFill = document.getElementById('boss-bar-fill');
    this.bossChip = document.getElementById('boss-bar-chip');
    this.lockHint = document.getElementById('lock-hint');
    this.circ = 2 * Math.PI * 33;
    this.spoolFill.style.strokeDasharray = `${this.circ}`;
    const ticks = document.getElementById('spool-ticks');
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 - Math.PI / 2;
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', 40 + Math.cos(a) * 30);
      l.setAttribute('y1', 40 + Math.sin(a) * 30);
      l.setAttribute('x2', 40 + Math.cos(a) * 36);
      l.setAttribute('y2', 40 + Math.sin(a) * 36);
      ticks.appendChild(l);
    }
    this.bossFrac = 1;
    this.chipFrac = 1;
    this.chipDelay = 0;
    this.masks = [];
  }

  reset() {
    const p = this.game.player;
    this.masksEl.innerHTML = '';
    this.masks = [];
    for (let i = 0; i < p.maxHp; i++) {
      const d = document.createElement('div');
      d.className = 'mask';
      d.innerHTML = MASK_SVG;
      this.masksEl.appendChild(d);
      this.masks.push(d);
    }
    this.bossFrac = this.chipFrac = 1;
    this.bossHud.classList.add('hidden');
    this.bossHud.classList.remove('phase2');
    this.renderMasks();
    this.silkChanged();
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  showBoss() { this.bossHud.classList.remove('hidden'); }

  phase2() { this.bossHud.classList.add('phase2'); }

  renderMasks() {
    const hp = this.game.player.hp;
    this.masks.forEach((m, i) => m.classList.toggle('empty', i >= hp));
  }

  damaged(before, after) {
    this.renderMasks();
    for (let i = after; i < before; i++) {
      const m = this.masks[i];
      if (!m) continue;
      m.classList.remove('lost');
      void m.offsetWidth;
      m.classList.add('lost');
    }
  }

  healed(before, after) {
    this.renderMasks();
    for (let i = before; i < after; i++) {
      const m = this.masks[i];
      if (!m) continue;
      m.classList.remove('gained');
      void m.offsetWidth;
      m.classList.add('gained');
    }
    this.silkChanged();
  }

  silkChanged() {
    const p = this.game.player;
    const f = p.silk / p.maxSilk;
    this.spoolFill.style.strokeDashoffset = `${this.circ * (1 - f)}`;
    this.spool.classList.toggle('full', p.silk >= p.maxSilk);
  }

  bossHp(frac) {
    this.bossFrac = Math.max(0, frac);
    this.chipDelay = 0.45;
    this.bossFill.style.transform = `scaleX(${this.bossFrac})`;
  }

  update(dt) {
    const p = this.game.player;
    this.pinCount.textContent = p.pinCount;
    this.toolPins.classList.toggle('disabled', p.pinCount <= 0);
    this.toolStorm.classList.toggle('disabled', p.silk < 3);
    this.toolBind.classList.toggle('disabled', p.silk < p.maxSilk);
    this.toolBind.classList.toggle('ready', p.silk >= p.maxSilk);
    const locked = this.game.cam.locked;
    if (locked !== this.lastLocked) {
      this.lastLocked = locked;
      this.lockHint.classList.toggle('on', locked);
      this.lockHint.innerHTML = locked ? 'Цель захвачена · <b>TAB</b>' : 'Захват цели: <b>TAB</b>';
    }
    this.chipDelay -= dt;
    if (this.chipDelay <= 0) this.chipFrac = damp(this.chipFrac, this.bossFrac, 5, dt);
    this.bossChip.style.transform = `scaleX(${this.chipFrac})`;
  }
}
