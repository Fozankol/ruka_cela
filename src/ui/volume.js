import { ICONS } from './icons.js';

const ROWS = [
  ['all', 'Общая'],
  ['music', 'Музыка'],
  ['sfx', 'Звуки'],
];

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.append(e);
  return e;
};

// Кнопка в углу открывает громкость. Она стоит выше обложки, поэтому звук можно настроить до начала игры.
export function volumeControl(sound, parent = document.body) {
  const box = el('div', 'sndbox', parent);
  const btn = el('button', 'snd', box);
  btn.type = 'button';
  btn.title = 'Громкость';
  btn.setAttribute('aria-label', 'Громкость');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = ICONS.note;
  const panel = el('div', 'vol', box);

  const markMusic = () => btn.classList.toggle('off', !sound.music.on);
  for (const [id, label] of ROWS) {
    const row = el('label', '', panel);
    el('span', '', row, label);
    const input = el('input', '', row);
    input.type = 'range';
    input.min = 0;
    input.max = 100;
    input.step = 5;
    input.value = Math.round(sound.volume[id] * 100);
    const value = el('b', '', row);
    const show = () => {
      value.textContent = input.value;
      input.style.setProperty('--v', `${input.value}%`);
    };
    show();
    input.addEventListener('input', () => {
      sound.setVolume(id, input.value / 100);
      if (id === 'music' && input.value > 0 && !sound.music.on) sound.music.setOn(true);
      markMusic();
      show();
    });
    // Короткий звук показывает новую громкость. Музыку и так слышно.
    if (id !== 'music') input.addEventListener('change', () => sound.audio.ctx && sound.audio.play('radioBlip'));
  }
  el('p', '', panel, 'M: выключить или включить музыку');

  const open = (on) => {
    panel.classList.toggle('on', on);
    btn.setAttribute('aria-expanded', String(on));
  };
  btn.addEventListener('click', () => open(!panel.classList.contains('on')));
  window.addEventListener('pointerdown', (e) => {
    if (!box.contains(e.target)) open(false);
  });
  markMusic();

  return {
    toggleMusic() {
      sound.music.setOn(!sound.music.on);
      markMusic();
    },
  };
}
