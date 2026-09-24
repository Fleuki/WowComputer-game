import * as THREE from 'three';
import { canvasTexture, mulberry32, damp, clamp } from './utils.js';

// Vespera, the candle moth: model built from the turnaround reference.
// Big round porcelain head with a face plate, feathered antennae, a floating
// candle flame, a fluffy ruff with a brooch, two pairs of eye-spot wings worn
// like a cloak, a slim black body with gold trim and a golden rapier.

const IVORY = '#ece3d1';
const WING = '#e4d7bf';
const GOLD = 0xc9a24a;

// Overlapping scale pattern shared by the head and the wings.
function drawScales(g, w, h, base, size = 9, seed = 5) {
  const rnd = mulberry32(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let y = -size; y < h + size; y += size * 0.7) {
    const row = Math.round(y / (size * 0.7));
    for (let x = (row % 2) * size * 0.5 - size; x < w + size; x += size) {
      const l = rnd();
      g.fillStyle = `rgba(${l < 0.5 ? '255,250,240' : '120,100,80'},${0.05 + rnd() * 0.07})`;
      g.beginPath();
      g.arc(x, y, size * 0.62, 0, Math.PI);
      g.fill();
      g.strokeStyle = 'rgba(110,90,70,0.16)';
      g.lineWidth = 1;
      g.stroke();
    }
  }
}

function headTexture() {
  return canvasTexture(256, 256, (g, w, h) => drawScales(g, w, h, IVORY, 11, 3));
}

function faceTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    drawScales(g, w, h, IVORY, 14, 9);
    // Gold ornament on the forehead: a tall flame-leaf, two side leaves and a dot.
    const cx = w / 2;
    const leaf = (x, y, rw, rh, rot) => {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.beginPath();
      g.moveTo(0, -rh);
      g.quadraticCurveTo(rw, 0, 0, rh);
      g.quadraticCurveTo(-rw, 0, 0, -rh);
      g.fill();
      g.restore();
    };
    const grad = g.createLinearGradient(0, 100, 0, 260);
    grad.addColorStop(0, '#dcae48');
    grad.addColorStop(1, '#9a7022');
    g.fillStyle = grad;
    leaf(cx, 172, 18, 64, 0);
    leaf(cx - 38, 198, 10, 32, -0.55);
    leaf(cx + 38, 198, 10, 32, 0.55);
    g.beginPath();
    g.arc(cx, 262, 9, 0, Math.PI * 2);
    g.fill();
  });
}

function wingTexture(kind) {
  const small = kind === 'lower';
  return canvasTexture(256, 384, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // Wing outline: narrow where it joins the shoulder, broad rounded tip.
    const shape = () => {
      g.beginPath();
      g.moveTo(w * 0.5, 4);
      g.bezierCurveTo(w * 0.98, h * 0.12, w * 1.0, h * 0.72, w * 0.62, h - 6);
      g.quadraticCurveTo(w * 0.5, h + 2, w * 0.38, h - 6);
      g.bezierCurveTo(w * 0.0, h * 0.72, w * 0.02, h * 0.12, w * 0.5, 4);
      g.closePath();
    };
    g.save();
    shape();
    g.clip();
    drawScales(g, w, h, WING, 12, small ? 21 : 13);
    // Soft brown shading toward the edges.
    const edge = g.createRadialGradient(w / 2, h * 0.45, w * 0.2, w / 2, h * 0.5, w * 0.75);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, 'rgba(80,60,40,0.35)');
    g.fillStyle = edge;
    g.fillRect(0, 0, w, h);
    // Eye spot: dark ring, gold ring, dark centre.
    const ex = w / 2, ey = h * (small ? 0.58 : 0.5), r = w * (small ? 0.2 : 0.28);
    const ring = (rad, col) => { g.fillStyle = col; g.beginPath(); g.arc(ex, ey, rad, 0, Math.PI * 2); g.fill(); };
    ring(r, '#5d5246');
    ring(r * 0.78, '#e2d3b4');
    ring(r * 0.68, '#c49a3e');
    ring(r * 0.5, '#4a4038');
    ring(r * 0.2, '#6b5e50');
    // Dark scalloped band near the tip.
    g.fillStyle = 'rgba(70,60,52,0.55)';
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.arc(w * (0.12 + i * 0.152), h * (small ? 0.9 : 0.86), w * 0.075, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // Thin darker outline.
    shape();
    g.strokeStyle = 'rgba(90,72,54,0.8)';
    g.lineWidth = 3;
    g.stroke();
  });
}

