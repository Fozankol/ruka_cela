// Улучшения гнезда. Цена растёт с каждым уровнем, эффект применяется к world.mods.
export const UPGRADES = [
  { id: 'carry', name: 'Жадные лапы', desc: 'Носильщик тащит на 1 сока больше', max: 5, cost: 15, grow: 1.7, apply: (m) => (m.carry += 1) },
  { id: 'land', name: 'Новые угодья', desc: 'Открывает новый источник еды', max: 2, cost: 40, grow: 3, apply: (m, w) => w.openFood() },
  { id: 'room', name: 'Просторное гнездо', desc: '+3 места в рое', max: 4, cost: 30, grow: 1.8, apply: (m) => (m.cap += 3) },
  { id: 'birth', name: 'Тёплая кладка', desc: 'Пауки рождаются на 20% быстрее', max: 3, cost: 25, grow: 1.9, apply: (m) => (m.birth *= 0.8) },
  { id: 'speed', name: 'Быстрые лапы', desc: 'Весь рой бегает на 12% быстрее', max: 3, cost: 35, grow: 1.9, apply: (m) => (m.speed *= 1.12) },
  { id: 'quiet', name: 'Тихий шаг', desc: 'Подозрение растёт на 25% медленнее', max: 3, cost: 30, grow: 2, apply: (m) => (m.quiet *= 0.75) },
  { id: 'venom', name: 'Острый яд', desc: 'Боец кусает на 1 сильнее', max: 4, cost: 45, grow: 1.9, apply: (m) => (m.bite += 1) },
  { id: 'shell', name: 'Твёрдый панцирь', desc: 'Боец выдерживает на 1 удар больше', max: 3, cost: 50, grow: 2, apply: (m) => (m.hp += 1) },
];

export const upgradeCost = (u, level) => Math.round(u.cost * u.grow ** level);
