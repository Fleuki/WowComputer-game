import * as THREE from 'three';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

/** Rotate angle `a` toward `b` by at most `maxStep`. */
export function turnToward(a, b, maxStep) {
  const d = wrapAngle(b - a);
  return a + clamp(d, -maxStep, maxStep);
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Deterministic PRNG so the arena looks the same every run. */
export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();

/** Distance from point p to segment ab. */
export function distPointSegment(p, a, b, outClosest) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const len2 = _ab.lengthSq();
  const t = len2 > 1e-8 ? clamp(_ap.dot(_ab) / len2, 0, 1) : 0;
  const cx = a.x + _ab.x * t, cy = a.y + _ab.y * t, cz = a.z + _ab.z * t;
  if (outClosest) outClosest.set(cx, cy, cz);
  const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Closest distance between segments p1q1 and p2q2 (Ericson, RTCD 5.1.9). */
export function distSegmentSegment(p1, q1, p2, q2, outOnFirst) {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s, t;
  const EPS = 1e-8;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const c1x = p1.x + _d1.x * s, c1y = p1.y + _d1.y * s, c1z = p1.z + _d1.z * s;
  const c2x = p2.x + _d2.x * t, c2y = p2.y + _d2.y * t, c2z = p2.z + _d2.z * t;
  if (outOnFirst) outOnFirst.set(c1x, c1y, c1z);
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Two-bone IK in world space. Writes the elbow/knee position into outMid and
 * returns the (possibly clamped) end position in outEnd.
 */
const _dir = new THREE.Vector3();
const _bend = new THREE.Vector3();
export function solveTwoBone(start, target, lenA, lenB, pole, outMid, outEnd) {
  _dir.subVectors(target, start);
  let dist = _dir.length();
  if (dist < 1e-5) { _dir.set(0, -1, 0); dist = 1e-5; } else _dir.divideScalar(dist);
  const L = clamp(dist, Math.abs(lenA - lenB) + 1e-3, lenA + lenB - 1e-3);
  const cosA = clamp((lenA * lenA + L * L - lenB * lenB) / (2 * lenA * L), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _bend.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
  if (_bend.lengthSq() < 1e-6) _bend.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _bend.normalize();
  outMid.copy(start).addScaledVector(_dir, lenA * cosA).addScaledVector(_bend, lenA * sinA);
  outEnd.copy(start).addScaledVector(_dir, L);
  return outEnd;
}

/** Create a canvas-backed texture. */
export function canvasTexture(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Cheap 2D value noise used for procedural textures. */
export function makeNoise2D(seed = 1) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rnd(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x, y) => vals[perm[(perm[x & 255] + y) & 255]];
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), w);
  };
}

export function fbm(noise, x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); a *= 0.5; f *= 2; }
  return s;
}
