// Музыка пишется кодом прямо во время игры. Одна тема проходит через всю партию:
// колыбельная шкатулки в спальне становится маршем, которым рой идёт по планете.
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const STORE = 'ruka-cela.music';

// Аккорд: бас, затем голоса.
const CH = {
  Dm: [38, 50, 57, 62, 65],
  Gm: [43, 50, 55, 58, 62],
  Bb: [46, 53, 58, 62, 65],
  A: [45, 52, 57, 61, 64],
  F: [41, 53, 57, 60, 65],
  C: [48, 52, 55, 60, 64],
  Eb: [39, 51, 58, 63, 67],
};

// Тема в ре миноре: [доля, полутоны от ре, длина]. Размер 3/4, считаем восьмыми.
const LULLABY = [
  [[0, 7, 2], [2, 8, 1], [3, 7, 1], [4, 3, 2]],
  [[0, 2, 2], [2, 3, 1], [3, 2, 1], [4, 0, 2]],
  [[0, 0, 2], [2, 3, 1], [3, 7, 1], [4, 12, 2]],
  [[0, 11, 3], [3, 7, 3]],
  [[0, 8, 2], [2, 7, 1], [3, 5, 1], [4, 3, 2]],
  [[0, 5, 2], [2, 3, 1], [3, 2, 1], [4, -1, 2]],
  [[0, 0, 2], [2, 2, 1], [3, 3, 1], [4, 7, 2]],
  [[0, 0, 6]],
];
const LULLABY_CHORDS = ['Dm', 'Gm', 'Dm', 'A', 'Bb', 'A', 'Dm', 'Dm'];

// Та же тема маршем: размер 4/4, считаем шестнадцатыми.
const MARCH = [
  [[0, 7, 6], [6, 8, 2], [8, 7, 4], [12, 3, 4]],
  [[0, 2, 6], [6, 3, 2], [8, 2, 4], [12, 0, 4]],
  [[0, 0, 6], [6, 3, 2], [8, 7, 4], [12, 12, 4]],
  [[0, 11, 8], [8, 7, 8]],
  [[0, 8, 6], [6, 7, 2], [8, 5, 4], [12, 3, 4]],
  [[0, 5, 6], [6, 3, 2], [8, 2, 4], [12, -1, 4]],
  [[0, 0, 6], [6, 2, 2], [8, 3, 4], [12, 7, 4]],
  [[0, 0, 16]],
];
const MARCH_B = ['Bb', 'F', 'Gm', 'Dm', 'Eb', 'Bb', 'Gm', 'A'];

const noteAt = (bars, bar, step) => bars[bar % bars.length].find((n) => n[0] === step);

