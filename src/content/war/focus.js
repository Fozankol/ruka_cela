// Путь разума: долгие решения роя. Изучается по одному, у трёх доктрин выбор один раз и навсегда.
// col и row задают место на схеме.
export const FOCUS = [
  { id: 'first', name: 'Первая мысль', days: 60, col: 2, row: 0, needs: [], desc: 'Рой замечает самого себя. Влияние +0,1 в день.', apply: (m) => (m.influence += 0.1), story: { title: 'Первая мысль', text: 'Нити между гнёздами стали длиннее нервов. Миллиарды лап замерли на одну секунду. Рой впервые подумал слово «мы».' } },

  { id: 'lang', name: 'Язык нитей', days: 90, col: 1, row: 1, needs: ['first'], desc: 'Рой учится говорить с людьми. Открывает дипломатию.', apply: (m) => (m.diplomacy = true), story: { title: 'Рой заговорил', text: 'Утром на главной площади лежала паутина в форме букв: «ПОГОВОРИМ». Люди сожгли её. На следующее утро надпись вернулась, и букв стало больше.' } },
  { id: 'corps', name: 'Устав легионов', days: 90, col: 2, row: 1, needs: ['first'], desc: 'Лимит легионов +1, потери духа −10%.', apply: (m) => { m.cap += 1; m.armor *= 1.1; } },
  { id: 'roads', name: 'Живые дороги', days: 90, col: 3, row: 1, needs: ['first'], desc: 'Снабжение дальше на 1 регион, легионы быстрее на 10%.', apply: (m) => { m.supply += 1; m.speed *= 1.1; } },

  { id: 'terror', name: 'Доктрина ужаса', days: 135, col: 0, row: 2, needs: ['lang'], excl: ['treaty', 'mimic'], desc: 'Атака +15%. Мировая тревога растёт быстрее на 20%.', apply: (m) => { m.atk *= 1.15; m.tension *= 1.2; } },
  { id: 'treaty', name: 'Доктрина договора', days: 135, col: 1, row: 2, needs: ['lang'], excl: ['terror', 'mimic'], desc: 'Пакты дешевле на 40%, влияние +0,15 в день.', apply: (m) => { m.pactCost *= 0.6; m.influence += 0.15; } },
  { id: 'mimic', name: 'Доктрина подмены', days: 135, col: 2, row: 2, needs: ['lang'], excl: ['terror', 'treaty'], desc: 'Тревога растёт медленнее на 25%, гарнизоны слабее на 10%.', apply: (m) => { m.tension *= 0.75; m.garrison *= 0.9; } },
  { id: 'nests', name: 'Гнездо в каждом городе', days: 105, col: 3, row: 2, needs: ['roads'], desc: 'Гнёзда дешевле на 30%, доход +10%.', apply: (m) => { m.nestCost *= 0.7; m.income *= 1.1; } },
  { id: 'sails', name: 'Шёлковые паруса', days: 165, col: 4, row: 2, needs: ['roads'], desc: 'Легионы пересекают моря без науки.', apply: (m) => (m.sea = true) },

  { id: 'terror2', name: 'Ночь длинных лап', days: 150, col: 0, row: 3, needs: ['terror'], desc: 'Атака +15%, захват приносит на 50% больше биомассы.', apply: (m) => { m.atk *= 1.15; m.loot *= 1.5; } },
  { id: 'treaty2', name: 'Посольство в коконе', days: 150, col: 1, row: 3, needs: ['treaty'], desc: 'Живой посол в паутине. Союзников может быть на 1 больше, пакты длятся вдвое дольше.', apply: (m) => { m.allies += 1; m.pactDays *= 2; } },
  { id: 'mimic2', name: 'Лица людей', days: 150, col: 2, row: 3, needs: ['mimic'], desc: 'Подменённые сидят в штабах. Армии людей слабее на 15%.', apply: (m) => (m.foeK *= 0.85) },

  { id: 'terror3', name: 'Страх как оружие', days: 180, col: 0, row: 4, needs: ['terror2'], desc: 'Блоки людей сдаются раньше: при потере 50% земель.', apply: (m) => (m.surrender = 0.5) },
  { id: 'treaty3', name: 'Мир по-паучьи', days: 180, col: 1, row: 4, needs: ['treaty2'], desc: 'Союзы переживают Коалицию: блоки с пактом не вступают в неё. Блоки сдаются при потере 55% земель.', apply: (m) => { m.keepPacts = true; m.surrender = 0.55; } },
  { id: 'mimic3', name: 'Голос мамы', days: 180, col: 2, row: 4, needs: ['mimic2'], desc: 'В эфир звонят голосом близких. «Рассвет» медленнее на 40%, захват ослабляет соседей.', apply: (m) => { m.dawn *= 0.6; m.voice = Math.max(m.voice, 0.2); } },

  { id: 'hive', name: 'Единый разум', days: 240, col: 2, row: 5, needs: ['terror3|treaty3|mimic3'], desc: 'Все гнёзда думают как одно. Атака и оборона +20%, наука +20%.', apply: (m) => { m.atk *= 1.2; m.def *= 1.2; m.research *= 1.2; }, story: { title: 'Единый разум', text: 'Больше нет отдельных пауков. Есть одна мысль, которая ходит по планете на восьми миллиардах ног. И эта мысль начинает смотреть вверх.' } },
];

// Условие needs: все перечисленные, а вариант через «|» значит любой из них.
export function focusOpen(n, done) {
  if (done[n.id]) return false;
  if (n.excl?.some((id) => done[id])) return false;
  return n.needs.every((need) => need.split('|').some((id) => done[id]));
}
