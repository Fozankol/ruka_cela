// Обложка и экран загрузки: чёрный экран, название, предупреждение, «Меньше мерцания», «Начать».
// showTitle({ onStart, ready }) — ready (необязательный Promise) держит кнопку в состоянии загрузки.
// onStart получает { lessFlicker }. Возвращает { element, close }.
import './title.css';

const STORE_KEY = 'ruka-cela.lessFlicker';

function readPref() {
  try { return localStorage.getItem(STORE_KEY) === '1'; } catch { return false; }
}
function writePref(v) {
  try { localStorage.setItem(STORE_KEY, v ? '1' : '0'); } catch { /* приватный режим: просто не запоминаем */ }
}

export function showTitle({ onStart, onWar, onStage, onFinale, stages = [], onResume, resumeLabel, ready, parent = document.body } = {}) {
  const root = document.createElement('section');
  root.className = 'title-screen';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'title-name');
  root.innerHTML = `
    <div class="title-thread" aria-hidden="true"></div>
    <div class="title-inner">
      <h1 class="title-name" id="title-name">РУКА ЦЕЛА</h1>
      <p class="title-sub">Паук против человека</p>
      <button class="title-start" type="button">С самого начала</button>
      <button class="title-start title-war" type="button">Сразу к захвату мира</button>
      <p class="title-note">С начала: паук под кроватью, дом, улица, село, город и война. Захват мира: сразу карта планеты, легионы, наука и союзы.</p>
      <div class="title-stages"></div>
      <label class="title-options">
        <input type="checkbox" role="switch" class="title-flicker" />
        <span>Меньше мерцания</span>
      </label>
      <p class="title-warning">В игре много пауков, темнота и вспышки света. Если тебе от этого тяжело, включи «Меньше мерцания» или не играй один.</p>
    </div>`;

  const btn = root.querySelector('.title-start');
  const flicker = root.querySelector('.title-flicker');
  flicker.checked = readPref();
  root.classList.toggle('less-flicker', flicker.checked);
  flicker.addEventListener('change', () => {
    root.classList.toggle('less-flicker', flicker.checked);
    writePref(flicker.checked);
  });

  // Быстрые входы: война сразу или любой этап.
  const warBtn = root.querySelector('.title-war');
  warBtn.addEventListener('click', () => {
    if (btn.disabled) return;
    close();
    onWar?.({ lessFlicker: flicker.checked });
  });
  const stageRow = root.querySelector('.title-stages');
  for (const s of stages) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.label;
    b.addEventListener('click', () => {
      close();
      onStage?.(s.id, { lessFlicker: flicker.checked });
    });
    stageRow.append(b);
  }
  if (onFinale) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Финал';
    b.addEventListener('click', () => {
      close();
      onFinale();
    });
    stageRow.append(b);
  }

  // Сохранённая партия: кнопка появляется только когда есть что продолжить.
  if (resumeLabel) {
    const again = document.createElement('button');
    again.className = 'title-start';
    again.type = 'button';
    again.textContent = resumeLabel;
    btn.before(again);
    again.addEventListener('click', () => {
      close();
      onResume?.({ lessFlicker: flicker.checked });
    });
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    root.classList.add('is-leaving');
    const done = () => root.remove();
    root.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 1500); // на случай отключённых переходов
  }
  function start() {
    if (closed || btn.disabled) return;
    close();
    onStart?.({ lessFlicker: flicker.checked });
  }
  function onKey(e) {
    if (e.key === 'Enter' && document.activeElement !== flicker) start();
  }
  btn.addEventListener('click', start);
  document.addEventListener('keydown', onKey);

  // Экран загрузки: пока ready не выполнен, кнопка ждёт.
  if (ready && typeof ready.then === 'function') {
    btn.disabled = true;
    btn.textContent = 'Загрузка…';
    btn.setAttribute('aria-busy', 'true');
    ready.then(
      () => { btn.disabled = false; btn.textContent = 'С самого начала'; btn.removeAttribute('aria-busy'); if (!closed) btn.focus(); },
      () => { btn.textContent = 'Не загрузилось. Обнови страницу'; btn.removeAttribute('aria-busy'); },
    );
  }

  parent.appendChild(root);
  if (!btn.disabled) btn.focus();
  return { element: root, close };
}