const SONGS = {
  title: {
    bpm: 54,
    sub: 2,
    steps: 6,
    play(m, t, p) {
      const c = CH[LULLABY_CHORDS[p.bar % 8]];
      if (p.step === 0) m.pad(t, c.slice(1), m.dt * 6.5, 0.05);
      const n = noteAt(LULLABY, p.bar, p.step);
      if (n) m.box(t, 74 + n[1], 0.2);
    },
  },

  // Дом: сломанная шкатулка. Тревога поднимает смычки и сердцебиение.
  house: {
    bpm: 56,
    sub: 2,
    steps: 6,
    play(m, t, p, k) {
      const c = CH[LULLABY_CHORDS[p.bar % 8]];
      if (p.step === 0) {
        m.pad(t, c.slice(1), m.dt * 6.5, 0.035 + k * 0.05);
        m.bass(t, c[0] + 12, m.dt * 5, 0.09);
      }
      const n = noteAt(LULLABY, p.bar, p.step);
      if (n && p.cycle % 3 !== 2 && Math.random() > 0.06) m.box(t, 74 + n[1], 0.16);
      if (k > 0.4) m.strings(t, c[1 + (p.step % 2)], m.dt * 0.8, 0.018 + k * 0.03);
      if (k > 0.65 && (p.step === 0 || p.step === 1)) m.drum(t, 0.22 * k);
    },
  },

  // Улица: щипки крадутся вдоль заборов, тема спрятана в низком регистре.
  street: {
    bpm: 72,
    sub: 2,
    steps: 6,
    play(m, t, p, k) {
      const c = CH[LULLABY_CHORDS[p.bar % 8]];
      if (p.step === 0) m.pizz(t, c[0] + 12, 0.24);
      if (p.step === 3) m.pizz(t, c[2], 0.16);
      if (p.step === 2 || p.step === 5) m.pizz(t, c[3 + (p.bar % 2)], 0.11);
      if (p.step === 0 && p.bar % 2 === 0) m.pad(t, c.slice(1), m.dt * 12, 0.03 + k * 0.03);
      const n = noteAt(LULLABY, p.bar, p.step);
      if (n && p.cycle % 2 === 1) m.box(t, 62 + n[1], 0.12);
      if (k > 0.3) m.tick(t, p.step % 3 === 0 ? 0.05 : 0.025);
      if (k > 0.55) m.strings(t, c[1], m.dt * 0.8, 0.03 * k);
      if (k > 0.75 && p.step % 3 === 0) m.drum(t, 0.2);
    },
  },

  // Село: гудок, рамочный барабан и колокол, когда выходит дружина.
  village: {
    bpm: 80,
    sub: 2,
    steps: 6,
    play(m, t, p, k) {
      const c = CH[LULLABY_CHORDS[p.bar % 8]];
      if (p.step === 0 && p.bar % 2 === 0) {
        m.fiddle(t, 50, m.dt * 11.5, 0.05);
        m.fiddle(t, 57, m.dt * 11.5, 0.035);
      }
      if (p.step === 0) m.bass(t, c[0] + 12, m.dt * 4, 0.1);
      if (p.step === 0 || p.step === 3 || p.step === 4) m.drum(t, p.step === 0 ? 0.26 : 0.14);
      const n = noteAt(LULLABY, p.bar, p.step);
      if (n && p.cycle % 2 === 0) m.fiddle(t, 62 + n[1], m.dt * n[2] * 0.95, 0.07);
      if (k > 0.35) m.tick(t, 0.03);
      if (k > 0.55 && p.step === 0 && p.bar % 2 === 0) m.bell(t, 62, 0.17);
      if (k > 0.55 && p.step % 2 === 1) m.drum(t, 0.1);
    },
  },

  // Город: шестнадцатые смычков бегут как сигналы по проводам.
  town: {
    bpm: 104,
    sub: 4,
    steps: 16,
    play(m, t, p, k) {
      const name = (p.cycle % 2 ? MARCH_B : LULLABY_CHORDS)[p.bar % 8];
      const c = CH[name];
      const s = p.step;
      if (s === 0) {
        m.pad(t, c.slice(1), m.dt * 16.5, 0.045);
        m.bass(t, c[0] + 12, m.dt * 7, 0.13);
      }
      if (s === 8 || s === 11) m.bass(t, c[0] + 12, m.dt * 2.5, 0.09);
      m.strings(t, c[[1, 3, 2, 3][s % 4]] + 12, m.dt * 0.75, 0.026 + k * 0.025);
      if (s % 8 === 0) m.timp(t, c[0] + 12, 0.15 + k * 0.15);
      if (k > 0.3 && s % 4 === 2) m.tick(t, 0.05);
      if (k > 0.5) {
        const n = noteAt(MARCH, p.bar, s);
        if (n && p.cycle % 2 === 0) m.brass(t, 62 + n[1], m.dt * n[2] * 0.9, 0.08);
      }
    },
  },

  // Мир: тихая карта для раздумий, а бои поднимают марш.
  world: {
    bpm: 74,
    sub: 4,
    steps: 16,
    play(m, t, p, k) {
      const section = Math.floor(p.bar / 8) % 2;
      const c = CH[(section ? MARCH_B : LULLABY_CHORDS)[p.bar % 8]];
      const s = p.step;
      if (s === 0) {
        m.choir(t, c.slice(1), m.dt * 16.5, 0.03 + k * 0.03);
        m.bass(t, c[0] + 12, m.dt * 14, 0.1);
        m.timp(t, c[0] + 12, 0.22 + k * 0.18);
      }
      if (s === 14 && p.bar % 2 === 1) m.timp(t, c[0] + 12, 0.16);
      if (k < 0.3) {
        const n = noteAt(MARCH, p.bar, s);
        if (n && !section && p.cycle % 2 === 1) m.box(t, 62 + n[1], 0.1);
      }
      if (k > 0.25 && [0, 3, 4, 8, 11, 12].includes(s)) m.snare(t, 0.035 + k * 0.05);
      if (k > 0.45) m.strings(t, c[[1, 2, 3, 2][s % 4]], m.dt * 0.8, 0.02 + k * 0.022);
      if (k > 0.6) {
        if (!section) {
          const n = noteAt(MARCH, p.bar, s);
          if (n) m.brass(t, 50 + n[1], m.dt * n[2] * 0.92, 0.1);
        } else if (s === 0 || s === 6) {
          for (const v of c.slice(1, 3)) m.brass(t, v, m.dt * 4, 0.075);
        }
      }
    },
  },
};

