import * as THREE from 'three';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { FX } from './fx.js';
import { buildArena } from './arena.js';
import { Ambient } from './ambient.js';
import { Post } from './post.js';
import { Player } from './player.js';
import { Boss } from './boss.js';
import { CameraRig } from './camera.js';
import { HUD } from './hud.js';

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// ?low in the URL starts in the lightweight mode (for weaker GPUs).
let quality = !/[?&]low\b/.test(location.search);
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, quality ? 1.5 : 1);
renderer.setPixelRatio(pixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 900);

// ------------------------------------------------------------------ game object
const game = {
  scene,
  camera,
  renderer,
  time: 0,
  hitStop: 0,
  timeScale: 1,
  difficulty: 'normal',
  state: 'menu',
  stats: { hitsTaken: 0, time: 0, attempts: 0 },
  timers: [],
  hadLock: false,
};
window.__game = game; // handy for debugging in the console
game.renderNow = () => game.post.render(1 / 60, performance.now() / 1000, 0);

game.input = new Input(canvas);
game.audio = new AudioSys();
game.fx = new FX(scene);
game.arena = buildArena(scene, renderer);
game.ambient = new Ambient(scene);
game.post = new Post(renderer, scene, camera);
game.player = new Player(game);
game.boss = new Boss(game);
game.cam = new CameraRig(camera, game);
game.hud = new HUD(game);
game.player.controllable = false;
game.post.onFallback = (mode) => {
  const note = document.getElementById('render-note');
  note.textContent = mode >= 2 ? 'Включён режим совместимости: без пост-эффектов' : 'Включён режим совместимости: без сглаживания';
  note.classList.remove('hidden');
};
if (!quality) {
  document.getElementById('opt-quality').checked = false;
  game.arena.setQuality(false);
}

let pointScale = 400;
function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(w, h);
  game.post.setPixelRatio(pixelRatio());
  game.post.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pointScale = (h * pixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
window.addEventListener('resize', onResize);
onResize();

// ------------------------------------------------------------------ DOM
const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), pause: $('pause'), death: $('death'), victory: $('victory') };
function showScreen(name) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
}

document.querySelectorAll('.diff').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.diff').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    game.difficulty = b.dataset.diff;
    game.audio.init();
    game.audio.play('ui');
  });
});
$('start-btn').addEventListener('click', () => startFight());
$('retry-btn').addEventListener('click', () => startFight());
$('again-btn').addEventListener('click', () => startFight());
$('restart-btn').addEventListener('click', () => startFight());
$('resume-btn').addEventListener('click', () => resume());
// Volume settings, remembered between visits when storage is available.
function loadSettings() {
  try { return JSON.parse(localStorage.getItem('crimson-cathedral.settings')) || {}; } catch (_) { return {}; }
}
const settings = { music: 80, sfx: 100, ...loadSettings() };
$('opt-music').value = settings.music;
$('opt-sfx').value = settings.sfx;
function applyVolumes() {
  settings.music = +$('opt-music').value;
  settings.sfx = +$('opt-sfx').value;
  game.audio.setVolumes(settings.music / 100, settings.sfx / 100);
  try { localStorage.setItem('crimson-cathedral.settings', JSON.stringify(settings)); } catch (_) { /* ignore */ }
}
$('opt-music').addEventListener('input', applyVolumes);
$('opt-sfx').addEventListener('input', () => { applyVolumes(); game.audio.play('hit', { vol: 0.6, gap: 0.12 }); });
game.audio.setVolumes(settings.music / 100, settings.sfx / 100);

// Browsers only allow sound after an interaction: start the menu music on the first one.
const unlockAudio = () => {
  game.audio.init();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);
$('opt-quality').addEventListener('change', (e) => {
  quality = e.target.checked;
  game.arena.setQuality(quality);
  onResize();
});

canvas.addEventListener('mousedown', () => {
  if ((game.state === 'play' || game.state === 'intro') && !game.input.locked) game.input.requestLock();
});

game.input.onLockChange = (locked) => {
  if (locked) game.hadLock = true;
  else if (game.hadLock && (game.state === 'play' || game.state === 'intro')) pause();
};

function after(sec, fn) {
  game.timers.push({ t: sec, fn });
}

// ------------------------------------------------------------------ flow
function startFight() {
  const g = game;
  g.audio.init();
  g.audio.play('ui');
  g.audio.setMuffled(false);
  g.timers.length = 0;
  g.fx.clear();
  g.player.reset();
  g.boss.reset();
  g.arena.resetPhase();
  g.hud.reset();
  g.hud.show(true);
  g.hitStop = 0;
  g.timeScale = 1;
  g.stats.hitsTaken = 0;
  g.stats.time = 0;
  g.stats.attempts++;
  g.player.controllable = false;
  g.state = 'intro';
  g.cam.setMode('intro');
  g.cam.locked = true;
  g.audio.setIntensity(0);
  $('title-card').classList.add('hidden');
  game.titleShown = false;
  game.introT = 0;
  $('fade').style.opacity = 0;
  $('fade').classList.remove('white');
  showScreen(null);
  g.input.requestLock();
  g.boss.awaken();
}

game.showTitle = () => {
  game.titleShown = true;
  const tc = $('title-card');
  tc.classList.remove('hidden');
  tc.style.animation = 'none';
  void tc.offsetWidth;
  tc.style.animation = '';
  after(4.3, () => tc.classList.add('hidden'));
};

