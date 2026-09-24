import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, makeNoise2D, fbm, mulberry32, lerp } from './utils.js';

import { buildWater } from './water.js';

const ni = (g) => (g.index ? g.toNonIndexed() : g);

// Each boss gets its own take on the cathedral.
export const THEMES = {
  crimson: {
    fog: 0x2c171e, fog2: 0x3a0f16, fogDensity: 0.0125,
    zenith: 0x0d060b, horizon: 0x4a2229, glow: 0xffc49e, glow2: 0xff4030,
    hemi: 0xffc6b4, hemiGround: 0x1b0b10, hemiI: 0.6, hemi2: 0xff8a8a,
    sun: 0xffc29c, sunI: 2.3, sun2: 0xff6a4a, fill: 0xff8fa0, window: 0xffb899,
    hue: 345, stone: 0x9a8a90, pillar: 0x8d7d84, outer: 0x1d1216, far: 0x2a1c22,
    waterfall: 0xf0c8c0, shaft: 0xffc8a8, sigil: 0xff3048,
    leaves: [0xb3122c, 0x8e0d22, 0xd4243d, 0x6e0a1a, 0xe03a4f, 0x9a1830], leafEmissive: 0x3a0610, trunk: 0x1a1013,
    falls: [[-14, -46, 7, 46], [9, -50, 10, 52], [30, -40, 5, 40], [-34, -34, 5, 36], [0, -66, 12, 50]],
    water: false,
  },
  drowned: {
    fog: 0x0b1920, fog2: 0x24101a, fogDensity: 0.018,
    zenith: 0x03070a, horizon: 0x142a33, glow: 0x7fb6c4, glow2: 0xff5a50,
    hemi: 0x9cc2cc, hemiGround: 0x040a0d, hemiI: 0.42, hemi2: 0xc88a90,
    sun: 0xbcd8e4, sunI: 1.5, sun2: 0xff8070, fill: 0x6f9fb2, window: 0x8fc4d0,
    hue: 195, stone: 0x7c8b90, pillar: 0x6f8189, outer: 0x0c1518, far: 0x142228,
    waterfall: 0x9cc8d2, shaft: 0xa8d8e4, sigil: 0x6fd8e8,
    leaves: [0x4d6a70, 0x384f55, 0x6d8d93, 0x25353a, 0x7a1c28, 0x5a787e], leafEmissive: 0x04100f, trunk: 0x0e1618,
    falls: [[-14, -46, 7, 46], [9, -50, 10, 52], [30, -40, 5, 40], [-34, -34, 5, 36], [0, -66, 12, 50],
      [-30, 30, 6, 44], [32, 22, 5, 40], [-6, 48, 8, 48], [22, -52, 6, 50]],
    water: true,
  },
};

export const ARENA_RADIUS = 20.5;
const WALL_R = 27;
const BAYS = 12;

// Direction the "sun" glow comes from (behind the boss, far side of the hall).
export const SUN_DIR = new THREE.Vector3(-0.25, 0.42, -1).normalize();

