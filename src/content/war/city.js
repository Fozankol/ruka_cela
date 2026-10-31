// Город как маленькая карта войны: те же правила, но районы вместо регионов.
const DISTRICTS = [
  ['outskirts', 'Окраина', 16, 92, false],
  ['sleep', 'Спальный район', 20, 36, false],
  ['station', 'Вокзал', 52, 80, false],
  ['embank', 'Набережная', 56, 48, false],
  ['market', 'Рынок', 52, 16, false],
  ['hall', 'Мэрия', 94, 38, true],
  ['oldtown', 'Старый город', 96, 82, true],
  ['hospital', 'Больница', 120, 60, true],
  ['plant', 'Заводы', 132, 22, true],
  ['port', 'Порт', 136, 94, true],
];

const LINKS = [
  ['outskirts', 'sleep'],
  ['outskirts', 'station'],
  ['sleep', 'market'],
  ['sleep', 'embank'],
  ['station', 'embank'],
  ['market', 'embank'],
  ['embank', 'hall'],
  ['market', 'hall'],
  ['station', 'oldtown'],
  ['hall', 'oldtown'],
  ['hall', 'hospital'],
  ['hall', 'plant'],
  ['oldtown', 'hospital'],
  ['oldtown', 'port'],
  ['hospital', 'plant'],
  ['hospital', 'port'],
];

const START = 'outskirts';

function buildDistricts() {
  const list = DISTRICTS.map(([id, name, x, z, far]) => ({ id, name, x, z, far, lat: 0, lon: 0, pop: 1.4e8, neighbors: [], cities: [], hops: 0 }));
  const byId = Object.fromEntries(list.map((r) => [r.id, r]));
  for (const [a, b] of LINKS) {
    byId[a].neighbors.push(b);
    byId[b].neighbors.push(a);
  }
  const queue = [byId[START]];
  const seen = new Set([START]);
  while (queue.length) {
    const r = queue.shift();
    for (const n of r.neighbors) {
      if (seen.has(n)) continue;
      seen.add(n);
      byId[n].hops = r.hops + 1;
      queue.push(byId[n]);
    }
  }
  return list;
}

export const CITY_MAP = {
  build: buildDistricts,
  hop: (a, b) => 5 + Math.hypot(a.x - b.x, a.z - b.z) / 6,
  factions: [{ id: 'city', name: 'Городские власти', capital: 'hall', regions: 'all', color: [40, 60, 90], text: '' }],
  start: START,
  population: 1.4e6,
  peopleK: 0.001,
  peopleLabel: 'Людей в городе',
  nukes: false,
  dawn: false,
  politics: false,
  noSurrender: true,
  plans: true,
  quarantine: 0.4,
  end: 'cityEnd',
  legions: 3,
  biomass: 110,
  slots: 1,
  T: { garrisonBase: 30, garrisonHop: 0.3, nestCost: 90, blackoutTime: 30, legionBase: 5, foeProd: 0.9, supplyRange: 3, swarmGarrison: 12 },
};
