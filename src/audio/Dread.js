// Двадцать секунд неподвижности. Звук растёт так, будто сейчас выпрыгнет скример,
// а потом просто обрывается. Скримера нет: удар здесь делает тишина.
export const DREAD_TIME = 20;

const rise = (a, b, k) => a * (b / a) ** k;
const rnd = (a, b) => a + Math.random() * (b - a);

function curve(peak, power, start = 0, n = 96) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = start + (peak - start) * (i / (n - 1)) ** power;
  return out;
}

function whiteNoise(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function filter(ctx, type, from, to, t0, end, q = 0.8) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, end);
  return f;
}

// Работает с живым и с офлайновым контекстом, поэтому громкость можно замерить без звука.
export function playDread(ctx, output, time = DREAD_TIME) {
  const t0 = ctx.currentTime + 0.05;
  const end = t0 + time;
  const stopAt = end + 0.05;
  const white = whiteNoise(ctx);

  // Общая кривая тянет громкость до последней секунды, а ограничитель только держит пики.
  const mix = ctx.createGain();
  mix.gain.value = 0;
  mix.gain.setValueCurveAtTime(curve(0.8, 1.6, 0.6), t0, time);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 3;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  const out = ctx.createGain();
  out.gain.value = 0.85;
  out.gain.setValueAtTime(0.85, end - 0.012);
  out.gain.linearRampToValueAtTime(0, end);
  mix.connect(limiter);
  limiter.connect(out);
  out.connect(output);

  const voice = (type, from, to, dest) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, end);
    o.connect(dest);
    o.start(t0);
    o.stop(stopAt);
  };
  // Слой вступает в from и набирает громкость к самому концу.
  const layer = (peak, power, from = 0, start = 0) => {
    const g = ctx.createGain();
    g.gain.value = start;
    g.gain.setValueCurveAtTime(curve(peak, power, start), t0 + from, time - from);
    g.connect(mix);
    return g;
  };
  const hiss = (dest) => {
    const s = ctx.createBufferSource();
    s.buffer = white;
    s.loop = true;
    s.connect(dest);
    s.start(t0);
    s.stop(stopAt);
  };

  // Гул: два близких тона бьются всё чаще и поднимаются на октаву.
  const lowFilter = filter(ctx, 'lowpass', 260, 2400, t0, end);
  lowFilter.connect(layer(0.34, 1.1));
  voice('triangle', 55, 110, lowFilter);
  voice('triangle', 58.3, 116.5, lowFilter);

  // Натянутая струна звучит с первой секунды: её слышно и на маленьких динамиках.
  const stringFilter = filter(ctx, 'bandpass', 500, 1800, t0, end, 1.4);
  stringFilter.connect(layer(0.42, 2.2, 0, 0.09));
  for (const r of [1, 1.06, 1.5]) voice('sawtooth', 220 * r, 520 * r, stringFilter);

  // Струнный кластер ползёт вверх, а его дрожь разгоняется.
  const bodyFilter = filter(ctx, 'lowpass', 240, 5200, t0, end, 0.9);
  const shake = ctx.createGain();
  shake.gain.value = 0.6;
  const shakeDepth = ctx.createGain();
  shakeDepth.gain.value = 0.4;
  voice('sine', 2.5, 22, shakeDepth);
  shakeDepth.connect(shake.gain);
  bodyFilter.connect(shake);
  shake.connect(layer(0.13, 2));
  for (const r of [1, 1.06, 1.19, 1.5, 1.59, 2.12]) voice('sawtooth', 110 * r, 330 * r, bodyFilter);

  // Шум, как ветер перед чем-то большим.
  const wind = filter(ctx, 'bandpass', 500, 7000, t0, end, 1.1);
  wind.connect(layer(0.32, 3.2));
  hiss(wind);

  // Тонкий писк в ушах приходит на второй половине.
  const ring = layer(0.05, 1.6, 4);
  voice('sine', 1760, 2637, ring);
  voice('sine', 1864, 2794, ring);

  // Сердце разгоняется.
  const thump = (at, gain) => {
    const t = t0 + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    // Обертон делает удар слышимым там, где нет баса.
    const knock = ctx.createOscillator();
    const knockGain = ctx.createGain();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(240, t);
    knock.frequency.exponentialRampToValueAtTime(110, t + 0.1);
    knockGain.gain.value = 0.7;
    knock.connect(knockGain);
    knockGain.connect(g);
    o.connect(g);
    g.connect(mix);
    o.start(t);
    o.stop(t + 0.3);
    knock.start(t);
    knock.stop(t + 0.3);
  };
  for (let at = 0.5; at < time - 0.12; ) {
    const k = at / time;
    const gain = 0.2 + 0.4 * k ** 1.4;
    const gap = rise(1.3, 0.3, k);
    thump(at, gain);
    if (gap > 0.55) thump(at + 0.17, gain * 0.7);
    at += gap;
  }

  // Лапки: короткие пробежки со всех сторон, к концу они не смолкают.
  const tick = (at, gain, dest) => {
    const t = t0 + at;
    const s = ctx.createBufferSource();
    s.buffer = white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = rnd(2200, 6000);
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 1.5, 0.02);
  };
  for (let at = 1.4; at < time - 0.1; ) {
    const k = at / time;
    const pan = ctx.createStereoPanner();
    pan.pan.value = rnd(-0.95, 0.95);
    pan.connect(mix);
    const steps = 3 + Math.floor(rnd(0, 3) + k * 9);
    let t = at;
    for (let i = 0; i < steps && t < time; i++) {
      tick(t, 0.05 + 0.4 * k ** 2, pan);
      t += rnd(0.022, 0.042);
    }
    at += rise(1.5, 0.1, k) * rnd(0.7, 1.3);
  }

  // Последние пять секунд: удар на каждую цифру, и каждый выше прошлого.
  const strike = (at, f, gain) => {
    const t = t0 + at;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    lp.connect(g);
    g.connect(mix);
    for (const r of [1, 1.5, 2.01, 2.99]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * r;
      o.connect(lp);
      o.start(t);
      o.stop(t + 1.2);
    }
  };
  [73.4, 77.8, 82.4, 87.3, 92.5].forEach((f, i) => strike(time - 5 + i, f, 0.09 + i * 0.03));

  // Вдох перед ударом, которого не будет.
  const gasp = ctx.createGain();
  gasp.gain.value = 0;
  gasp.gain.setValueAtTime(0.0001, end - 1.6);
  gasp.gain.exponentialRampToValueAtTime(0.36, end);
  gasp.connect(mix);
  const gaspFilter = ctx.createBiquadFilter();
  gaspFilter.type = 'highpass';
  gaspFilter.frequency.value = 1500;
  gaspFilter.connect(gasp);
  hiss(gaspFilter);

  return {
    stop() {
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.01);
      setTimeout(() => out.disconnect(), 200);
    },
  };
}

// Игрок шевельнулся: нить лопается, нарастание пропадает.
export function playSnap(ctx, output) {
  const t = ctx.currentTime + 0.02;
  const pair = [
    ['triangle', 190, 46, 0.26, 0.55],
    ['sine', 1400, 300, 0.05, 0.09],
  ];
  for (const [type, from, to, gain, dur] of pair) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.9);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(output);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
