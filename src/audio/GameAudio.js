// Весь звук синтезируется на лету: файлов нет, а значит нет и лицензий.
const clampPan = (v) => Math.max(-1, Math.min(1, v));

function noiseBuffer(ctx, seconds, brown) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

// Импульс маленькой комнаты для реверберации.
function roomImpulse(ctx, seconds, decay) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
  }
  return buf;
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.level = 0.85;
    this.sfxLevel = 1;
    this.dread = 0;
    this.pendingDread = 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) this.attach(new AC());
  }

  attach(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.level;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 6;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.18;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxLevel;
    this.sfx.connect(this.master);

    this.dry = ctx.createGain();
    this.dry.connect(this.sfx);
    const reverb = ctx.createConvolver();
    reverb.buffer = roomImpulse(ctx, 1.5, 3);
    this.send = ctx.createGain();
    this.send.connect(reverb);
    reverb.connect(this.sfx);

    this.white = noiseBuffer(ctx, 2, false);
    this.brown = noiseBuffer(ctx, 5, true);
    this.startAmbient();
    this.setDread(this.pendingDread);
  }

  setMaster(v) {
    this.level = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setVolume(all, sfx) {
    this.setMaster(0.85 * all);
    this.sfxLevel = sfx;
    if (this.sfx) this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  now(at = 0) {
    return this.ctx.currentTime + at;
  }

  // Выход одного голоса: панорама и доля реверберации.
  out(pan = 0, wet = 0.25) {
    const { ctx } = this;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = clampPan(pan);
    g.connect(p);
    p.connect(this.dry);
    const s = ctx.createGain();
    s.gain.value = wet;
    p.connect(s);
    s.connect(this.send);
    return g;
  }

  noise({ brown = false, type = 'bandpass', freq = 1000, to, q = 1, dur = 0.1, gain = 0.2, attack = 0.002, pan = 0, wet = 0.25, at = 0 }) {
    const { ctx } = this;
    const t = this.now(at);
    const src = ctx.createBufferSource();
    src.buffer = brown ? this.brown : this.white;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = this.out(pan, wet);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  tone({ type = 'sine', freq = 220, to, dur = 0.1, gain = 0.2, attack = 0.003, pan = 0, wet = 0.2, at = 0 }) {
    const { ctx } = this;
    const t = this.now(at);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = this.out(pan, wet);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  startAmbient() {
    const { ctx } = this;
    // Комнатный гул: тёмный шум, который медленно дышит.
    const room = ctx.createBufferSource();
    room.buffer = this.brown;
    room.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 210;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.07;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 60;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(lp.frequency);
    this.roomGain = ctx.createGain();
    this.roomGain.gain.value = 0.055;
    room.connect(lp);
    lp.connect(this.roomGain);
    this.roomGain.connect(this.sfx);
    room.start();
    wobble.start();

    // Низкий гул страха: два близких тона дают медленные биения.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.012;
    for (const f of [41, 41.6, 55.2]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(this.droneGain);
      o.start();
    }
    this.droneGain.connect(this.sfx);

    // Диссонанс появляется только ближе к концу.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    for (const f of [311.1, 329.6, 466.2]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.connect(this.padGain);
      o.start();
    }
    this.padGain.connect(this.send);

    // Гудение проводки, пока в доме есть электричество.
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const hum = ctx.createOscillator();
    hum.type = 'triangle';
    hum.frequency.value = 100;
    hum.connect(this.humGain);
    hum.start();
    this.humGain.connect(this.sfx);

    // Жужжание мух.
    this.flyGain = ctx.createGain();
    this.flyGain.gain.value = 0;
    const fly = ctx.createOscillator();
    fly.type = 'sawtooth';
    fly.frequency.value = 188;
    const flyWob = ctx.createOscillator();
    flyWob.frequency.value = 7.3;
    const flyDepth = ctx.createGain();
    flyDepth.gain.value = 24;
    flyWob.connect(flyDepth);
    flyDepth.connect(fly.frequency);
    const flyFilter = ctx.createBiquadFilter();
    flyFilter.type = 'bandpass';
    flyFilter.frequency.value = 620;
    flyFilter.Q.value = 2;
    fly.connect(flyFilter);
    flyFilter.connect(this.flyGain);
    this.flyGain.connect(this.dry);
    fly.start();
    flyWob.start();
  }

  setDread(v) {
    this.pendingDread = v;
    this.dread = v;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(0.012 + v * 0.06, t, 0.8);
    this.padGain.gain.setTargetAtTime(v * v * 0.0035, t, 1.5);
    this.roomGain.gain.setTargetAtTime(0.055 - v * 0.03, t, 1.5);
  }

  setHum(v) {
    if (this.ctx) this.humGain.gain.setTargetAtTime(v * 0.009, this.ctx.currentTime, 0.04);
  }

  setFlies(v) {
    if (this.ctx) this.flyGain.gain.setTargetAtTime(v * 0.02, this.ctx.currentTime, 0.2);
  }

  radioStatic(on) {
    if (!this.ctx) return;
    if (on) this.noise({ freq: 2200, q: 0.6, dur: 0.5, gain: 0.03, attack: 0.05, wet: 0.05 });
  }

  play(name, opts = {}) {
    if (!this.ctx || !this.sounds[name]) return;
    const { pan = 0, volume = 1, at = 0 } = opts;
    this.sounds[name].call(this, pan, volume, at);
  }

  sounds = {
    step(pan, v, at) {
      this.tone({ freq: 66, to: 42, dur: 0.15, gain: 0.34 * v, pan, wet: 0.3, at });
      this.noise({ brown: true, type: 'lowpass', freq: 240, to: 90, dur: 0.11, gain: 0.5 * v, pan, wet: 0.3, at });
      if (Math.random() < 0.18) this.noise({ freq: 820, to: 560, q: 9, dur: 0.09, gain: 0.05 * v, pan, wet: 0.5, at: at + 0.03 });
    },
    scuttle(pan, v, at) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this.noise({ type: 'highpass', freq: 2800 + Math.random() * 3200, dur: 0.009, gain: 0.05 * v, pan: pan + (Math.random() - 0.5) * 0.2, wet: 0.12, at: at + i * 0.024 });
      }
    },
    bite(pan, v, at) {
      this.noise({ freq: 1500, to: 460, q: 1.4, dur: 0.1, gain: 0.26 * v, pan, wet: 0.15, at });
      this.tone({ freq: 130, to: 68, dur: 0.1, gain: 0.26 * v, pan, at });
    },
    gasp(pan, v, at) {
      this.noise({ freq: 760, to: 1900, q: 1.6, dur: 0.34, gain: 0.2 * v, attack: 0.08, pan, wet: 0.4, at });
    },
    whoosh(pan, v, at) {
      this.noise({ freq: 240, to: 1700, q: 0.8, dur: 0.82, gain: 0.26 * v, attack: 0.72, pan, wet: 0.2, at });
    },
    slipper(pan, v, at) {
      this.tone({ freq: 96, to: 30, dur: 0.38, gain: 0.95 * v, pan, wet: 0.35, at });
      this.noise({ type: 'lowpass', freq: 1300, to: 170, dur: 0.2, gain: 0.72 * v, pan, wet: 0.45, at });
    },
    lightOn(pan, v, at) {
      this.noise({ type: 'highpass', freq: 2100, dur: 0.012, gain: 0.3 * v, wet: 0.4, at });
    },
    lightOff(pan, v, at) {
      this.noise({ type: 'highpass', freq: 1500, dur: 0.016, gain: 0.26 * v, wet: 0.4, at });
    },
    wireSnap(pan, v, at) {
      this.noise({ freq: 2600, q: 0.7, dur: 0.06, gain: 0.5 * v, wet: 0.5, at });
      this.tone({ type: 'sawtooth', freq: 2900, to: 84, dur: 0.3, gain: 0.08 * v, wet: 0.3, at });
      for (let i = 1; i < 6; i++) this.noise({ type: 'highpass', freq: 3800, dur: 0.012, gain: 0.12 * v, wet: 0.5, at: at + 0.05 * i + Math.random() * 0.05 });
    },
    cocoon(pan, v, at) {
      for (let i = 0; i < 4; i++) this.noise({ freq: 620, to: 2300, q: 2, dur: 0.34, gain: 0.1 * v, attack: 0.06, pan, wet: 0.3, at: at + i * 0.27 });
    },
    hatch(pan, v, at) {
      this.tone({ freq: 240 + Math.random() * 200, to: 950, dur: 0.035, gain: 0.08 * v, pan, wet: 0.2, at });
    },
    heartbeat(pan, v, at) {
      this.tone({ freq: 60, to: 38, dur: 0.15, gain: 0.5 * v, wet: 0.08, at });
      this.tone({ freq: 54, to: 36, dur: 0.17, gain: 0.34 * v, wet: 0.08, at: at + 0.25 });
    },
    bark(pan, v, at) {
      for (let i = 0; i < 2; i++) {
        this.tone({ type: 'sawtooth', freq: 420, to: 190, dur: 0.1, gain: 0.16 * v, pan, wet: 0.35, at: at + i * 0.17 });
        this.noise({ freq: 900, to: 420, q: 1.2, dur: 0.08, gain: 0.14 * v, pan, wet: 0.35, at: at + i * 0.17 });
      }
    },
    uiClick(pan, v, at) {
      this.tone({ type: 'square', freq: 880, to: 640, dur: 0.025, gain: 0.03 * v, wet: 0.05, at });
    },
    radioBlip(pan, v, at) {
      this.noise({ freq: 1800, q: 0.6, dur: 0.2, gain: 0.08 * v, wet: 0.05, at });
      this.tone({ type: 'square', freq: 1180, dur: 0.05, gain: 0.018 * v, wet: 0.05, at });
    },
    breathIn(pan, v, at) {
      this.noise({ freq: 460, to: 820, q: 0.9, dur: 1.5, gain: 0.05 * v, attack: 0.8, pan, wet: 0.25, at });
    },
    breathOut(pan, v, at) {
      this.noise({ freq: 620, to: 230, q: 0.9, dur: 2.1, gain: 0.05 * v, attack: 0.5, pan, wet: 0.25, at });
    },
    tick(pan, v, at) {
      this.noise({ freq: 2500, q: 3, dur: 0.012, gain: 0.05 * v, pan, wet: 0.35, at });
    },
    cricket(pan, v, at) {
      for (let i = 0; i < 3; i++) this.tone({ freq: 4300, dur: 0.035, gain: 0.0055 * v, pan, wet: 0.5, at: at + i * 0.06 });
    },
    cry(pan, v, at) {
      for (const f of [860, 1320]) this.noise({ freq: f, to: f * 1.35, q: 7, dur: 0.75, gain: 0.05 * v, attack: 0.1, pan, wet: 0.8, at });
      this.tone({ type: 'sawtooth', freq: 360, to: 520, dur: 0.7, gain: 0.012 * v, attack: 0.1, pan, wet: 0.8, at });
    },
    windowOpen(pan, v, at) {
      this.noise({ freq: 540, to: 760, q: 12, dur: 0.6, gain: 0.08 * v, attack: 0.2, pan, wet: 0.5, at });
    },
    alarm(pan, v, at) {
      for (let i = 0; i < 3; i++) this.tone({ type: 'triangle', freq: 620, to: 840, dur: 0.5, gain: 0.03 * v, attack: 0.1, pan, wet: 0.7, at: at + i * 0.56 });
    },
    explosion(pan, v, at) {
      this.tone({ freq: 62, to: 22, dur: 1.5, gain: 0.8 * v, attack: 0.02, pan, wet: 0.5, at });
      this.noise({ brown: true, type: 'lowpass', freq: 900, to: 90, dur: 1.7, gain: 0.9 * v, attack: 0.02, pan, wet: 0.5, at });
    },
  };
}
