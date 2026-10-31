// Сохранение только в этом браузере: долгая война не должна пропасть с вкладкой.
const KEY = 'ruka-cela.save';

export function readSave() {
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function writeSave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Приватный режим: игра идёт без сохранения.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Нечего очищать.
  }
}
