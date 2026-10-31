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

export function showTitle({ onStart, ready, parent = document.body } = {}) {
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
      <button class="title-start" type="button">Начать</button>
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
      () => { btn.disabled = false; btn.textContent = 'Начать'; btn.removeAttribute('aria-busy'); if (!closed) btn.focus(); },
      () => { btn.textContent = 'Не загрузилось. Обнови страницу'; btn.removeAttribute('aria-busy'); },
    );
  }

  parent.appendChild(root);
  if (!btn.disabled) btn.focus();
  return { element: root, close };
}