// Импульс большого тёмного зала: без него синтез звучит сухо.
function hallImpulse(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = last * 0.72 + (Math.random() * 2 - 1) * 0.28;
      d[i] = last * Math.pow(1 - i / n, 2.6);
    }
  }
  return buf;
}

export class Music {
  constructor() {
    this.ctx = null;
    this.mood = 0;
    this.goal = 0;
    this.wantId = 'title';
    this.id = null;
    this.song = null;
    this.bar = 0;
    this.stepNo = 0;
    this.cycle = 0;
    this.next = 0;
    this.hitAt = 0;
    this.on = this.readPref();
    this.volume = 1;
  }

  readPref() {
    try {
      return localStorage.getItem(STORE) !== '0';
    } catch {
      return true;
    }
  }

  // Подключается к любому контексту: живому или офлайновому для проверки.
  attach(ctx, output) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const sum = ctx.createDynamicsCompressor();
    sum.threshold.value = -16;
    sum.ratio.value = 4;
    sum.attack.value = 0.01;
    sum.release.value = 0.25;
    this.dry = ctx.createGain();
    this.send = ctx.createGain();
    const hall = ctx.createConvolver();
    hall.buffer = hallImpulse(ctx, 3.2);
    this.dry.connect(sum);
    this.send.connect(hall);
    hall.connect(sum);
    sum.connect(this.out);
    this.out.connect(output);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noise;
    this.next = ctx.currentTime + 0.1;
    this.fadeTo(this.level());
  }

  level() {
    return this.on ? 1.05 * this.volume : 0;
  }

  fadeTo(v, time = 1) {
    if (!this.out) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(v, t, time / 3);
  }

  setOn(on) {
    this.on = on;
    try {
      localStorage.setItem(STORE, on ? '1' : '0');
    } catch {
      // Приватный режим: настройка живёт до перезагрузки.
    }
    this.fadeTo(this.level(), 0.4);
  }

  setVolume(v) {
    this.volume = v;
    this.fadeTo(this.level(), 0.2);
  }

  // Смена этапа: тема меняется с начала такта.
  play(id) {
    this.wantId = id;
  }

  setMood(v) {
    this.goal = Math.max(0, Math.min(1, v));
  }

  stop() {
    this.wantId = null;
    this.fadeTo(0, 2);
  }

  get dt() {
    return 60 / this.song.bpm / this.song.sub;
  }

  // Партитура пишется наперёд маленькими порциями.
  schedule(ahead) {
    if (!this.ctx) return;
    const until = this.ctx.currentTime + ahead;
    while (this.next < until) {
      if (this.stepNo === 0 && this.wantId !== this.id) {
        this.id = this.wantId;
        this.song = this.id ? SONGS[this.id] : null;
        this.bar = 0;
        this.cycle = 0;
      }
      if (!this.song) {
        this.next = until + 0.2;
        return;
      }
      this.mood += (this.goal - this.mood) * 0.04;
      this.song.play(this, this.next, { bar: this.bar, step: this.stepNo, cycle: this.cycle }, this.mood);
      this.next += this.dt;
      this.stepNo++;
      if (this.stepNo >= this.song.steps) {
        this.stepNo = 0;
        this.bar++;
        if (this.bar % 8 === 0) this.cycle++;
      }
    }
  }

  // Короткая реплика оркестра на событие.
  hit(kind) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime + 0.03;
    if (t < this.hitAt) return;
    this.hitAt = t + 1.4;
    if (kind === 'capture') {
      for (const v of [50, 57, 62]) this.brass(t, v, 0.9, 0.13);
      this.timp(t, 50, 0.4);
      this.bell(t + 0.02, 74, 0.09);
    } else if (kind === 'lost') {
      for (const v of [39, 45, 50]) this.strings(t, v, 1.1, 0.11);
      this.timp(t, 39, 0.4);
    } else if (kind === 'war') {
      this.timp(t, 38, 0.5);
      this.timp(t + 0.3, 38, 0.5);
      this.bell(t + 0.6, 50, 0.18);
    } else if (kind === 'idea') {
      [69, 74, 77].forEach((v, i) => this.box(t + i * 0.09, v + 12, 0.14));
    } else if (kind === 'win') {
      [50, 57, 62, 69].forEach((v, i) => this.brass(t + i * 0.16, v, 1.5 - i * 0.16, 0.11));
      this.timp(t, 38, 0.45);
    }
  }

  // Голос: огибающая и выходы на сухой канал и в зал.
  voice(t, attack, hold, release, level, wet = 0.4) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + attack + hold);
    g.gain.linearRampToValueAtTime(0, t + attack + hold + release);
    g.connect(this.dry);
    const s = this.ctx.createGain();
    s.gain.value = wet;
    g.connect(s);
    s.connect(this.send);
    return g;
  }

  osc(type, freq, t, end, into, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(into);
    o.start(t);
    o.stop(end);
    return o;
  }

  filter(type, freq, q, into) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(into);
    return f;
  }

  // Шкатулка: чистый тон и пара металлических обертонов.
  box(t, midi, v) {
    const f = hz(midi) * rnd(0.998, 1.002);
    for (const [k, level, life] of [[1, 1, 1.9], [3.01, 0.22, 0.7], [5.4, 0.09, 0.3]]) {
      const g = this.voice(t, 0.004, 0, life, v * level, 0.7);
      g.gain.cancelScheduledValues(t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, life / 4);
      this.osc('sine', f * k, t, t + life + 0.05, g);
    }
  }

  pad(t, notes, dur, v) {
    const lp = this.filter('lowpass', 700, 0.4, this.voice(t, dur * 0.3, dur * 0.3, dur * 0.5, v, 0.8));
    for (const n of notes) {
      this.osc('sawtooth', hz(n), t, t + dur + 0.1, lp, -6);
      this.osc('triangle', hz(n), t, t + dur + 0.1, lp, 7);
    }
  }

  choir(t, notes, dur, v) {
    const env = this.voice(t, dur * 0.35, dur * 0.3, dur * 0.45, v, 0.9);
    const a = this.filter('bandpass', 720, 4, env);
    const b = this.filter('bandpass', 1120, 5, env);
    for (const n of notes) {
      for (const d of [-7, 6]) {
        const o = this.osc('sawtooth', hz(n), t, t + dur + 0.1, a, d);
        o.connect(b);
      }
    }
  }

  strings(t, midi, dur, v) {
    const lp = this.filter('lowpass', 1500, 0.5, this.voice(t, 0.012, dur * 0.5, dur * 0.5, v, 0.35));
    this.osc('sawtooth', hz(midi), t, t + dur + 0.06, lp, -5);
    this.osc('sawtooth', hz(midi), t, t + dur + 0.06, lp, 6);
  }

  fiddle(t, midi, dur, v) {
    const lp = this.filter('bandpass', 950, 1.1, this.voice(t, 0.06, Math.max(0, dur - 0.16), 0.1, v, 0.45));
    const o = this.osc('sawtooth', hz(midi), t, t + dur + 0.05, lp);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = this.ctx.createGain();
    depth.gain.value = 9;
    lfo.connect(depth);
    depth.connect(o.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  pizz(t, midi, v) {
    const g = this.voice(t, 0.003, 0, 0.32, v, 0.35);
    g.gain.cancelScheduledValues(t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.003, 0.07);
    const lp = this.filter('lowpass', 1100, 1, g);
    this.osc('triangle', hz(midi), t, t + 0.36, lp);
  }

  bass(t, midi, dur, v) {
    const lp = this.filter('lowpass', 320, 0.7, this.voice(t, 0.02, dur * 0.6, dur * 0.4, v, 0.15));
    this.osc('triangle', hz(midi), t, t + dur + 0.05, lp);
    this.osc('sine', hz(midi) / 2, t, t + dur + 0.05, lp);
  }

  brass(t, midi, dur, v) {
    const env = this.voice(t, 0.04, Math.max(0, dur - 0.14), 0.1, v, 0.5);
    const lp = this.filter('lowpass', 500, 0.8, env);
    lp.frequency.setValueAtTime(420, t);
    lp.frequency.linearRampToValueAtTime(1500, t + 0.09);
    lp.frequency.linearRampToValueAtTime(950, t + Math.max(0.2, dur));
    this.osc('sawtooth', hz(midi), t, t + dur + 0.05, lp, -4);
    this.osc('sawtooth', hz(midi), t, t + dur + 0.05, lp, 5);
  }

  timp(t, midi, v) {
    const g = this.voice(t, 0.004, 0, 0.8, v, 0.5);
    g.gain.cancelScheduledValues(t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, 0.2);
    const o = this.osc('sine', hz(midi) * 1.4, t, t + 0.85, g);
    o.frequency.setValueAtTime(hz(midi) * 1.4, t);
    o.frequency.exponentialRampToValueAtTime(hz(midi), t + 0.08);
    this.noiseHit(t, 'lowpass', 500, 0.05, v * 0.4, 0.3);
  }

  drum(t, v) {
    const g = this.voice(t, 0.004, 0, 0.3, v, 0.3);
    g.gain.cancelScheduledValues(t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, 0.07);
    const o = this.osc('sine', 120, t, t + 0.34, g);
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.1);
  }

  snare(t, v) {
    this.noiseHit(t, 'bandpass', 1900, 0.09, v, 0.3);
  }

  tick(t, v) {
    this.noiseHit(t, 'highpass', 6000, 0.025, v, 0.2);
  }

  noiseHit(t, type, freq, dur, v, wet) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const g = this.voice(t, 0.002, 0, dur, v, wet);
    src.connect(this.filter(type, freq, 0.9, g));
    src.start(t, Math.random() * 0.8, dur + 0.02);
  }

  // Набат: негармонические обертоны тянутся долго.
  bell(t, midi, v) {
    const f = hz(midi);
    for (const [k, level, life] of [[1, 1, 3], [2.41, 0.5, 2.1], [3.76, 0.3, 1.2], [5.43, 0.14, 0.7]]) {
      const g = this.voice(t, 0.005, 0, life, v * level, 0.8);
      g.gain.cancelScheduledValues(t + 0.005);
      g.gain.setTargetAtTime(0, t + 0.005, life / 4);
      this.osc('sine', f * k, t, t + life + 0.05, g);
    }
  }
}