function glowTex() {
  return canvasTexture(64, 64, (g, w, h) => {
    const rg = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    rg.addColorStop(0, 'rgba(255,240,200,1)');
    rg.addColorStop(0.3, 'rgba(255,190,90,0.55)');
    rg.addColorStop(1, 'rgba(255,140,40,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, h);
  });
}

/** Feathered antenna: a curved quill with serrated vanes, shaded by vertex colour. */
function featherGeometry(side) {
  const pts = [
    [0.1, 0.22, -0.02], [0.16, 0.42, 0.0], [0.28, 0.6, -0.03], [0.44, 0.66, -0.06], [0.58, 0.6, -0.08],
  ].map(([x, y, z]) => new THREE.Vector3(x * side, y, z));
  const curve = new THREE.CatmullRomCurve3(pts);
  const N = 30;
  const pos = [], col = [], idx = [];
  const shaft = new THREE.Color(0x2b2119), vane = new THREE.Color(0xe9dcc2), tipCol = new THREE.Color(0xcdbb9a);
  const Z = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const P = curve.getPoint(t);
    const T = curve.getTangent(t);
    const S = new THREE.Vector3().crossVectors(T, Z).normalize();
    let w = t < 0.14 ? 0.004 : 0.085 * Math.sin(Math.PI * Math.pow((t - 0.14) / 0.86, 0.75));
    w *= i % 2 ? 1 : 0.7; // serrated barbs
    const sweep = T.clone().multiplyScalar(w * 0.45);
    const L = P.clone().addScaledVector(S, w).add(sweep);
    const R = P.clone().addScaledVector(S, -w).add(sweep);
    pos.push(L.x, L.y, L.z, P.x, P.y, P.z, R.x, R.y, R.z);
    const edge = vane.clone().lerp(tipCol, t);
    col.push(edge.r, edge.g, edge.b, shaft.r, shaft.g, shaft.b, edge.r, edge.g, edge.b);
    if (i < N) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function wingGeometry(w, h) {
  const g = new THREE.PlaneGeometry(w, h, 6, 8);
  g.translate(0, -h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / w, y = p.getY(i) / h;
    // Gentle cup so the wing is not paper-flat.
    p.setZ(i, -x * x * 0.12 * w - y * y * 0.04);
  }
  g.computeVertexNormals();
  return g;
}

export function buildVespera() {
  const mats = {
    body: new THREE.MeshStandardMaterial({ color: 0x191512, roughness: 0.45, metalness: 0.35 }),
    gold: new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 1.0, envMapIntensity: 1.3 }),
    head: new THREE.MeshStandardMaterial({ map: headTexture(), roughness: 0.42, metalness: 0 }),
    face: new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.35, metalness: 0 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.12, metalness: 0.2 }),
    glint: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc860, emissiveIntensity: 3 }),
    feather: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    ruff: new THREE.MeshStandardMaterial({ color: 0xe7dbc4, roughness: 0.9 }),
    wingU: new THREE.MeshStandardMaterial({ map: wingTexture('upper'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, emissive: 0xffd9a0, emissiveIntensity: 0 }),
    wingL: new THREE.MeshStandardMaterial({ map: wingTexture('lower'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, emissive: 0xffd9a0, emissiveIntensity: 0 }),
    blade: new THREE.MeshStandardMaterial({ color: 0xe8c060, roughness: 0.2, metalness: 1, emissive: 0xffb040, emissiveIntensity: 0.55 }),
    flame: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.0, 0.42) }),
  };

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // Legs: thin black with gold knee guards, ending in points.
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.42;
  body.add(pelvis);
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.06, 0, 0);
    hip.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.23, 7).translate(0, -0.115, 0), mats.body));
    const knee = new THREE.Group();
    knee.position.y = -0.22;
    const guard = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.08, 5).rotateX(Math.PI / 2 + 0.3).translate(0, 0.01, 0.025), mats.gold);
    knee.add(guard);
    knee.add(new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.22, 7).rotateX(Math.PI).translate(0, -0.11, 0), mats.body));
    const ankle = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.008, 5, 10).rotateX(Math.PI / 2), mats.gold);
    ankle.position.y = -0.13;
    knee.add(ankle);
    hip.add(knee);
    pelvis.add(hip);
    legs.push({ hip, knee });
  }

  // Torso
  const torso = new THREE.Group();
  torso.position.y = 0.42;
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.16, 4, 10), mats.body);
  chest.position.y = 0.15;
  chest.scale.set(1, 1, 0.85);
  torso.add(chest);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.012, 6, 16).rotateX(Math.PI / 2), mats.gold);
  belt.position.y = 0.06;
  torso.add(belt);

  // Fluffy ruff (two rings of tufts) and the brooch with a tassel.
  const ruffParts = [];
  // Tufts point outward and droop over the shoulders.
  for (let layer = 0; layer < 3; layer++) {
    const n = [22, 18, 14][layer];
    const len = [0.17, 0.14, 0.1][layer];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + layer * 0.13;
      const tuft = new THREE.ConeGeometry(0.045 - layer * 0.006, len, 5);
      tuft.translate(0, len / 2, 0);
      tuft.rotateX(1.95 + layer * 0.22);
      tuft.rotateY(a);
      tuft.translate(Math.sin(a) * (0.07 + layer * 0.01), 0.36 - layer * 0.035, Math.cos(a) * (0.07 + layer * 0.01));
      ruffParts.push(tuft);
    }
  }
  const ruff = new THREE.Group();
  for (const g of ruffParts) ruff.add(new THREE.Mesh(g, mats.ruff));
  torso.add(ruff);
  const brooch = new THREE.Group();
  brooch.position.set(0, 0.27, 0.13);
  brooch.add(new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.009, 6, 14), mats.gold));
  brooch.add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8).scale(1, 1, 0.5), mats.body));
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 6).translate(0, -0.06, 0), mats.gold);
  brooch.add(tassel);
  torso.add(brooch);

  // Head: round, with a separate face plate that bulges forward.
  const head = new THREE.Group();
  head.position.y = 0.4;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.28, 28, 22), mats.head);
  skull.position.y = 0.2;
  skull.scale.set(1, 0.96, 0.96);
  head.add(skull);
  const faceGeo = new THREE.SphereGeometry(0.29, 28, 22, Math.PI / 2 - 1.12, 2.24, 0.32, 1.95);
  {
    const p = faceGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0) p.setX(i, p.getX(i) * (1 + (y / 0.29) * 0.38));
    }
    faceGeo.computeVertexNormals();
  }
  const face = new THREE.Mesh(faceGeo, mats.face);
  face.position.set(0, 0.2, 0.04);
  face.scale.set(1, 1, 0.92);
  head.add(face);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 18, 14), mats.eye);
    eye.scale.set(0.78, 0.98, 0.3);
    eye.position.set(side * 0.105, 0.16, 0.285);
    eye.rotation.set(0.1, side * 0.32, -side * 0.5);
    head.add(eye);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mats.glint);
    glint.position.set(side * 0.118, 0.155, 0.318);
    head.add(glint);
    const feather = new THREE.Mesh(featherGeometry(side), mats.feather);
    feather.position.y = 0.18;
    head.add(feather);
  }

  // Candle flame floating above the head (with a real light).
  const flame = new THREE.Group();
  flame.position.set(0, 0.62, 0.02);
  head.add(flame);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), mats.flame);
  core.scale.set(1, 1.7, 1);
  flame.add(core);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.45 }));
  halo.scale.set(0.55, 0.7, 1);
  flame.add(halo);
  const light = new THREE.PointLight(0xffb45c, 1.5, 4.5, 1.6);
  light.position.y = 0.25;
  flame.add(light);

  // Wings: two pairs worn like a cloak.
  const wings = [];
  const addWing = (side, lower) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.08, lower ? 0.25 : 0.33, lower ? -0.1 : -0.075);
    pivot.rotation.order = 'YXZ';
    const mesh = new THREE.Mesh(lower ? wingGeometry(0.34, 0.42) : wingGeometry(0.46, 0.68), lower ? mats.wingL : mats.wingU);
    mesh.castShadow = true;
    pivot.add(mesh);
    torso.add(pivot);
    wings.push({ pivot, side, lower, yaw: 0, spread: 0, tilt: 0 });
  };
  addWing(-1, true); addWing(1, true);
  addWing(-1, false); addWing(1, false);

  // Right arm with the golden rapier.
  const armR = new THREE.Group();
  armR.position.set(-0.11, 0.26, 0.02);
  armR.rotation.order = 'YXZ';
  torso.add(armR);
  armR.add(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.24, 6).rotateX(Math.PI / 2).translate(0, 0, 0.12), mats.body));
  const needle = new THREE.Group();
  needle.position.z = 0.24;
  armR.add(needle);
  needle.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 6).rotateX(Math.PI / 2), mats.body));
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mats.gold);
  pommel.position.z = -0.07;
  needle.add(pommel);
  const guardArc = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.008, 5, 14, Math.PI * 1.1), mats.gold);
  guardArc.position.set(0.02, 0, 0.0);
  guardArc.rotation.set(0, Math.PI / 2, 0.3);
  needle.add(guardArc);
  const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 5).rotateZ(Math.PI / 2), mats.gold);
  cross.position.z = 0.06;
  needle.add(cross);
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.95, 6).rotateX(Math.PI / 2).translate(0, 0, 0.54), mats.blade);
  needle.add(blade);

  const armL = new THREE.Group();
  armL.position.set(0.11, 0.26, 0.02);
  armL.rotation.order = 'YXZ';
  torso.add(armL);
  armL.add(new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.24, 6).rotateX(Math.PI / 2).translate(0, 0, 0.12), mats.body));

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  core.castShadow = false;

  return { root, body, pelvis, legs, torso, head, armR, armL, needle, blade, wings, flame, core, halo, light, mats };
}

