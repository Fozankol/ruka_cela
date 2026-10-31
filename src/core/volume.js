// Громкость хранится только в браузере игрока: общая, музыка и звуки.
const STORE = 'ruka-cela.volume';
const START = { all: 1, music: 1, sfx: 1 };
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

export function readVolume() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE)) ?? {};
    return Object.fromEntries(Object.entries(START).map(([id, v]) => [id, id in saved ? clamp01(saved[id]) : v]));
  } catch {
    return { ...START };
  }
}

export function writeVolume(v) {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    // Приватный режим: настройка живёт до перезагрузки.
  }
}

// Слух работает по логарифму: с квадратом ползунок идёт ровно.
export const loud = (v) => v * v;
