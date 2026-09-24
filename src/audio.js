// Sound effects are synthesized; music comes from two looped tracks (with the
// old procedural score as a fallback). A convolution reverb gives the effects
// a cathedral-like tail.
import drownedSrc from './music/drowned_cathedral.mp3?inline';
import ashSrc from './music/ash_hunter.mp3?inline';

// loopAt: where the next pass starts, just before each file's fade-out tail.
const TRACKS = {
  drowned: { src: drownedSrc, loopAt: 83.3 },
  ash: { src: ashSrc, loopAt: 73.3 },
};

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

// D minor progression: Dm – Bb – Gm – A
const CHORDS = [
  [50, 53, 57],
  [46, 50, 53],
  [43, 46, 50],
  [45, 49, 52],
];

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.musicOn = true;
    this.intensity = 0; // 0 menu, 1 fight, 2 phase two, -1 silent
    this.step = 0;
    this.nextTime = 0;
    this.bpm = 92;
    this._lastPlay = {};
    this.musicVol = 0.8;
    this.sfxVol = 1;
    this.tracksReady = false;
    this.cur = null;
    this.muffled = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.8, 2.6);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    this.reverb.connect(revOut).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.28;
    this.sfx.connect(this.sfxSend).connect(this.reverb);

    this.music = ctx.createGain();
    this.music.connect(this.master);
    const mSend = ctx.createGain();
    mSend.gain.value = 0.5;
    this.music.connect(mSend).connect(this.reverb);

    // Recorded tracks: already mixed, so they skip the reverb.
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 700;
    this.musicFilter.Q.value = 0.6;
    this.trackOut = ctx.createGain();
    this.musicFilter.connect(this.trackOut).connect(this.master);
    this._applyVolumes();
    this._loadTracks();

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.nextTime = ctx.currentTime + 0.1;
    this._timer = setInterval(() => this._schedule(), 25);
  }

  setVolumes(music, sfx) {
    this.musicVol = music;
    this.sfxVol = sfx;
    this._applyVolumes();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(this.musicVol * 0.55, t, 0.05);
    this.trackOut.gain.setTargetAtTime(this.musicVol * 0.6, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.sfxVol * 0.9, t, 0.05);
  }

  setIntensity(v) {
    if (v !== this.intensity) {
      this.intensity = v;
      this.bpm = v >= 2 ? 108 : 92;
      this._applyIntensity();
    }
  }

  /** Muffle the music (pause menu). */
  setMuffled(m) {
    this.muffled = m;
    this._applyFilter();
  }

  // ------------------------------------------------------------------ tracks
  async _loadTracks() {
    try {
      for (const t of Object.values(TRACKS)) {
        const bin = atob(t.src.slice(t.src.indexOf(',') + 1));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        t.buffer = await this.ctx.decodeAudioData(bytes.buffer);
      }
      this.tracksReady = true;
      this._applyIntensity();
    } catch (e) {
      console.warn('[audio] music tracks unavailable, using the synthesized score', e);
    }
  }

  _applyIntensity() {
    if (!this.ctx || !this.tracksReady) return;
    const I = this.intensity;
    const want = I >= 2 ? 'ash' : I >= 0 ? 'drowned' : null;
    if (want !== (this.cur && this.cur.name)) {
      if (this.cur) this._stopTrack(this.cur, I < 0 ? 2.5 : 1.6);
      this.cur = want ? this._startTrack(want, I >= 2 ? 1.2 : 2.5) : null;
    }
    this._applyFilter();
  }

  _applyFilter() {
    if (!this.musicFilter) return;
    const I = this.intensity;
    // Menu and pause sound "through the wall"; the fight opens it up.
    const f = I < 0 ? 350 : this.muffled ? 900 : I === 0 ? 700 : 20000;
    this.musicFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, I > 0 && !this.muffled ? 0.5 : 0.25);
  }

  _startTrack(name, fadeIn) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeIn);
    gain.connect(this.musicFilter);
    const cur = { name, gain, sources: [], nextAt: 0 };
    this._queuePass(cur, now + 0.05, 0.02);
    return cur;
  }

  _queuePass(cur, when, fade) {
    const ctx = this.ctx;
    const T = TRACKS[cur.name];
    const src = ctx.createBufferSource();
    src.buffer = T.buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(1, when + fade);
    src.connect(g).connect(cur.gain);
    src.start(when);
    cur.sources.push(src);
    src.onended = () => {
      const i = cur.sources.indexOf(src);
      if (i >= 0) cur.sources.splice(i, 1);
    };
    // The previous pass keeps playing through its own fade-out tail.
    cur.nextAt = when + T.loopAt;
  }

  _stopTrack(cur, fadeOut) {
    const now = this.ctx.currentTime;
    cur.gain.gain.cancelScheduledValues(now);
    cur.gain.gain.setValueAtTime(Math.max(cur.gain.gain.value, 0.0001), now);
    cur.gain.gain.linearRampToValueAtTime(0.0001, now + fadeOut);
    cur.stopped = true;
    for (const s of cur.sources) s.stop(now + fadeOut + 0.05);
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
      }
    }
    return buf;
  }

  // ------------------------------------------------------------------ helpers
  _env(g, t, attack, peak, decay, sustainEnd = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(sustainEnd, t + attack + decay);
  }

  _noise({ t, dur = 0.2, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, gain = 0.3, attack = 0.005, out = this.sfx, rate = 1 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, gain, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + attack + 0.05);
  }

  _tone({ t, type = 'sine', f0 = 440, f1 = f0, dur = 0.2, gain = 0.2, attack = 0.005, out = this.sfx, detune = 0, filter = 0 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 10), t + dur);
    const g = ctx.createGain();
    this._env(g, t, attack, gain, dur);
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f).connect(g).connect(out);
    } else o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + attack + 0.05);
  }

  /** Play a named effect. Rate-limited per name to avoid stacking. */
  play(name, opts = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const minGap = opts.gap ?? 0.03;
    if (this._lastPlay[name] && now - this._lastPlay[name] < minGap) return;
    this._lastPlay[name] = now;
    const t = now + 0.005;
    const v = opts.vol ?? 1;
    const p = opts.pitch ?? 1;
    switch (name) {
      case 'slash':
        this._noise({ t, dur: 0.16, type: 'bandpass', f0: 5200 * p, f1: 1400 * p, q: 1.4, gain: 0.32 * v, attack: 0.012 });
        this._noise({ t, dur: 0.08, type: 'highpass', f0: 7000, f1: 5000, q: 0.7, gain: 0.08 * v });
        break;
      case 'hit':
        this._noise({ t, dur: 0.12, type: 'lowpass', f0: 3000 * p, f1: 400, q: 0.8, gain: 0.5 * v });
        this._tone({ t, type: 'sine', f0: 170 * p, f1: 55, dur: 0.18, gain: 0.55 * v });
        this._tone({ t, type: 'triangle', f0: 1650 * p, f1: 1500 * p, dur: 0.25, gain: 0.06 * v });
        break;
      case 'heavyHit':
        this._noise({ t, dur: 0.2, type: 'lowpass', f0: 2600, f1: 200, q: 0.8, gain: 0.6 * v });
        this._tone({ t, type: 'sine', f0: 120, f1: 38, dur: 0.35, gain: 0.7 * v });
        this._tone({ t, type: 'square', f0: 900, f1: 820, dur: 0.3, gain: 0.03 * v, filter: 2500 });
        break;
      case 'pogo':
        this._tone({ t, type: 'triangle', f0: 520, f1: 1040, dur: 0.12, gain: 0.12 * v });
        break;
      case 'jump':
        this._noise({ t, dur: 0.09, type: 'bandpass', f0: 900, f1: 2400, q: 1.2, gain: 0.12 * v });
        break;
      case 'doubleJump':
        this._noise({ t, dur: 0.18, type: 'bandpass', f0: 1200, f1: 4200, q: 2.5, gain: 0.16 * v });
        this._tone({ t, type: 'sine', f0: 880, f1: 1320, dur: 0.14, gain: 0.05 * v });
        break;
      case 'dash':
        this._noise({ t, dur: 0.22, type: 'bandpass', f0: 600, f1: 3800, q: 0.9, gain: 0.3 * v, attack: 0.02 });
        break;
      case 'land':
        this._noise({ t, dur: 0.08, type: 'lowpass', f0: 900, f1: 200, q: 0.7, gain: 0.18 * v });
        break;
      case 'step':
        this._noise({ t, dur: 0.12, type: 'lowpass', f0: 500 * p, f1: 80, q: 0.8, gain: 0.35 * v });
        this._tone({ t, type: 'sine', f0: 80 * p, f1: 40, dur: 0.15, gain: 0.3 * v });
        break;
      case 'hurt':
        this._noise({ t, dur: 0.3, type: 'lowpass', f0: 5000, f1: 300, q: 1, gain: 0.6 * v });
        this._tone({ t, type: 'sawtooth', f0: 320, f1: 70, dur: 0.35, gain: 0.25 * v, filter: 1600 });
        this._tone({ t: t + 0.02, type: 'sine', f0: 2400, f1: 1800, dur: 0.4, gain: 0.07 * v });
        break;
      case 'bindStart':
        for (let i = 0; i < 5; i++) {
          this._tone({ t: t + i * 0.07, type: 'triangle', f0: NOTE(74 + [0, 3, 7, 10, 12][i]), dur: 0.5, gain: 0.07 * v });
        }
        this._noise({ t, dur: 0.5, type: 'bandpass', f0: 2000, f1: 6000, q: 3, gain: 0.1 * v, attack: 0.1 });
        break;
      case 'bind':
        [62, 69, 74, 77, 81].forEach((n, i) => this._tone({ t: t + i * 0.015, type: 'sine', f0: NOTE(n), dur: 1.4, gain: 0.08 * v, attack: 0.01 }));
        this._tone({ t, type: 'sine', f0: 200, f1: 400, dur: 0.3, gain: 0.15 * v });
        break;
      case 'storm':
        for (let i = 0; i < 6; i++) this._noise({ t: t + i * 0.1, dur: 0.12, type: 'bandpass', f0: 4200, f1: 1800, q: 2, gain: 0.2 * v });
        this._tone({ t, type: 'sawtooth', f0: 220, f1: 660, dur: 0.6, gain: 0.05 * v, filter: 2500 });
        break;
      case 'throw':
        this._noise({ t, dur: 0.1, type: 'bandpass', f0: 3500, f1: 7000, q: 3, gain: 0.18 * v });
        this._tone({ t, type: 'triangle', f0: 1800, f1: 2600, dur: 0.08, gain: 0.04 * v });
        break;
      case 'glint':
        this._tone({ t, type: 'sine', f0: 2640, f1: 2640, dur: 0.7, gain: 0.08 * v });
        this._tone({ t, type: 'sine', f0: 3960, f1: 3900, dur: 0.5, gain: 0.04 * v });
        this._noise({ t, dur: 0.25, type: 'highpass', f0: 6000, f1: 9000, q: 1, gain: 0.07 * v });
        break;
      case 'bossSwing':
        this._noise({ t, dur: 0.35, type: 'bandpass', f0: 380 * p, f1: 1500 * p, q: 1.1, gain: 0.45 * v, attack: 0.05 });
        this._noise({ t: t + 0.05, dur: 0.25, type: 'bandpass', f0: 2400, f1: 900, q: 1.5, gain: 0.15 * v });
        break;
      case 'lunge':
        this._noise({ t, dur: 0.45, type: 'bandpass', f0: 300, f1: 2400, q: 0.8, gain: 0.5 * v, attack: 0.03 });
        this._tone({ t, type: 'sawtooth', f0: 90, f1: 60, dur: 0.4, gain: 0.12 * v, filter: 500 });
        break;
      case 'slam':
        this._noise({ t, dur: 0.9, type: 'lowpass', f0: 1800, f1: 60, q: 0.7, gain: 0.9 * v });
        this._tone({ t, type: 'sine', f0: 90, f1: 28, dur: 0.9, gain: 0.9 * v });
        this._tone({ t, type: 'triangle', f0: 220, f1: 60, dur: 0.4, gain: 0.3 * v });
        break;
      case 'spikeWarn':
        this._tone({ t, type: 'sine', f0: 700, f1: 1100, dur: 0.18, gain: 0.05 * v });
        break;
      case 'spike':
        this._noise({ t, dur: 0.25, type: 'bandpass', f0: 2600, f1: 600, q: 1.2, gain: 0.35 * v });
        this._tone({ t, type: 'square', f0: 140, f1: 70, dur: 0.15, gain: 0.08 * v, filter: 900 });
        break;
      case 'crescent':
        this._tone({ t, type: 'sawtooth', f0: 300, f1: 900, dur: 0.4, gain: 0.06 * v, filter: 1800 });
        this._noise({ t, dur: 0.4, type: 'bandpass', f0: 1200, f1: 3200, q: 4, gain: 0.2 * v });
        break;
      case 'roar': {
        for (let i = 0; i < 4; i++) {
          this._tone({ t, type: 'sawtooth', f0: 110 + i * 3.3, f1: 55 + i * 2, dur: 2.2, gain: 0.12 * v, attack: 0.15, filter: 900, detune: i * 9 });
        }
        this._noise({ t, dur: 2.0, type: 'bandpass', f0: 600, f1: 250, q: 0.8, gain: 0.5 * v, attack: 0.2 });
        this._tone({ t, type: 'sine', f0: 50, f1: 30, dur: 2.2, gain: 0.5 * v, attack: 0.1 });
        break;
      }
      case 'stagger':
        this._tone({ t, type: 'sine', f0: 400, f1: 60, dur: 0.6, gain: 0.35 * v });
        this._noise({ t, dur: 0.5, type: 'lowpass', f0: 3000, f1: 200, q: 1, gain: 0.4 * v });
        this._tone({ t, type: 'triangle', f0: 1760, f1: 1700, dur: 1.1, gain: 0.06 * v });
        break;
      case 'bossDeath':
        this._tone({ t, type: 'sine', f0: 200, f1: 30, dur: 3, gain: 0.6 * v });
        this._noise({ t, dur: 3, type: 'lowpass', f0: 4000, f1: 80, q: 0.6, gain: 0.6 * v });
        [62, 65, 69, 74].forEach((n, i) => this._tone({ t: t + 0.8 + i * 0.12, type: 'triangle', f0: NOTE(n), dur: 3.5, gain: 0.07 * v, attack: 0.05 }));
        break;
      case 'victory':
        [50, 57, 62, 66, 69, 74].forEach((n, i) => this._tone({ t: t + i * 0.18, type: 'triangle', f0: NOTE(n), dur: 4, gain: 0.08 * v, attack: 0.04 }));
        break;
      case 'ui':
        this._tone({ t, type: 'triangle', f0: 880, f1: 1320, dur: 0.12, gain: 0.08 * v });
        break;
      case 'deathPlayer':
        this._tone({ t, type: 'sine', f0: 600, f1: 40, dur: 1.6, gain: 0.3 * v });
        this._noise({ t, dur: 1.2, type: 'lowpass', f0: 3000, f1: 100, q: 1, gain: 0.4 * v });
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ music
  _schedule() {
    const ctx = this.ctx;
    // Keep the recorded track looping.
    if (ctx && this.cur && !this.cur.stopped && ctx.currentTime > this.cur.nextAt - 0.5) {
      this._queuePass(this.cur, this.cur.nextAt, 0.3);
    }
    if (!ctx || this.intensity < 0 || this.tracksReady) {
      if (ctx) this.nextTime = ctx.currentTime + 0.1;
      return;
    }
    while (this.nextTime < ctx.currentTime + 0.12) {
      this._playStep(this.step, this.nextTime);
      this.nextTime += 60 / this.bpm / 4;
      this.step++;
    }
  }

  _playStep(step, t) {
    const I = this.intensity;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chord = CHORDS[bar % 4];
    const out = this.music;
    const barLen = (60 / this.bpm) * 4;

    // Pad on every bar.
    if (s16 === 0) {
      chord.forEach((n, i) => {
        for (const det of [-7, 7]) {
          this._tone({ t, type: 'sawtooth', f0: NOTE(n), dur: barLen * 1.05, gain: 0.018, attack: barLen * 0.35, out, detune: det + i * 2, filter: I >= 2 ? 1400 : 800 });
        }
      });
      this._tone({ t, type: 'sine', f0: NOTE(chord[0] - 12), dur: barLen, gain: 0.07, attack: 0.3, out });
    }
    if (I < 1) {
      // Menu: sparse bell.
      if (s16 === 8 && bar % 2 === 1) this._tone({ t, type: 'triangle', f0: NOTE(chord[2] + 12), dur: 2.2, gain: 0.03, out });
      return;
    }

    // Plucked ostinato (strings/harp).
    const arp = [0, 1, 2, 1, 0, 2, 1, 2];
    const notes = [chord[0] + 12, chord[1] + 12, chord[2] + 12];
    if (I >= 2 || s16 % 2 === 0) {
      const idx = I >= 2 ? arp[s16 % 8] : arp[(s16 / 2) % 8];
      const oct = (I >= 2 && s16 >= 8) ? 12 : 0;
      this._tone({ t, type: 'triangle', f0: NOTE(notes[idx] + oct), dur: 0.28, gain: 0.035, out, attack: 0.003 });
      this._tone({ t, type: 'sawtooth', f0: NOTE(notes[idx] + oct), dur: 0.16, gain: 0.01, out, attack: 0.003, filter: 2200 });
    }

    // Bass pulse.
    const bassHits = I >= 2 ? [0, 3, 6, 8, 11, 14] : [0, 6, 8];
    if (bassHits.includes(s16)) {
      this._tone({ t, type: 'sawtooth', f0: NOTE(chord[0] - 24), dur: 0.35, gain: 0.07, out, filter: 380 });
    }

    // Drums.
    const kicks = I >= 2 ? [0, 4, 8, 10, 12] : [0, 8];
    if (kicks.includes(s16)) {
      this._tone({ t, type: 'sine', f0: 140, f1: 42, dur: 0.3, gain: 0.3, out });
    }
    if (I >= 2 && (s16 === 4 || s16 === 12)) {
      this._noise({ t, dur: 0.18, type: 'bandpass', f0: 1800, f1: 900, q: 0.8, gain: 0.12, out });
      this._tone({ t, type: 'triangle', f0: 220, f1: 120, dur: 0.15, gain: 0.12, out });
    }
    if (I >= 2 && s16 % 2 === 1) {
      this._noise({ t, dur: 0.04, type: 'highpass', f0: 8000, f1: 7000, q: 0.7, gain: 0.025, out });
    }
    if (I >= 2 && s16 >= 12 && bar % 4 === 3) {
      this._tone({ t, type: 'sine', f0: 180 - (s16 - 12) * 20, f1: 60, dur: 0.2, gain: 0.2, out });
    }

    // Choir in phase two.
    if (I >= 2 && s16 === 0) {
      chord.forEach((n) => this._choir(NOTE(n + 12), t, barLen, out));
    }
  }

  _choir(freq, t, dur, out) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lfoG = ctx.createGain();
    lfoG.gain.value = freq * 0.006;
    lfo.connect(lfoG).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.02, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.05);
    for (const [f, q] of [[700, 6], [1150, 8]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      o.connect(bp).connect(g);
    }
    g.connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur * 1.1);
    lfo.stop(t + dur * 1.1);
  }
}