// ------------------------------------------------------------------ sky
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition * 0.0);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;
const SKY_FRAG = /* glsl */ `
  uniform vec3 uSun;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uGlow2;
  uniform float uPhase;
  uniform float uTime;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
    float s = max(dot(d, uSun), 0.0);
    vec3 glow = mix(uGlow, uGlow2, uPhase * 0.6);
    col += glow * (pow(s, 5.0) * 0.6 + pow(s, 40.0) * 1.1 + pow(s, 1.6) * 0.14);
    // soft drifting haze bands
    vec2 uv = vec2(atan(d.x, d.z) * 3.0, d.y * 9.0);
    float n = noise(uv + vec2(uTime * 0.02, 0.0)) * noise(uv * 2.3 - vec2(uTime * 0.03, 0.0));
    col += glow * n * 0.12 * (1.0 - smoothstep(0.0, 0.6, h));
    col = mix(col, uHorizon * 0.6, (1.0 - smoothstep(-0.2, 0.0, d.y)));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeSkyMaterial(T) {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uZenith: { value: new THREE.Color(T.zenith) },
      uHorizon: { value: new THREE.Color(T.horizon) },
      uGlow: { value: new THREE.Color(T.glow) },
      uGlow2: { value: new THREE.Color(T.glow2) },
      uPhase: { value: 0 },
      uTime: { value: 0 },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

// ------------------------------------------------------------------ textures
function stoneTexture(seed = 3, hue = 340) {
  const noise = makeNoise2D(seed);
  const rnd = mulberry32(seed);
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#453a3f';
    g.fillRect(0, 0, w, h);
    const rows = 8;
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -rh * 0.8 : 0;
      while (x < w) {
        const bw = rh * (1.4 + rnd() * 1.2);
        const l = 38 + rnd() * 22;
        g.fillStyle = `hsl(${hue + rnd() * 20}, ${6 + rnd() * 6}%, ${l * 0.62}%)`;
        g.fillRect(x + 2, r * rh + 2, bw - 4, rh - 4);
        x += bw;
      }
    }
    const img = g.getImageData(0, 0, w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = fbm(noise, x / 40, y / 40, 4) - 0.5;
        const i = (y * w + x) * 4;
        const k = 1 + n * 0.55;
        img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
      }
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
}

function floorTextures(hue = 345) {
  const S = 2048;
  const R = 34; // world radius covered by the texture
  const ppu = S / 2 / R;
  const rnd = mulberry32(11);
  const noise = makeNoise2D(5);

  // Low-res puddle mask, upscaled with smoothing.
  const puddle = document.createElement('canvas');
  puddle.width = puddle.height = 256;
  {
    const g = puddle.getContext('2d');
    const img = g.createImageData(256, 256);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const n = fbm(noise, x / 26, y / 26, 5);
        const v = n > 0.53 ? Math.min(1, (n - 0.53) * 9) : 0;
        const i = (y * 256 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  const tiles = [];
  const ringDefs = [];
  let r = 3.6;
  while (r < R) {
    const wdt = r < 21 ? 1.55 : 2.2;
    ringDefs.push([r, r + wdt]);
    r += wdt;
  }
  for (const [r0, r1] of ringDefs) {
    if (r0 < 21.3 && r1 > 21.3) continue;
    const n = Math.max(6, Math.round((Math.PI * 2 * (r0 + r1) * 0.5) / (r0 < 21 ? 1.9 : 2.6)));
    const off = rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      tiles.push({ r0, r1, a0: off + (i / n) * Math.PI * 2, a1: off + ((i + 1) / n) * Math.PI * 2, shade: rnd(), outer: r0 >= 21 });
    }
  }

  const drawTiles = (g, fill) => {
    const cx = S / 2, cy = S / 2;
    for (const t of tiles) {
      g.beginPath();
      const inset = 0.05;
      g.arc(cx, cy, (t.r1 - inset) * ppu, t.a0 + inset / t.r1, t.a1 - inset / t.r1);
      g.arc(cx, cy, (t.r0 + inset) * ppu, t.a1 - inset / t.r0, t.a0 + inset / t.r0, true);
      g.closePath();
      g.fillStyle = fill(t);
      g.fill();
    }
  };

  const map = canvasTexture(S, S, (g) => {
    g.fillStyle = '#120c0f';
    g.fillRect(0, 0, S, S);
    drawTiles(g, (t) => {
      const l = t.outer ? 13 + t.shade * 7 : 19 + t.shade * 10;
      return `hsl(${hue + t.shade * 20}, ${7 + t.shade * 5}%, ${l}%)`;
    });
    // Central sigil plate.
    const cx = S / 2, cy = S / 2;
    g.fillStyle = '#3a2e33';
    g.beginPath(); g.arc(cx, cy, 3.5 * ppu, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a1215';
    g.lineWidth = 5;
    for (const rr of [3.4, 2.7, 1.2]) { g.beginPath(); g.arc(cx, cy, rr * ppu, 0, Math.PI * 2); g.stroke(); }
    g.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * 1.2 * ppu, cy + Math.sin(a) * 1.2 * ppu);
      g.quadraticCurveTo(cx + Math.cos(a + 0.25) * 2.2 * ppu, cy + Math.sin(a + 0.25) * 2.2 * ppu, cx + Math.cos(a + 0.1) * 2.7 * ppu, cy + Math.sin(a + 0.1) * 2.7 * ppu);
      g.stroke();
    }
    // Grime + wet darkening.
    const img = g.getImageData(0, 0, S, S);
    const pd = puddle.getContext('2d').getImageData(0, 0, 256, 256).data;
    for (let y = 0; y < S; y += 1) {
      for (let x = 0; x < S; x += 1) {
        const i = (y * S + x) * 4;
        const n = noise(x / 22, y / 22) * 0.6 + noise(x / 5, y / 5) * 0.4;
        const pi = ((y >> 3) * 256 + (x >> 3)) * 4;
        const wet = pd[pi] / 255;
        const k = (0.75 + n * 0.5) * (1 - wet * 0.35);
        img.data[i] *= k; img.data[i + 1] *= k; img.data[i + 2] *= k;
      }
    }
    g.putImageData(img, 0, 0);
  });

  const rough = canvasTexture(S, S, (g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, S, S);
    drawTiles(g, (t) => `rgb(${150 + t.shade * 60}, ${150 + t.shade * 60}, ${150 + t.shade * 60})`);
    g.globalCompositeOperation = 'multiply';
    g.filter = 'blur(6px) invert(1)';
    // Wet areas become glossy (dark in roughness).
    g.drawImage(puddle, 0, 0, S, S);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
  }, { srgb: false });

  const bump = canvasTexture(S / 2, S / 2, (g) => {
    const s2 = S / 2;
    g.fillStyle = '#000';
    g.fillRect(0, 0, s2, s2);
    g.save();
    g.scale(0.5, 0.5);
    drawTiles(g, (t) => `rgb(${200 + t.shade * 55},${200 + t.shade * 55},${200 + t.shade * 55})`);
    g.fillStyle = '#ccc';
    g.beginPath(); g.arc(S / 2, S / 2, 3.5 * ppu, 0, Math.PI * 2); g.fill();
    g.restore();
  }, { srgb: false });

  return { map, rough, bump };
}

function leafTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(w / 2, 2);
    g.quadraticCurveTo(w - 4, h * 0.4, w / 2, h - 2);
    g.quadraticCurveTo(4, h * 0.4, w / 2, 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 6); g.stroke();
  });
}

export function glowTexture(inner = 'rgba(255,220,170,1)', outer = 'rgba(255,120,40,0)') {
  return canvasTexture(64, 64, (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    rg.addColorStop(0, inner);
    rg.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.6)'));
    rg.addColorStop(1, outer);
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  });
}

// ------------------------------------------------------------------ geometry helpers
function pointedArchPath(path, halfW, spring, R, reverse = false) {
  // Pointed (gothic) arch made from two arcs of radius R.
  const cxL = -halfW + R, cxR = halfW - R;
  const apexY = spring + Math.sqrt(R * R - (R - halfW) * (R - halfW));
  const aL = Math.atan2(apexY - spring, 0 - cxL);
  const aR = Math.atan2(apexY - spring, 0 - cxR);
  if (!reverse) {
    path.lineTo(-halfW, spring);
    path.absarc(cxL, spring, R, Math.PI, aL, true);
    path.absarc(cxR, spring, R, aR, 0, true);
  } else {
    path.lineTo(halfW, spring);
    path.absarc(cxR, spring, R, 0, aR, false);
    path.absarc(cxL, spring, R, aL, Math.PI, false);
  }
  return apexY;
}

function lancetHole(cx, y0, halfW, spring, R) {
  const p = new THREE.Path();
  p.moveTo(cx - halfW, y0);
  const cxL = cx - halfW + R, cxR = cx + halfW - R;
  const apexY = spring + Math.sqrt(R * R - (R - halfW) * (R - halfW));
  p.lineTo(cx - halfW, spring);
  p.absarc(cxL, spring, R, Math.PI, Math.atan2(apexY - spring, cx - cxL), true);
  p.absarc(cxR, spring, R, Math.atan2(apexY - spring, cx - cxR), 0, true);
  p.lineTo(cx + halfW, y0);
  p.lineTo(cx - halfW, y0);
  return p;
}

function wallBayGeometry(width, height) {
  const hw = width / 2;
  const s = new THREE.Shape();
  const ow = hw - 1.1;
  s.moveTo(-hw, 0);
  s.lineTo(-ow, 0);
  pointedArchPath(s, ow, 12.5, ow * 1.6);
  s.lineTo(ow, 0);
  s.lineTo(hw, 0);
  s.lineTo(hw, height);
  s.lineTo(-hw, height);
  s.lineTo(-hw, 0);
  s.holes.push(lancetHole(-3.1, 21.2, 0.75, 25, 1.2));
  s.holes.push(lancetHole(3.1, 21.2, 0.75, 25, 1.2));
  const rose = new THREE.Path();
  rose.absarc(0, 26.2, 1.45, 0, Math.PI * 2, true);
  s.holes.push(rose);
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.4, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -0.7);

  // Arch moulding band.
  const b = new THREE.Shape();
  const bo = ow + 0.55;
  b.moveTo(-bo, 0);
  pointedArchPath(b, bo, 12.5, bo * 1.6);
  b.lineTo(bo, 0);
  b.lineTo(ow, 0);
  pointedArchPath(b, ow, 12.5, ow * 1.6, true);
  b.lineTo(-ow, 0);
  b.lineTo(-bo, 0);
  const band = new THREE.ExtrudeGeometry(b, { depth: 2.0, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1, curveSegments: 10 });
  band.translate(0, 0, -1.0);

  // A string course (horizontal cornice) above the arch.
  const cornice = new THREE.BoxGeometry(width, 0.5, 2.1);
  cornice.translate(0, 20.4, 0);
  const cornice2 = new THREE.BoxGeometry(width, 0.6, 2.3);
  cornice2.translate(0, height - 0.3, 0);

  const merged = mergeGeometries([g, band, cornice, cornice2].map(ni));
  merged.computeVertexNormals();
  return merged;
}

function pillarGeometry(height) {
  const parts = [];
  const core = new THREE.CylinderGeometry(1.0, 1.05, height, 16, 1);
  core.translate(0, height / 2, 0);
  parts.push(core);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const sh = new THREE.CylinderGeometry(0.3, 0.3, height, 8, 1);
    sh.translate(Math.cos(a) * 1.05, height / 2, Math.sin(a) * 1.05);
    parts.push(sh);
  }
  const base = new THREE.CylinderGeometry(1.75, 1.9, 1.4, 8, 1);
  base.translate(0, 0.7, 0);
  parts.push(base);
  const base2 = new THREE.CylinderGeometry(1.5, 1.75, 0.5, 8, 1);
  base2.translate(0, 1.65, 0);
  parts.push(base2);
  for (const y of [12.3, 20.3]) {
    const cap = new THREE.CylinderGeometry(1.75, 1.35, 0.9, 8, 1);
    cap.translate(0, y, 0);
    parts.push(cap);
  }
  const m = mergeGeometries(parts.map(ni));
  m.computeVertexNormals();
  return m;
}

// ------------------------------------------------------------------ waterfall
const FALL_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const FALL_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vDepth;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 uv = vUv;
    float streak = noise(vec2(uv.x * 38.0, uv.y * 2.2 + uTime * 1.6));
    streak += 0.6 * noise(vec2(uv.x * 90.0, uv.y * 5.0 + uTime * 2.8));
    streak = smoothstep(0.55, 1.4, streak);
    float edge = smoothstep(0.0, 0.18, uv.x) * (1.0 - smoothstep(0.82, 1.0, uv.x));
    float topFade = (1.0 - smoothstep(0.9, 1.0, uv.y));
    float mist = (1.0 - smoothstep(0.0, 0.25, uv.y));
    float a = (streak * 0.85 + 0.12 + mist * 0.6) * edge * topFade * uOpacity;
    gl_FragColor = vec4(uColor * (0.45 + streak * 0.5 + mist * 0.4), a);
  }
`;

