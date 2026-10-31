import { DREAD_TIME, playDread, playSnap } from '../audio/Dread.js';
import './finale.css';

// Локальный финал без Three.js и сетевых запросов.
// onEnd вызывается один раз за попытку. После lost можно повторить только шаг 7.
// onRestart вызывается, когда «РУКА ЦЕЛА.» отстояла своё: игра идёт сначала.
// Возвращает { element, destroy }; destroy снимает обработчики и восстанавливает страницу.
const HOLD = DREAD_TIME * 1000;
const SILENCE = 1600;
const WON = 10000;
const OUTRO = 1400;

export function showFinale({ stats = {}, onEnd, onRestart, audioContext = null, volume = 1, from = 'intro' } = {}) {
  const root = document.createElement('section');
  root.className = 'finale-screen';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Последняя особь');
  root.tabIndex = -1;
  root.innerHTML = `<canvas class="finale-web" aria-hidden="true"></canvas>
    <div class="finale-content" aria-live="polite"></div>
    <div class="finale-caption" aria-hidden="true">СИГНАЛ ЕЩЁ ЕСТЬ</div>`;
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const content = root.querySelector('.finale-content');
  const caption = root.querySelector('.finale-caption');
  const previousFocus = document.activeElement;
  const siblings = [...document.body.children].filter(el => el instanceof HTMLElement);
  const inertStates = siblings.map(el => el.inert);
  siblings.forEach(el => { el.inert = true; });
  document.body.append(root);
  const oldOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  root.focus({ preventScroll: true });

  let reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { reduced ||= localStorage.getItem('ruka-cela.lessFlicker') === '1'; } catch { /* локальное хранилище необязательно */ }
  root.classList.toggle('finale-reduced', reduced);
  let phase, phaseStart, lastFrame = performance.now(), raf, destroyed = false;
  let width = innerWidth, height = innerHeight, web = 0, movement = 0, lastInput = null;
  let pointer = null, cursor = null, countdown, lastSecond = -1, suspendedAt = null;
  let audio, output, gain, noise, filter, dread = null, audioClosed = false, voiceLine;
  // Только установленный локальный голос: удалённый синтез не отправляет текст.
  const speech = window.speechSynthesis;
  function playLena() {
    const voice = speech?.getVoices().find(v => v.localService && /^ru(?:-|_)/i.test(v.lang));
    if (!voice) return false;
    voiceLine = new SpeechSynthesisUtterance('Если ты это слышишь, не шевелись.');
    voiceLine.voice = voice; voiceLine.lang = voice.lang;
    voiceLine.rate = 0.78; voiceLine.pitch = 0.85; voiceLine.volume = 0.45 * Math.min(1, volume);
    speech.speak(voiceLine); return true;
  }
  const events = new AbortController();
  const listen = (target, name, fn, options = {}) => target.addEventListener(name, fn, { ...options, signal: events.signal });
  const number = value => Math.max(0, Math.floor(Number.isFinite(Number(value)) ? Number(value) : 0));
  const format = value => number(value).toLocaleString('ru-RU');

  // Тихая узкополосная радиопомеха. Никакой записи микрофона или внешнего аудио.
  // Игра отдаёт свой звуковой контекст, он уже разрешён жестом игрока.
  // Если контекста нет, звук можно включить кнопкой у записи Лены.
  function enableAudio() {
    try {
      if (!audio) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!audioContext && !Audio) return;
        audio = audioContext ?? new Audio();
        output = audio.createGain(); output.gain.value = volume; output.connect(audio.destination);
        const buffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
        noise = audio.createBufferSource(); noise.buffer = buffer; noise.loop = true;
        filter = audio.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = 1100; filter.Q.value = 0.7;
        gain = audio.createGain(); gain.gain.value = 0;
        noise.connect(filter).connect(gain).connect(output); noise.start();
      }
      audio.resume().catch(() => {});
    } catch { /* финал полностью доступен без звука */ }
  }
  if (audioContext || navigator.userActivation?.hasBeenActive) enableAudio();
  function radioVolume(value) {
    if (audio && !audioClosed) gain.gain.setTargetAtTime(value, audio.currentTime, 0.3);
  }
  function stopDread() {
    dread?.stop(); dread = null;
    root.style.removeProperty('--dread');
  }
  function enter(next, now = performance.now()) {
    stopDread();
    phase = next; phaseStart = now; root.dataset.phase = next;
    root.classList.toggle('finale-hide-cursor', !['lost', 'won'].includes(next));
    caption.textContent = next === 'radio' ? 'АРХИВ / ПОСЛЕДНИЙ ЭФИР' : next === 'outro' ? '' : 'СИГНАЛ ЕЩЁ ЕСТЬ';
    radioVolume(next === 'radio' ? 0.035 : 0);
    if (next === 'intro') {
      content.innerHTML = '<p class="finale-eyebrow">Население Земли: 1</p><h1>Осталась одна особь.<br>На планете её нет.</h1>';
    } else if (next === 'web') {
      content.innerHTML = '<p class="finale-eyebrow">Нить вышла за пределы карты</p><h1>Она здесь.</h1>';
    } else if (next === 'stats') {
      const minutes = number(stats.minutes), hours = Math.floor(minutes / 60);
      const clock = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      content.innerHTML = `<p class="finale-eyebrow">Всё это время — по другую сторону</p>
        <h1>Ты здесь ${hours ? `${hours} ч ` : ''}${minutes % 60} мин.</h1>
        <p class="finale-stat">${format(stats.clicks)} кликов. ${format(stats.food)} еды.</p>
        <p class="finale-clock">Сейчас ${clock}. Почему ты не спишь?</p>`;
    } else if (next === 'radio') {
      content.innerHTML = '<p class="finale-eyebrow">Лена / последняя запись</p><div class="finale-radio" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><blockquote>«Если ты это слышишь,<br>не шевелись.»</blockquote><p class="finale-hint">Через несколько секунд — замри на двадцать.<br>Ни мышью, ни клавишей, ни касанием.</p>';
      if (!playLena()) {
        const note = document.createElement('p'); note.className = 'finale-hint';
        note.textContent = 'Расшифровка записи · голос на этом устройстве недоступен'; content.append(note);
      }
      if (!audio || (!audioContext && audio.state !== 'running')) {
        const button = document.createElement('button'); button.textContent = 'Включить звук эфира';
        button.onclick = () => { enableAudio(); radioVolume(0.035); button.remove(); root.focus(); };
        content.append(button);
      }
    } else if (next === 'countdown') {
      movement = 0; lastInput = pointer ? { ...pointer } : null; lastSecond = -1;
      content.innerHTML = '<h1 class="finale-command">НЕ ДВИГАЙСЯ.</h1><div class="finale-timer" role="timer" aria-label="Секунд осталось">20</div><p class="finale-hint">Они слышат только движение.</p><button class="finale-temptation" type="button">+1 000 000 шёлка</button>';
      countdown = content.querySelector('.finale-timer');
      content.querySelector('button').onclick = () => lose();
      root.focus({ preventScroll: true });
      if (audio && !audioClosed) { audio.resume().catch(() => {}); dread = playDread(audio, output); }
    } else if (next === 'lost') {
      web = 0; caption.textContent = '';
      if (audio && !audioClosed) playSnap(audio, output);
      content.innerHTML = '<p class="finale-eyebrow">Нить дрогнула</p><h1>Население Земли: 0</h1><button type="button">Повторить шаг 7</button><p class="finale-hint">После нажатия у тебя три секунды, чтобы замереть.</p>';
      content.querySelector('button').onclick = () => enter('ready');
      onEnd?.('lost');
    } else if (next === 'ready') {
      content.innerHTML = '<p class="finale-eyebrow">Ещё одна попытка</p><h1>Замри.</h1><p class="finale-hint">Отсчёт начнётся через три секунды.</p>';
      root.focus({ preventScroll: true });
    } else if (next === 'silence') {
      web = 0; caption.textContent = ''; content.replaceChildren();
    } else if (next === 'won') {
      caption.textContent = ''; content.innerHTML = '<h1 class="finale-won">РУКА ЦЕЛА.</h1>';
      onEnd?.('won');
    }
  }
  function lose() { if (phase === 'countdown') enter('lost'); }
  function move(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    pointer = { x: e.clientX, y: e.clientY };
    if (!cursor) cursor = { ...pointer };
    if (phase !== 'countdown') return;
    // Считаем весь пройденный путь, а не расстояние до стартовой точки.
    const distance = lastInput ? Math.hypot(pointer.x - lastInput.x, pointer.y - lastInput.y)
      : Math.hypot(e.movementX || 0, e.movementY || 0);
    movement += distance; lastInput = { ...pointer };
    if (movement > 12) lose();
  }
  listen(window, 'pointermove', move, { capture: true });
  for (const name of ['pointerdown', 'touchstart', 'touchmove', 'wheel']) {
    listen(window, name, e => { if (phase === 'countdown') { e.preventDefault(); e.stopImmediatePropagation(); lose(); } }, { capture: true, passive: false });
  }
  listen(window, 'keydown', e => {
    if (phase === 'countdown') { e.preventDefault(); e.stopImmediatePropagation(); lose(); return; }
    if (e.key === 'Tab') {
      const buttons = [...content.querySelectorAll('button')];
      e.preventDefault(); (buttons[0] || root).focus();
    }
  }, { capture: true });
  // Уход со страницы не позволяет незаметно выиграть: ожидание ставится на паузу.
  listen(document, 'visibilitychange', () => {
    if (document.hidden) { suspendedAt = performance.now(); radioVolume(0); if (!audioClosed) audio?.suspend().catch(() => {}); }
    else if (suspendedAt !== null) {
      phaseStart += performance.now() - suspendedAt; suspendedAt = null;
      if (!audioClosed) audio?.resume().catch(() => {});
      radioVolume(phase === 'radio' ? 0.035 : 0);
    }
  });
  function resize() {
    width = innerWidth; height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  listen(window, 'resize', resize); resize();
  function draw(now, dt) {
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    const target = ['web', 'stats', 'radio', 'countdown', 'ready'].includes(phase) ? 1 : 0;
    web += (target - web) * (1 - Math.exp(-dt * 0.55));
    if (web > 0.005) {
      ctx.lineWidth = 0.65;
      // За двадцать секунд паутина смыкается к центру экрана.
      const press = phase === 'countdown' ? Math.min(1, (now - phaseStart) / HOLD) : 0;
      const reach = Math.min(width, height) * (0.3 + 0.55 * web) * (1 + 0.6 * press);
      for (const [ox, oy, angle] of [[0, 0, 0], [width, 0, Math.PI / 2], [width, height, Math.PI], [0, height, -Math.PI / 2]]) {
        ctx.save(); ctx.translate(ox, oy); ctx.rotate(angle);
        ctx.strokeStyle = `rgba(207,216,220,${web * (0.24 + 0.2 * press)})`;
        for (let ray = 0; ray <= 12; ray++) {
          const a = ray / 12 * Math.PI / 2;
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach); ctx.stroke();
        }
        for (let ring = 1; ring <= 16; ring++) {
          const r = reach * (ring / 16) ** 1.45;
          ctx.beginPath();
          for (let ray = 0; ray <= 12; ray++) {
            const a = ray / 12 * Math.PI / 2, x = Math.cos(a) * r, y = Math.sin(a) * r;
            if (!ray) ctx.moveTo(x, y);
            else { const mid = a - Math.PI / 48; ctx.quadraticCurveTo(Math.cos(mid) * r * 0.94, Math.sin(mid) * r * 0.94, x, y); }
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    if (pointer && cursor && !['lost', 'won', 'silence', 'outro'].includes(phase)) {
      const ease = 1 - Math.exp(-dt * (reduced ? 16 : 3.2));
      cursor.x += (pointer.x - cursor.x) * ease; cursor.y += (pointer.y - cursor.y) * ease;
      ctx.strokeStyle = 'rgba(240,240,235,.65)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cursor.x, cursor.y); ctx.lineTo(cursor.x + 3, cursor.y + 15); ctx.lineTo(cursor.x + 7, cursor.y + 10); ctx.lineTo(cursor.x + 14, cursor.y + 9); ctx.closePath(); ctx.stroke();
      ctx.strokeStyle = `rgba(200,210,213,${web * 0.4})`;
      ctx.beginPath(); ctx.moveTo(cursor.x, cursor.y); ctx.lineTo(pointer.x, pointer.y); ctx.stroke();
    }
  }
  function frame(now) {
    if (destroyed) return;
    const dt = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now;
    if (suspendedAt === null) {
      const elapsed = now - phaseStart;
      if (phase === 'intro' && elapsed >= 4000) enter('web', now);
      else if (phase === 'web' && elapsed >= 4000) enter('stats', now);
      else if (phase === 'stats' && elapsed >= 7000) enter('radio', now);
      else if (phase === 'radio' && elapsed >= 8000) enter('countdown', now);
      else if (phase === 'ready' && elapsed >= 3000) enter('countdown', now);
      else if (phase === 'countdown') {
        const seconds = Math.max(0, Math.ceil((HOLD - elapsed) / 1000));
        if (seconds !== lastSecond) { countdown.textContent = seconds; lastSecond = seconds; }
        root.style.setProperty('--dread', Math.min(1, elapsed / HOLD).toFixed(3));
        if (elapsed >= HOLD) enter('silence', now);
      } else if (phase === 'silence' && elapsed >= SILENCE) enter('won', now);
      else if (phase === 'won' && elapsed >= WON) enter('outro', now);
      else if (phase === 'outro' && elapsed >= OUTRO) { phase = 'end'; onRestart?.(); }
      draw(now, dt);
    }
    raf = requestAnimationFrame(frame);
  }
  enter(from); raf = requestAnimationFrame(frame);
  function destroy() {
    if (destroyed) return;
    destroyed = true; cancelAnimationFrame(raf); events.abort();
    stopDread();
    if (audio) { audioClosed = true; noise?.stop(); output.disconnect(); if (!audioContext) audio.close().catch(() => {}); }
    if (voiceLine) speech?.cancel();
    root.remove(); document.body.style.overflow = oldOverflow;
    siblings.forEach((el, i) => { el.inert = inertStates[i]; });
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  return { element: root, destroy };
}