/**
 * Wings and flame. `s` carries the heroine's state: name, speed, vy, onGround,
 * hpFrac, flap (0..1 pulse after a double jump), t.
 */
export function animateVespera(m, s, dt) {
  const t = s.t;
  const speedK = clamp(s.speed / 7.4, 0, 1);
  for (const w of m.wings) {
    let yaw = w.lower ? 0.2 : 0.3;
    let spread = w.lower ? 0.62 : 0.42;
    let tilt = w.lower ? 0.2 : 0.12;
    spread += Math.sin(t * 2.1 + (w.lower ? 1 : 0)) * 0.03;
    tilt += speedK * 0.55;
    yaw -= speedK * 0.2;
    if (!s.onGround) {
      if (s.vy < 0) { spread += 0.35; tilt += 0.1; }
      else { spread += 0.15; tilt += 0.25; }
    }
    switch (s.name) {
      case 'dash': yaw = 0.12; spread = 0.08; tilt = 1.15; break;
      case 'dive': yaw = 0.15; spread = 0.1; tilt = 1.25; break;
      case 'storm': yaw = 0.95; spread = 1.45; tilt = 0.05; break;
      case 'bind': yaw = 0.12; spread = (w.lower ? 1.25 : 1.0) + Math.sin(t * 9) * 0.06; tilt = -0.15; break;
      case 'hurt': spread += Math.sin(t * 40) * 0.2; break;
      case 'dead': spread = 0.05; tilt = 0.3; break;
      default: break;
    }
    // Big flap after a double jump.
    spread += s.flap * (w.lower ? 0.8 : 1.1) * Math.sin(s.flap * Math.PI);
    const k = s.name === 'storm' || s.name === 'dash' ? 22 : 12;
    w.yaw = damp(w.yaw, yaw, k, dt);
    w.spread = damp(w.spread, spread, k, dt);
    w.tilt = damp(w.tilt, tilt, k, dt);
    w.pivot.rotation.set(w.tilt, w.side * w.yaw, w.side * w.spread);
  }
  const glow = s.name === 'bind' ? 0.35 : 0;
  m.mats.wingU.emissiveIntensity = damp(m.mats.wingU.emissiveIntensity, glow, 8, dt);
  m.mats.wingL.emissiveIntensity = m.mats.wingU.emissiveIntensity;

  // The candle burns lower as she loses masks.
  const hp = clamp(s.hpFrac, 0, 1);
  const flick = 0.88 + Math.sin(t * 13) * 0.06 + Math.sin(t * 29.7) * 0.05 + (hp < 0.3 ? Math.sin(t * 7) * 0.12 : 0);
  const size = (0.45 + 0.55 * hp) * flick * (s.name === 'bind' ? 1.25 : 1);
  m.core.scale.set(size, size * 1.7, size);
  m.halo.scale.set(0.4 * size, 0.55 * size, 1);
  m.light.intensity = (0.6 + 1.4 * hp) * flick * (s.name === 'bind' ? 1.6 : 1);
  m.flame.position.y = 0.62 + Math.sin(t * 2.3) * 0.02;
  m.flame.visible = s.name !== 'dead' || s.deadT < 0.8;
}
