// Типы легионов. atk и def на полную силу, speed меняет скорость на карте.
export const LEGIONS = {
  swarm: { name: 'Рой', mark: 'Р', atk: 10, def: 8, speed: 1, cost: 90, days: 30, text: 'Обычные бойцы: дёшево и быстро выводятся.' },
  chitin: { name: 'Хитин', mark: 'Х', atk: 8, def: 15, speed: 0.8, cost: 150, days: 44, need: 'chitin0', res: 'chitin', text: 'Держат границу. Медленные, зато их трудно сломить.' },
  widow: { name: 'Вдовы', mark: 'В', atk: 17, def: 6, speed: 1.25, cost: 170, days: 42, need: 'venom0', res: 'venom', text: 'Прорыв: кусают сильнее всех, но быстро теряют дух.' },
  weaver: { name: 'Ткачи', mark: 'Т', atk: 7, def: 9, speed: 1, cost: 130, days: 38, need: 'silk0', siege: 1.6, text: 'Заплетают укрепления: гарнизоны падают быстрее.' },
  rats: { name: 'Крысы', mark: 'К', atk: 9, def: 6, speed: 1.4, cost: 0, days: 0, hidden: true, text: 'Союзники из подвалов.' },
  renegades: { name: 'Отступники', mark: 'О', atk: 13, def: 12, speed: 1, cost: 0, days: 0, hidden: true, text: 'Люди, которые выбрали рой.' },
};

// Армии людей. С каждой стадией войны они становятся сильнее.
export const HUMAN_ARMY = { name: 'Армия', mark: 'А', atk: 7.5, def: 8.5, speed: 0.9 };

// Легион, прошедший через бои, получает имя.
export const LEGION_TITLES = ['Жнецы', 'Шепчущие', 'Тихая Смерть', 'Дети Щели', 'Чёрные Нити', 'Последний Укус', 'Ночная Смена', 'Те, Кто Ждал', 'Сухие Лапы', 'Голоса Из Стены', 'Безымянные', 'Рука Цела'];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];

export const legionName = (n) => ROMAN[n - 1] ?? String(n);
