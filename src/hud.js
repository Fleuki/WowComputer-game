import { damp } from './utils.js';

const MASK_SVG = `<svg viewBox="0 0 26 34"><path class="m-feather" d="M9.5 13 C8 8 5 4.5 1.5 3.5 M16.5 13 C18 8 21 4.5 24.5 3.5"/><circle class="m-body" cx="13" cy="21.5" r="10.5"/><ellipse class="m-eye" cx="8.9" cy="22.5" rx="2.5" ry="3.6" transform="rotate(28 8.9 22.5)"/><ellipse class="m-eye" cx="17.1" cy="22.5" rx="2.5" ry="3.6" transform="rotate(-28 17.1 22.5)"/><path class="m-orn" d="M13 12.8 C14.2 14.6 14.2 16.4 13 17.8 C11.8 16.4 11.8 14.6 13 12.8 Z"/></svg>`;

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
