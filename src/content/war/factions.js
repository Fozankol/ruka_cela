// Блоки людей. Вымышленные: настоящих государств, флагов и политиков в игре нет.
export const FACTIONS = [
  { id: 'caravan', name: 'Лига Караванов', capital: 'persia', color: [100, 66, 24], regions: ['caspian', 'persia', 'mesopotamia', 'arabia', 'anatolia', 'levant'], text: 'Торговцы и нефть. Считают рой чужой бедой, пока он не придёт к ним.' },
  { id: 'river', name: 'Речной совет', capital: 'ganges', color: [104, 46, 40], regions: ['indus', 'ganges', 'deccan'], text: 'Больше всего людей и меньше всего согласия.' },
  { id: 'east', name: 'Восточная ассамблея', capital: 'north_plain', color: [92, 36, 56], regions: ['siberia', 'fareast', 'north_plain', 'south_coast', 'west_mountains', 'korea', 'islands'], text: 'Заводы, дисциплина и самая большая армия мира.' },
  { id: 'ocean', name: 'Морской союз', capital: 'archipelago', color: [20, 76, 78], regions: ['indochina', 'archipelago', 'philippine', 'australia'], text: 'Живёт на воде и надеется, что вода спасёт.' },
  { id: 'north', name: 'Северный пакт', capital: 'central_europe', color: [30, 58, 104], regions: ['volga', 'russian_plain', 'black_sea', 'baltic', 'scandinavia', 'central_europe', 'west_europe', 'british', 'iberia', 'balkans'], text: 'Лаборатории и старые крепости. Там работает проект «Рассвет».' },
  { id: 'sun', name: 'Союз Солнца', capital: 'nile', color: [56, 86, 30], regions: ['maghreb', 'nile', 'sahel', 'guinea', 'congo', 'east_africa', 'south_africa'], text: 'Молодые страны, у которых нет денег на долгую войну.' },
  { id: 'atlantic', name: 'Атлантический конгресс', capital: 'east_coast', color: [74, 42, 98], regions: ['great_lakes', 'east_coast', 'gulf', 'pacific_coast', 'highlands', 'caribbean'], text: 'Богаче всех и дальше всех. Думает, что океан его защитит.' },
  { id: 'south', name: 'Республики Юга', capital: 'atlantic_south', color: [30, 90, 64], regions: ['amazon', 'andes', 'atlantic_south', 'pampas'], text: 'Леса и горы. Тут рой будет воевать долго.' },
];

// Местность меняет оборону людей, а мегаполисы ещё и кормят рой.
export const TERRAIN = {
  plain: { name: 'Равнина', def: 1 },
  hills: { name: 'Горы', def: 1.4 },
  forest: { name: 'Леса', def: 1.2 },
  desert: { name: 'Пустыня', def: 0.9 },
  metro: { name: 'Мегаполисы', def: 1.3 },
  isle: { name: 'Острова', def: 1.25 },
};

export const REGION_TERRAIN = {
  persia: 'hills',
  anatolia: 'hills',
  west_mountains: 'hills',
  highlands: 'hills',
  andes: 'hills',
  balkans: 'hills',
  siberia: 'forest',
  scandinavia: 'forest',
  congo: 'forest',
  amazon: 'forest',
  indochina: 'forest',
  arabia: 'desert',
  sahel: 'desert',
  maghreb: 'desert',
  nile: 'desert',
  west_europe: 'metro',
  east_coast: 'metro',
  north_plain: 'metro',
  south_coast: 'metro',
  ganges: 'metro',
  islands: 'isle',
  british: 'isle',
  philippine: 'isle',
  archipelago: 'isle',
  australia: 'isle',
  caribbean: 'isle',
};

// Научные центры: захваченные лаборатории ускоряют исследования.
export const LABS = ['west_europe', 'central_europe', 'east_coast', 'pacific_coast', 'islands', 'north_plain', 'british'];

// Ресурсы регионов: у каждого направления своя выгода, поэтому первый удар это выбор.
export const RESOURCES = {
  food: { name: 'Житница', text: 'доход региона +60%', icon: 'drop' },
  venom: { name: 'Химзаводы', text: 'атака легионов +4%, открывают Вдов', icon: 'fang' },
  chitin: { name: 'Рудники', text: 'оборона легионов +4%, открывают Хитин', icon: 'shield' },
  lab: { name: 'Лаборатория', text: 'наука быстрее на 7%', icon: 'flask' },
};

export const REGION_RES = {
  ganges: 'food',
  north_plain: 'food',
  russian_plain: 'food',
  nile: 'food',
  great_lakes: 'food',
  pampas: 'food',
  indochina: 'food',
  caspian: 'venom',
  arabia: 'venom',
  mesopotamia: 'venom',
  black_sea: 'venom',
  korea: 'venom',
  gulf: 'venom',
  guinea: 'venom',
  persia: 'chitin',
  siberia: 'chitin',
  west_mountains: 'chitin',
  scandinavia: 'chitin',
  south_africa: 'chitin',
  andes: 'chitin',
  australia: 'chitin',
};