game.onIntroDone = () => {
  if (game.state !== 'intro') return;
  game.state = 'play';
  game.player.controllable = true;
  game.hud.showBoss();
  game.hud.bossHp(game.boss.hp / game.boss.maxHp);
  game.cam.setMode('play');
  game.cam.yaw = Math.atan2(game.player.pos.x - game.boss.pos.x, game.player.pos.z - game.boss.pos.z);
  game.audio.setIntensity(1);
};

function skipIntro() {
  const b = game.boss;
  b.setPose('idle', 4);
  b.co = b.brain();
  if (!game.titleShown) game.showTitle();
  game.onIntroDone();
}

game.onBossPhase2 = () => {
  game.arena.setPhase(1);
  game.hud.phase2();
  game.audio.setIntensity(2);
  game.post.whiteFlash(0.35);
};

game.onPlayerDeath = () => {
  game.state = 'dead';
  game.cam.setMode('death');
  game.timeScale = 0.35;
  game.audio.setIntensity(-1);
  after(1.2, () => { game.timeScale = 1; });
  after(1.6, () => { $('fade').style.opacity = 0.7; });
  after(2.6, () => {
    const pct = Math.round((1 - game.boss.hp / game.boss.maxHp) * 100);
    $('death-sub').textContent = `Страж ранен на ${pct}%. Нить ещё не оборвана.`;
    game.input.exitLock();
    showScreen('death');
    game.hud.show(false);
  });
};

game.onBossDeath = () => {
  game.state = 'victory';
  game.player.invuln = 999;
  game.timeScale = 0.18;
  game.hitStop = 0;
  game.post.whiteFlash(0.9);
  game.cam.shake(1.2);
  game.audio.play('bossDeath');
  game.audio.setIntensity(-1);
  game.hud.bossHp(0);
  game.fx.burst(game.boss.aimPoint(), { count: 120, color: [1, 0.3, 0.3], speed: 14, size: 0.5, life: 1.6, gravity: 2 });
  game.fx.sparkBurst(game.boss.aimPoint(), { count: 80, color: [1, 0.9, 0.8], speed: 24, life: 0.8 });
  game.fx.ring(game.boss.pos, { r0: 1, r1: 22, dur: 1.4, color: [1, 0.85, 0.8], width: 0.1 });
  after(1.8, () => { game.timeScale = 1; });
  after(3.2, () => { game.cam.setMode('victory'); game.player.controllable = false; });
  after(4.2, () => game.audio.play('victory'));
  after(6.0, () => {
    const t = Math.floor(game.stats.time);
    const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
    $('victory-stats').innerHTML =
      `Время боя: <b>${mm}:${ss}</b><br>Получено ударов: <b>${game.stats.hitsTaken}</b><br>Попытка: <b>${game.stats.attempts}</b>` +
      `<br>Сложность: <b>${game.difficulty === 'hard' ? 'Охотница' : 'Странница'}</b>`;
    game.input.exitLock();
    showScreen('victory');
    game.hud.show(false);
  });
};

function pause() {
  if (game.state !== 'play' && game.state !== 'intro') return;
  game.prevState = game.state;
  game.state = 'paused';
  game.pausedAt = performance.now();
  game.input.exitLock();
  game.audio.setMuffled(true);
  showScreen('pause');
}

function resume() {
  if (game.state !== 'paused') return;
  game.state = game.prevState || 'play';
  game.audio.setMuffled(false);
  showScreen(null);
  game.input.requestLock();
}

// ------------------------------------------------------------------ loop
const timer = new THREE.Timer();
timer.connect(document);

function tick() {
  requestAnimationFrame(tick);
  if (game.frozen) return; // used by automated screenshot tests
  timer.update();
  const rawDt = Math.min(timer.getDelta(), 1 / 20);
  const g = game;
  g.input.poll();

  if (g.input.hit('pause')) {
    if (g.state === 'play' || g.state === 'intro') pause();
    else if (g.state === 'paused' && performance.now() - g.pausedAt > 400) resume();
  }
  if (g.state === 'intro') g.introT += rawDt;
  if (g.state === 'intro' && g.introT > 0.8 && (g.input.hit('jump') || g.input.hit('attack')) && g.boss.co) skipIntro();
  if (g.state === 'play' && g.input.hit('lock')) g.cam.toggleLock();

  // Timers run on real time.
  for (let i = g.timers.length - 1; i >= 0; i--) {
    const tm = g.timers[i];
    tm.t -= rawDt;
    if (tm.t <= 0) { g.timers.splice(i, 1); tm.fn(); }
  }

  let dt = rawDt;
  if (g.state === 'paused') dt = 0;
  if (g.hitStop > 0) {
    g.hitStop -= rawDt;
    dt *= 0.03;
  }
  dt *= g.timeScale;

  if (dt > 0) {
    g.time += dt;
    g.player.update(dt);
    g.boss.update(dt);
    if (g.state === 'play') g.stats.time += dt;
    g.fx.update(dt, pointScale);
    g.ambient.update(dt, g.time, pointScale, g.boss.phase === 2 && g.boss.alive ? 1 : 0, g.boss.pos, camera.position);
    g.arena.update(dt, g.time);
  }
  if (g.state !== 'paused') g.cam.update(dt, rawDt);
  g.hud.update(rawDt);

  const low = g.state === 'play' && g.player.hp <= 1 ? 1 : 0;
  g.post.render(rawDt, performance.now() / 1000, low);
  g.input.endFrame();
}

// Warm-up: compile shaders & render the first frame before revealing.
game.boss.update(0.016);
game.cam.update(0.016, 0.016);
renderer.compile(scene, camera);
requestAnimationFrame(() => {
  tick();
  const ld = $('loading');
  ld.style.opacity = 0;
  setTimeout(() => ld.remove(), 900);
});