// ------------------------------------------------------------------ light shaft
const SHAFT_VERT = /* glsl */ `
  varying vec2 vUv;
  varying float vFacing;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec3 n = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    gl_Position = projectionMatrix * mv;
  }
`;
const SHAFT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying float vFacing;
  varying float vDepth;
  void main() {
    float along = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
    float flick = 0.85 + 0.15 * sin(uTime * 0.7 + vUv.x * 12.0);
    float a = pow(vFacing, 2.5) * along * uOpacity * flick * smoothstep(3.0, 12.0, vDepth);
    gl_FragColor = vec4(uColor, a);
  }
`;

// ------------------------------------------------------------------ build
export function buildArena(scene, renderer, themeName = 'crimson', highQuality = true) {
  const T = THEMES[themeName];
  const rnd = mulberry32(42);
  const animated = [];
  const phaseTargets = {};
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  // Fog & sky
  const fog = new THREE.FogExp2(T.fog, T.fogDensity);
  const skyMat = makeSkyMaterial(T);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  root.add(sky);

  // Environment map from the sky gradient (for glossy reflections).
  let envTex;
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), makeSkyMaterial(T));
    envScene.add(envSky);
    // Bright arched windows reflected on wet stone.
    const winMat = new THREE.MeshBasicMaterial({ color: T.window, side: THREE.DoubleSide });
    for (let i = -2; i <= 2; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(6, 18), winMat);
      w.position.set(i * 12, 9, -40);
      envScene.add(w);
    }
    envTex = pmrem.fromScene(envScene, 0.02, 0.1, 200).texture;
    pmrem.dispose();
  }

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(T.hemi, T.hemiGround, T.hemiI);
  root.add(hemi);

  const sun = new THREE.DirectionalLight(T.sun, T.sunI);
  sun.position.copy(SUN_DIR).multiplyScalar(70);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -36; sc.right = 36; sc.top = 36; sc.bottom = -36;
  sc.near = 10; sc.far = 150;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  root.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(T.fill, 0.8);
  fill.position.set(8, 10, 30);
  root.add(fill);

  const rimFront = new THREE.DirectionalLight(0xffd9c4, 0.35);
  rimFront.position.set(-20, 6, 20);
  root.add(rimFront);

  // ---------------------------------------------------------------- floor
  const ft = floorTextures(T.hue);
  const floorMat = new THREE.MeshStandardMaterial({
    map: ft.map,
    roughnessMap: ft.rough,
    bumpMap: ft.bump,
    bumpScale: 2.2,
    roughness: 1.0,
    metalness: 0.05,
    envMapIntensity: 1.6,
  });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(34, 128).rotateX(-Math.PI / 2), floorMat);
  floor.receiveShadow = true;
  root.add(floor);

  // Glowing sigil in the centre (brightens in phase two).
  const sigilMat = new THREE.MeshBasicMaterial({
    color: T.sigil,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sigil = new THREE.Mesh(new THREE.RingGeometry(3.25, 3.45, 96).rotateX(-Math.PI / 2), sigilMat);
  sigil.position.y = 0.02;
  root.add(sigil);
  const sigil2 = new THREE.Mesh(new THREE.RingGeometry(1.12, 1.26, 64).rotateX(-Math.PI / 2), sigilMat);
  sigil2.position.y = 0.02;
  root.add(sigil2);
  phaseTargets.sigil = sigilMat;

  // Outer ground beyond the hall.
  const outerMat = new THREE.MeshStandardMaterial({ color: T.outer, roughness: 0.9 });
  const outer = new THREE.Mesh(new THREE.RingGeometry(33.5, 220, 64, 1).rotateX(-Math.PI / 2), outerMat);
  outer.position.y = -0.05;
  outer.receiveShadow = true;
  root.add(outer);

  // ---------------------------------------------------------------- stone
  const stoneTex = stoneTexture(3, T.hue - 5);
  stoneTex.repeat.set(0.22, 0.22);
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, color: T.stone, roughness: 0.88, metalness: 0.0, envMapIntensity: 0.4 });
  const pillarTex = stoneTex.clone();
  pillarTex.repeat.set(3, 7);
  pillarTex.needsUpdate = true;
  const pillarMat = new THREE.MeshStandardMaterial({ map: pillarTex, color: T.pillar, roughness: 0.85, envMapIntensity: 0.4 });

  // Curb that marks the arena edge.
  const curbProfile = [
    new THREE.Vector2(21.3, 0), new THREE.Vector2(21.3, 0.25), new THREE.Vector2(21.45, 0.4),
    new THREE.Vector2(22.3, 0.4), new THREE.Vector2(22.45, 0.25), new THREE.Vector2(22.45, 0),
  ];
  const curb = new THREE.Mesh(new THREE.LatheGeometry(curbProfile, 128), stoneMat);
  curb.receiveShadow = true;
  curb.castShadow = true;
  root.add(curb);

  // Wall bays and pillars (instanced).
  const bayWidth = 2 * WALL_R * Math.sin(Math.PI / BAYS) - 1.6;
  const wallGeo = wallBayGeometry(bayWidth, 30);
  const walls = new THREE.InstancedMesh(wallGeo, stoneMat, BAYS);
  const pillarGeo = pillarGeometry(32);
  const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, BAYS);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pillarPositions = [];
  for (let i = 0; i < BAYS; i++) {
    const a = (i / BAYS) * Math.PI * 2;
    const px = Math.sin(a) * WALL_R, pz = Math.cos(a) * WALL_R;
    pillarPositions.push(new THREE.Vector3(px, 0, pz));
    m4.compose(new THREE.Vector3(px, 0, pz), q.setFromAxisAngle(up, a), new THREE.Vector3(1, 1, 1));
    pillars.setMatrixAt(i, m4);
    const b = a + Math.PI / BAYS;
    const rr = WALL_R * Math.cos(Math.PI / BAYS);
    m4.compose(new THREE.Vector3(Math.sin(b) * rr, 0, Math.cos(b) * rr), q.setFromAxisAngle(up, b), new THREE.Vector3(1, 1, 1));
    walls.setMatrixAt(i, m4);
  }
  walls.castShadow = walls.receiveShadow = true;
  pillars.castShadow = pillars.receiveShadow = true;
  root.add(walls, pillars);

  // ---------------------------------------------------------------- distant architecture
  const farMat = new THREE.MeshStandardMaterial({ color: T.far, roughness: 1, envMapIntensity: 0.2 });
  const farParts = [];
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    // Bias towers towards the bright far side (−Z).
    const back = Math.cos(a - Math.PI) * 0.5 + 0.5;
    const dist = 55 + rnd() * 70;
    const h = 20 + rnd() * 45 + back * 25;
    const w = 3 + rnd() * 6;
    const x = Math.sin(a) * dist, z = Math.cos(a) * dist;
    const tower = new THREE.BoxGeometry(w, h, w);
    tower.translate(x, h / 2 - 1, z);
    farParts.push(tower);
    const spire = new THREE.ConeGeometry(w * 0.72, h * 0.45, 4);
    spire.rotateY(Math.PI / 4);
    spire.translate(x, h - 1 + h * 0.225, z);
    farParts.push(spire);
    if (rnd() < 0.5) {
      const pin = new THREE.ConeGeometry(w * 0.2, h * 0.3, 4);
      pin.translate(x + w * 0.45, h * 0.85, z + w * 0.45);
      farParts.push(pin);
    }
  }
  // Great facade on the far side with three huge arches.
  {
    const s = new THREE.Shape();
    s.moveTo(-40, -2);
    s.lineTo(-40, 55);
    s.lineTo(40, 55);
    s.lineTo(40, -2);
    s.lineTo(-40, -2);
    for (const cx of [-24, 0, 24]) {
      const hole = new THREE.Path();
      const hw = cx === 0 ? 8 : 6;
      hole.moveTo(cx - hw, 4);
      const R = hw * 1.7;
      const spring = cx === 0 ? 30 : 24;
      const apex = spring + Math.sqrt(R * R - (R - hw) * (R - hw));
      hole.lineTo(cx - hw, spring);
      hole.absarc(cx - hw + R, spring, R, Math.PI, Math.atan2(apex - spring, cx - (cx - hw + R)), true);
      hole.absarc(cx + hw - R, spring, R, Math.atan2(apex - spring, cx - (cx + hw - R)), 0, true);
      hole.lineTo(cx + hw, 4);
      hole.lineTo(cx - hw, 4);
      s.holes.push(hole);
    }
    const fac = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false, curveSegments: 12 });
    fac.translate(0, 0, -72);
    farParts.push(fac);
  }
  const far = new THREE.Mesh(mergeGeometries(farParts.map(ni)), farMat);
  root.add(far);

  // ---------------------------------------------------------------- waterfalls
  const fallMat = new THREE.ShaderMaterial({
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(T.waterfall) }, uOpacity: { value: 0.42 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const falls = T.falls;
  for (const [x, z, w, h] of falls) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 1, 1), fallMat);
    m.position.set(x, h / 2 - 3, z);
    m.lookAt(0, h / 2 - 3, 0);
    root.add(m);
  }
  animated.push((t) => { fallMat.uniforms.uTime.value = t; });

  // ---------------------------------------------------------------- foliage
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTexture(),
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0,
    emissive: T.leafEmissive,
    emissiveIntensity: 0.6,
  });
  const leafGeo = new THREE.PlaneGeometry(0.42, 0.42);
  const leafList = [];
  const leafColors = T.leaves;
  const addCluster = (cx, cy, cz, rx, ry, rz, n, sizeMul = 1, hang = 0) => {
    for (let i = 0; i < n; i++) {
      let x, y, z;
      do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
      const yy = y < 0 ? y * (1 + hang) : y;
      leafList.push({ p: [cx + x * rx, cy + yy * ry, cz + z * rz], s: (0.7 + rnd() * 0.8) * sizeMul, r: [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28], c: leafColors[Math.floor(rnd() * leafColors.length)] });
    }
  };

  // Bushes along the curb.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
    const r = 23.4 + rnd() * 1.5;
    addCluster(Math.sin(a) * r, 0.7, Math.cos(a) * r, 1.6, 0.9, 1.6, 170);
  }
  // Trees seen through the arches.
  const trunkParts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rnd() * 0.35;
    const r = 33 + rnd() * 12;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const h = 9 + rnd() * 7;
    const pts = [];
    let px = x, pz = z;
    for (let k = 0; k <= 5; k++) {
      pts.push(new THREE.Vector3(px, (k / 5) * h, pz));
      px += (rnd() - 0.5) * 1.6; pz += (rnd() - 0.5) * 1.6;
    }
    trunkParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, 0.45, 6));
    for (let b = 0; b < 3; b++) {
      const top = pts[5];
      const bx = top.x + (rnd() - 0.5) * 6, bz = top.z + (rnd() - 0.5) * 6, by = top.y + rnd() * 2.5;
      const mid = pts[3];
      trunkParts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([mid.clone(), new THREE.Vector3((mid.x + bx) / 2, (mid.y + by) / 2 + 1, (mid.z + bz) / 2), new THREE.Vector3(bx, by, bz)]), 8, 0.2, 5));
      addCluster(bx, by, bz, 3.2, 2.2, 3.2, 230, 1.4, 0.8);
    }
  }
  const trunks = new THREE.Mesh(mergeGeometries(trunkParts.map(ni)), new THREE.MeshStandardMaterial({ color: T.trunk, roughness: 1 }));
  trunks.castShadow = true;
  root.add(trunks);

  // Hanging vines on pillar capitals.
  for (const p of pillarPositions) {
    const dir = p.clone().normalize();
    addCluster(p.x - dir.x * 1.5, 12.4, p.z - dir.z * 1.5, 1.6, 1.0, 1.6, 90, 1, 2.5);
    if (rnd() < 0.6) addCluster(p.x - dir.x * 1.3, 20.5, p.z - dir.z * 1.3, 1.3, 0.8, 1.3, 60, 1, 3);
  }

  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, leafList.length);
  const e = new THREE.Euler();
  const col = new THREE.Color();
  leafList.forEach((L, i) => {
    e.set(L.r[0], L.r[1], L.r[2]);
    m4.compose(new THREE.Vector3(...L.p), q.setFromEuler(e), new THREE.Vector3(L.s, L.s, L.s));
    leaves.setMatrixAt(i, m4);
    leaves.setColorAt(i, col.set(L.c));
  });
  leaves.castShadow = true;
  root.add(leaves);

  // ---------------------------------------------------------------- lanterns
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x1e1a1c, roughness: 0.45, metalness: 0.8 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xffb070, emissive: 0xffa050, emissiveIntensity: 4.5 });
  const lanternGeo = (() => {
    const parts = [];
    const top = new THREE.ConeGeometry(0.55, 0.6, 8); top.translate(0, 0.85, 0); parts.push(top);
    const ringT = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 8); ringT.translate(0, 0.55, 0); parts.push(ringT);
    const ringB = new THREE.CylinderGeometry(0.42, 0.5, 0.14, 8); ringB.translate(0, -0.55, 0); parts.push(ringB);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const bar = new THREE.CylinderGeometry(0.035, 0.035, 1.1, 4);
      bar.translate(Math.cos(a) * 0.46, 0, Math.sin(a) * 0.46);
      parts.push(bar);
    }
    const tip = new THREE.ConeGeometry(0.12, 0.5, 6); tip.rotateX(Math.PI); tip.translate(0, -0.85, 0); parts.push(tip);
    return mergeGeometries(parts.map(ni));
  })();
  const coreGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8);
  const flameTex = glowTexture();
  const lanternDefs = [
    [-9, 11.5, -8, true], [10, 10, -10, true], [13, 12.5, 6, false], [-14, 12, 7, true], [2, 14, -16, false], [-4, 13.5, 14, false],
  ];
  const lanterns = [];
  for (const [x, y, z, lit] of lanternDefs) {
    const g = new THREE.Group();
    g.position.set(x, 36, z);
    const chainLen = 36 - y;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, chainLen, 4), metalMat);
    chain.position.y = -chainLen / 2;
    g.add(chain);
    const body = new THREE.Group();
    body.position.y = -chainLen - 0.9;
    body.add(new THREE.Mesh(lanternGeo, metalMat));
    body.add(new THREE.Mesh(coreGeo, glowMat));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: 0xffb070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
    halo.scale.set(4, 4, 1);
    body.add(halo);
    if (lit) {
      const l = new THREE.PointLight(0xff9a50, 40, 26, 1.6);
      l.position.y = -0.3;
      body.add(l);
      body.userData.light = l;
    }
    g.add(body);
    g.userData = { phase: rnd() * 6, amp: 0.02 + rnd() * 0.02 };
    root.add(g);
    lanterns.push(g);
  }
  animated.push((t) => {
    for (const g of lanterns) {
      g.rotation.z = Math.sin(t * 0.6 + g.userData.phase) * g.userData.amp;
      g.rotation.x = Math.cos(t * 0.45 + g.userData.phase) * g.userData.amp;
      const l = g.children[1].userData.light;
      if (l) l.intensity = 40 * (0.9 + Math.sin(t * 7 + g.userData.phase) * 0.05 + Math.sin(t * 13.3) * 0.04);
    }
  });

  // ---------------------------------------------------------------- candles
  const candleMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.6, emissive: 0x402010, emissiveIntensity: 0.4 });
  const candleParts = [];
  const flames = [];
  const flameMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,235,190,1)', 'rgba(255,110,30,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.11;
    const r = 21.85;
    for (let k = 0; k < 3; k++) {
      const h = 0.25 + rnd() * 0.45;
      const cx = Math.sin(a + (k - 1) * 0.022) * (r + (rnd() - 0.5) * 0.3);
      const cz = Math.cos(a + (k - 1) * 0.022) * (r + (rnd() - 0.5) * 0.3);
      const c = new THREE.CylinderGeometry(0.06, 0.07, h, 6);
      c.translate(cx, 0.4 + h / 2, cz);
      candleParts.push(c);
      const f = new THREE.Sprite(flameMat);
      f.position.set(cx, 0.4 + h + 0.09, cz);
      f.scale.set(0.35, 0.5, 1);
      f.userData.p = rnd() * 10;
      root.add(f);
      flames.push(f);
    }
  }
  root.add(new THREE.Mesh(mergeGeometries(candleParts.map(ni)), candleMat));
  animated.push((t) => {
    for (const f of flames) {
      const k = 0.85 + Math.sin(t * 11 + f.userData.p) * 0.1 + Math.sin(t * 23 + f.userData.p * 2) * 0.06;
      f.scale.set(0.33 * k, 0.5 * k, 1);
    }
  });

  // ---------------------------------------------------------------- light shafts
  const shaftMat = new THREE.ShaderMaterial({
    vertexShader: SHAFT_VERT,
    fragmentShader: SHAFT_FRAG,
    uniforms: { uColor: { value: new THREE.Color(T.shaft) }, uOpacity: { value: 0.035 }, uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const shaftGeo = new THREE.CylinderGeometry(3.2, 1.6, 60, 20, 1, true);
  shaftGeo.translate(0, 30, 0);
  for (let i = -2; i <= 2; i++) {
    const a = Math.PI + i * (Math.PI / BAYS) * 2 + Math.PI / BAYS * 0.0;
    const r = WALL_R - 1;
    const base = new THREE.Vector3(Math.sin(a) * r * 0.5, 0, Math.cos(a) * r * 0.5);
    const s = new THREE.Mesh(shaftGeo, shaftMat);
    s.position.copy(base).addScaledVector(SUN_DIR, -2);
    s.quaternion.setFromUnitVectors(up, SUN_DIR);
    s.scale.set(0.9 + rnd() * 0.5, 1, 0.9 + rnd() * 0.5);
    root.add(s);
  }
  animated.push((t) => { shaftMat.uniforms.uTime.value = t; });

  // ---------------------------------------------------------------- phase shift
  const base = {
    fog: new THREE.Color(T.fog), fog2: new THREE.Color(T.fog2),
    sun: new THREE.Color(T.sun), sun2: new THREE.Color(T.sun2),
    hemi: new THREE.Color(T.hemi), hemi2: new THREE.Color(T.hemi2),
  };
  const water = T.water ? buildWater(root, highQuality) : null;
  let phaseK = 0;
  let phaseTarget = 0;

  return {
    name: themeName,
    root,
    water,
    pillarPositions,
    activate() {
      scene.fog = fog;
      scene.environment = envTex;
      scene.environmentIntensity = 0.55;
      root.visible = true;
    },
    deactivate() {
      root.visible = false;
    },
    update(dt, t) {
      skyMat.uniforms.uTime.value = t;
      for (const fn of animated) fn(t);
      phaseK += (phaseTarget - phaseK) * (1 - Math.exp(-1.2 * dt));
      skyMat.uniforms.uPhase.value = phaseK;
      fog.color.lerpColors(base.fog, base.fog2, phaseK);
      if (water) water.update(t, phaseK);
      sun.color.lerpColors(base.sun, base.sun2, phaseK * 0.7);
      hemi.color.lerpColors(base.hemi, base.hemi2, phaseK * 0.6);
      sigilMat.opacity = lerp(0.18, 0.7, phaseK) * (0.85 + Math.sin(t * 3) * 0.15);
    },
    setPhase(k) { phaseTarget = k; },
    resetPhase() { phaseTarget = 0; phaseK = 0; },
    setQuality(high) {
      sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    },
  };
}
