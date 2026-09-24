// Keyboard + mouse + gamepad input with per-frame "pressed" edges.

const BINDINGS = {
  jump: ['Space', 'Pad0'],
  attack: ['Mouse0', 'KeyJ', 'Pad2'],
  dash: ['ShiftLeft', 'ShiftRight', 'Mouse2', 'KeyK', 'Pad1', 'Pad7'],
  bind: ['KeyE', 'KeyF', 'Pad3'],
  skill: ['KeyQ', 'Pad5'],
  tool: ['KeyR', 'Pad4'],
  lock: ['Tab', 'Mouse1', 'Pad11', 'Pad6'],
  pause: ['Escape', 'KeyP', 'Pad9'],
};

const PREVENT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.held = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.lockFailed = false;
    this.padPrev = [];
    this.padMove = { x: 0, y: 0 };
    this.padLook = { x: 0, y: 0 };
    this.usingPad = false;
    this.onLockChange = null;

    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) this._down(e.code);
    });
    window.addEventListener('keyup', (e) => this._up(e.code));
    canvas.addEventListener('mousedown', (e) => {
      this._down('Mouse' + e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => this._up('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      // Without pointer lock (blocked in some iframes) fall back to raw movement.
      if (this.locked || this.lockFailed) {
        // Guard against the occasional huge spike some browsers emit.
        if (Math.abs(e.movementX) < 400) this.mouseDX += e.movementX;
        if (Math.abs(e.movementY) < 400) this.mouseDY += e.movementY;
      }
    });
    window.addEventListener('blur', () => this.held.clear());
    document.addEventListener('pointerlockerror', () => { this.lockFailed = true; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  _down(code) {
    if (!this.held.has(code)) this.pressed.add(code);
    this.held.add(code);
    if (!code.startsWith('Pad')) this.usingPad = false;
  }

  _up(code) {
    if (this.held.has(code)) this.released.add(code);
    this.held.delete(code);
  }

  requestLock() {
    if (this.locked) return;
    try {
      if (!this.canvas.requestPointerLock) { this.lockFailed = true; return; }
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { this.lockFailed = true; });
    } catch (_) {
      this.lockFailed = true;
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) {
      this.padMove.x = this.padMove.y = this.padLook.x = this.padLook.y = 0;
      return;
    }
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    this.padMove.x = dz(pad.axes[0] || 0);
    this.padMove.y = -dz(pad.axes[1] || 0);
    this.padLook.x = dz(pad.axes[2] || 0);
    this.padLook.y = dz(pad.axes[3] || 0);
    pad.buttons.forEach((b, i) => {
      const was = this.padPrev[i] || false;
      const now = b.pressed || b.value > 0.5;
      if (now && !was) { this._down('Pad' + i); this.usingPad = true; }
      if (!now && was) this._up('Pad' + i);
      this.padPrev[i] = now;
    });
    if (Math.abs(this.padMove.x) + Math.abs(this.padMove.y) > 0) this.usingPad = true;
  }

  down(action) {
    return BINDINGS[action].some((c) => this.held.has(c));
  }

  hit(action) {
    return BINDINGS[action].some((c) => this.pressed.has(c));
  }

  up(action) {
    return BINDINGS[action].some((c) => this.released.has(c));
  }

  anyPressed() {
    return this.pressed.size > 0;
  }

  /** Movement intent: x = right, y = forward, magnitude <= 1. */
  moveVector() {
    let x = 0, y = 0;
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) y += 1;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) y -= 1;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) x += 1;
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) x -= 1;
    x += this.padMove.x;
    y += this.padMove.y;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
