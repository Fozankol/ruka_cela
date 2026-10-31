import { CITIES } from '../cities.js';

// Регионы нейтральные: география, а не государства. Правило из AGENTS.md.
// [id, название, широта, долгота, материк]
const RAW = [
  ['central_asia', 'Центральная Азия', 41, 66, 'asia'],
  ['caspian', 'Прикаспий', 40, 50, 'asia'],
  ['persia', 'Иранское нагорье', 33, 54, 'asia'],
  ['mesopotamia', 'Междуречье', 33, 44, 'asia'],
  ['arabia', 'Аравия', 24, 46, 'asia'],
  ['anatolia', 'Анатолия', 39, 33, 'asia'],
  ['levant', 'Левант', 32, 36, 'asia'],
  ['indus', 'Долина Инда', 29, 70, 'asia'],
  ['ganges', 'Долина Ганга', 26, 82, 'asia'],
  ['deccan', 'Декан', 16, 77, 'asia'],
  ['siberia', 'Сибирь', 57, 85, 'asia'],
  ['fareast', 'Дальний Восток', 50, 130, 'asia'],
  ['north_plain', 'Северная равнина', 38, 115, 'asia'],
  ['south_coast', 'Южное побережье', 25, 112, 'asia'],
  ['west_mountains', 'Западные горы', 31, 103, 'asia'],
  ['korea', 'Корейский полуостров', 37, 127, 'asia'],
  ['islands', 'Восточные острова', 36, 138, 'asia'],
  ['indochina', 'Индокитай', 15, 102, 'asia'],
  ['archipelago', 'Малайский архипелаг', -3, 112, 'asia'],
  ['philippine', 'Филиппинское море', 14, 121, 'asia'],
  ['volga', 'Поволжье', 55, 48, 'europe'],
  ['russian_plain', 'Русская равнина', 55, 37, 'europe'],
  ['black_sea', 'Причерноморье', 47, 33, 'europe'],
  ['baltic', 'Балтика', 57, 24, 'europe'],
  ['scandinavia', 'Скандинавия', 62, 15, 'europe'],
  ['central_europe', 'Центральная Европа', 50, 14, 'europe'],
  ['west_europe', 'Западная Европа', 48, 3, 'europe'],
  ['british', 'Британские острова', 53, -2, 'europe'],
  ['iberia', 'Иберия', 40, -4, 'europe'],
  ['balkans', 'Балканы и Апеннины', 43, 18, 'europe'],
  ['maghreb', 'Магриб', 32, -3, 'africa'],
  ['nile', 'Долина Нила', 27, 31, 'africa'],
  ['sahel', 'Сахель', 14, 8, 'africa'],
  ['guinea', 'Гвинейский залив', 7, 2, 'africa'],
  ['congo', 'Бассейн Конго', -3, 22, 'africa'],
  ['east_africa', 'Восточная Африка', 1, 37, 'africa'],
  ['south_africa', 'Южная Африка', -27, 26, 'africa'],
  ['great_lakes', 'Великие озёра', 44, -79, 'america'],
  ['east_coast', 'Восточное побережье', 39, -75, 'america'],
  ['gulf', 'Мексиканский залив', 30, -92, 'america'],
  ['pacific_coast', 'Тихоокеанский берег', 37, -120, 'america'],
  ['highlands', 'Мексиканское нагорье', 20, -100, 'america'],
  ['caribbean', 'Карибы', 12, -72, 'america'],
  ['amazon', 'Амазония', -5, -60, 'america'],
  ['andes', 'Анды', -14, -73, 'america'],
  ['atlantic_south', 'Бразильское побережье', -22, -46, 'america'],
  ['pampas', 'Пампа', -34, -60, 'america'],
  ['australia', 'Австралия', -31, 146, 'oceania'],
];

// Связи через моря и между материками. Внутри материка соседи считаются сами.
const LINKS = [
  ['central_asia', 'volga'],
  ['caspian', 'volga'],
  ['caspian', 'black_sea'],
  ['anatolia', 'balkans'],
  ['anatolia', 'black_sea'],
  ['levant', 'nile'],
  ['arabia', 'east_africa'],
  ['iberia', 'maghreb'],
  ['balkans', 'maghreb'],
  ['siberia', 'volga'],
  ['british', 'east_coast'],
  ['guinea', 'atlantic_south'],
  ['islands', 'pacific_coast'],
  ['philippine', 'highlands'],
  ['archipelago', 'australia'],
  ['deccan', 'east_africa'],
];

export const START_REGION = 'central_asia';
export const WORLD_POPULATION = 8100000000;

const toRad = Math.PI / 180;
function km(a, b) {
  const s1 = Math.sin(((b.lat - a.lat) * toRad) / 2);
  const s2 = Math.sin(((b.lon - a.lon) * toRad) / 2);
  const h = s1 * s1 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * s2 * s2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export function buildRegions() {
  const regions = RAW.map(([id, name, lat, lon, land]) => ({ id, name, lat, lon, land, cities: [], pop: 0, neighbors: new Set() }));
  const byId = Object.fromEntries(regions.map((r) => [r.id, r]));

  for (const c of CITIES) {
    let best = regions[0];
    let bestD = Infinity;
    for (const r of regions) {
      const d = km(c, r);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    best.cities.push(c);
    best.pop += c.population;
  }

  // Города дают лишь долю людей, поэтому население приводим к мировому.
  const floor = 20000000;
  const sum = regions.reduce((a, r) => a + r.pop + floor, 0);
  for (const r of regions) r.pop = Math.round(((r.pop + floor) / sum) * WORLD_POPULATION);

  const link = (a, b) => {
    a.neighbors.add(b.id);
    b.neighbors.add(a.id);
  };
  for (const r of regions) {
    const near = regions.filter((o) => o !== r && o.land === r.land).sort((a, b) => km(r, a) - km(r, b));
    for (const o of near.slice(0, 3)) link(r, o);
  }
  for (const [a, b] of LINKS) link(byId[a], byId[b]);

  // Расстояние в шагах от старта задаёт силу гарнизона.
  const hops = new Map([[START_REGION, 0]]);
  const queue = [START_REGION];
  while (queue.length) {
    const id = queue.shift();
    for (const n of byId[id].neighbors) {
      if (hops.has(n)) continue;
      hops.set(n, hops.get(id) + 1);
      queue.push(n);
    }
  }
  for (const r of regions) {
    r.neighbors = [...r.neighbors];
    r.hops = hops.get(r.id) ?? 99;
  }
  return regions;
}
