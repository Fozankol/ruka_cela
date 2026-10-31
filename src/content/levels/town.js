import { Grid, T } from '../../sim/grid.js';
import { MAT } from '../../render/textures.js';

const WALLS = [0x8a7a68, 0x7a8078, 0x8c6f5e, 0x6f7a86, 0x93866a];
const ROOFS = [0x5a3430, 0x3e4a52, 0x4f3a2a, 0x53423a];

// Этапы отличаются только числами: размером карты, домами и правилами.
export const TOWN_LEVELS = {
  street: {
    id: 'street',
    title: 'Улица',
    intro: 'Прошла неделя.',
    objective: '',
    poles: true,
    // Порядок домов решает игрок: каждый взятый дом что-то меняет на улице.
    houses: [
      null,
      { name: 'Дом с кладовой', hint: 'Двойная еда во дворе', trait: 'pantry', people: 2, who: 'Хозяйка' },
      { name: 'Дом электрика', hint: 'Возьмёшь, и столбы никто не починит', trait: 'electric', people: 2, who: 'Жена электрика' },
      { name: 'Дом сторожа', hint: 'Возьмёшь, и собаки не будет', trait: 'dog', people: 2, who: 'Сторож' },
      { name: 'Дом участкового', hint: 'Пока он цел, слухи растут быстрее', trait: 'police', people: 2, who: 'Участковый' },
      { name: 'Большая семья', hint: 'Четверо: сеть должна быть плотной', trait: 'family', people: 4, who: 'Отец семейства' },
    ],
    w: 46,
    d: 32,
    cell: 0.25,
    rows: 2,
    cols: 3,
    houseW: 7,
    houseD: 6,
    height: [2.4, 2.8],
    guards: 3,
    unitK: 3.4,
    speedK: 1.7,
    valueK: 0.3,
    stompR: 0.8,
    camera: { dist: 49, pitch: 1.14, yaw: 1.57, soft: 1 },
    rules: { goal: 99999, alertPer: 0, startWorkers: 3, workerCap: 8, workerCost: 14, workerStep: 7, decay: 0, treats: 0, webRoutes: true, autoGather: true, brush: 0.5, silkArea: 0.1, silkStart: 50, silkMax: 80, silkRate: 2.4, widowCost: 40, widowStep: 25 },
  },
  village: {
    id: 'village',
    title: 'Село',
    intro: 'Прошёл месяц.',
    objective: 'Тяни нити к еде: рабочие сами заберут то, чего коснётся паутина. Гнездо ставится на нитях и сокращает путь. Дружина выйдет из церкви, факелы жгут паутину.',
    church: true,
    w: 92,
    d: 66,
    cell: 0.5,
    rows: 3,
    cols: 5,
    houseW: 8,
    houseD: 7,
    height: [2.4, 3.2],
    guards: 7,
    unitK: 6,
    speedK: 4.6,
    valueK: 0.2,
    stompR: 1.4,
    camera: { dist: 98, pitch: 1.14, yaw: 1.57, soft: 1 },
    rules: { goal: 99999, alertPer: 0.5, startWorkers: 4, workerCap: 12, workerCost: 15, workerStep: 7, decay: 0.5, treats: 13, webRoutes: true, autoGather: true, brush: 0.5, silkArea: 0.14, silkStart: 70, silkMax: 100, silkRate: 3, widowCost: 45, widowStep: 25 },
  },
  town: {
    id: 'town',
    title: 'Город',
    intro: 'Прошёл сезон.',
    objective: 'Кликни по району у красной линии: рой пойдёт в наступление. Армии покупай внизу.',
    river: true,
    nestZone: 18,
    w: 150,
    d: 110,
    cell: 0.75,
    rows: 4,
    cols: 6,
    houseW: 13,
    houseD: 11,
    height: [7, 22],
    guards: 7,
    unitK: 9.5,
    speedK: 7.5,
    valueK: 0.16,
    stompR: 2.2,
    camera: { dist: 196, pitch: 1.2, yaw: 1.57, soft: 1 },
    rules: { goal: 800, alertPer: 0.3, startWorkers: 5, workerCap: 14, workerCost: 25, workerStep: 10, decay: 0.5, treats: 15 },
  },
};

const CLOTHES = [0x7a4a3a, 0x3f5a78, 0x6a6a3a, 0x5a3f6a, 0x3a6a5a, 0x7a6a4a];

const person = (cfg, id, name, door, tint) => ({
  id,
  name,
  x: door.x,
  z: door.z,
  height: 1.8 * Math.max(1, cfg.unitK * 0.55),
  tint,
  pants: 0x33384a,
  outdoor: true,
});

function guards(cfg, doors) {
  return Array.from({ length: cfg.guards }, (_, i) => person(cfg, `guard${i}`, 'Сосед', doors[i % doors.length], 0x4a5a70));
}

// У каждого дома на Улице свои жильцы, а двое приезжают со стороны.
function streetPeople(cfg, doors) {
  const out = [];
  cfg.houses.forEach((def, i) => {
    if (!def) return;
    for (let k = 0; k < def.people; k++) out.push({ ...person(cfg, `h${i}p${k}`, def.who, doors[i], CLOTHES[(i * 2 + k) % CLOTHES.length]), house: i });
  });
  out.push({ ...person(cfg, 'electric', 'Электрик', doors[0], 0xc8701e), crew: 'electric' });
  out.push({ ...person(cfg, 'spray', 'Дезинсектор', doors[0], 0x3f7f4f), crew: 'spray' });
  return out;
}

export function buildTown(cfg) {
  const g = new Grid(Math.ceil(cfg.w / cfg.cell), Math.ceil(cfg.d / cfg.cell), cfg.cell);
  g.type.fill(T.GROUND);
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  const props = [];
  const lights = [];
  const box = (x, z, w, d, y, h, c, m = MAT.PLAIN, emis = 0) => props.push({ s: 'box', x, z, w, d, y, h, c, m, emis });

  const stepX = cfg.w / cfg.cols;
  const stepZ = cfg.d / cfg.rows;

  // Дороги между рядами и вдоль колонок.
  for (let r = 0; r <= cfg.rows; r++) box(0, r * stepZ - 1.5, cfg.w, 3, -0.02, 0.03, 0x34363a);
  for (let c = 0; c <= cfg.cols; c++) box(c * stepX - 1.5, 0, 3, cfg.d, -0.018, 0.03, 0x34363a);

  const zones = [];
  const treatSpots = [];
  const shelters = [];
  const doors = [];
  const poles = [];
  let church = null;
  let churchDoor = null;
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const hw = cfg.houseW;
      const hd = cfg.houseD;
      const x = c * stepX + (stepX - hw) / 2;
      const z = r * stepZ + (stepZ - hd) / 2;
      const h = cfg.height[0] + rnd() * (cfg.height[1] - cfg.height[0]);
      const wall = WALLS[Math.floor(rnd() * WALLS.length)];
      g.fillRect(x, z, hw, hd, T.WALL);
      g.raise(x, z, hw, hd, h + 1.5);
      box(x, z, hw, hd, 0, h, wall, MAT.PLASTER);
      props.push({ s: 'roof', x: x + hw / 2, z: z + hd / 2, w: hw * 1.1, d: hd * 1.1, y: h, h: Math.min(hw * 0.32, 3), c: ROOFS[Math.floor(rnd() * ROOFS.length)] });

      const wins = [];
      const floors = Math.max(1, Math.floor(h / 3));
      const per = Math.max(2, Math.floor(hw / 2.4));
      for (let f = 0; f < floors; f++) {
        for (let i = 0; i < per; i++) {
          if (rnd() < 0.35) continue;
          wins.push({ x: x + ((i + 0.5) / per) * hw - 0.45, y: 0.9 + f * (h / floors), z: z + hd + 0.02, w: 0.9, h: 1.1, d: 0.05 });
        }
      }
      const zone = { wins, x: x + hw / 2, z: z + hd / 2, r: Math.round(Math.max(hw, hd) / cfg.cell) };
      zones.push(zone);
      doors.push({ x: x + hw / 2, z: z + hd + 1.2 });

      // Двор: забор, кусты-укрытия и места для вкусняшек.
      const yard = [
        [x - 1.6, z + hd * 0.5],
        [x + hw + 1.6, z + hd * 0.5],
        [x + hw * 0.5, z + hd + 2],
        [x + hw * 0.5, z - 1.8],
      ];
      for (const [px, pz] of yard) treatSpots.push({ x: px, z: pz });
      zone.yard = yard.map(([px, pz]) => ({ x: px, z: pz }));

      // Столб освещает двор: пока он цел, еда во дворе заперта.
      if (cfg.poles && zones.length > 1) {
        const px = x + hw - 0.6;
        const pz = z + hd + 1.9;
        const id = `pole${poles.length}`;
        box(px - 0.14, pz - 0.14, 0.28, 0.28, 0, 5, 0x2f2a26, MAT.WOOD);
        box(px - 0.9, pz - 0.07, 1.8, 0.14, 4.6, 0.14, 0x2f2a26, MAT.WOOD);
        lights.push({ id, x: px, z: pz, y: 5, radius: 11, power: 1.7, warm: true, on: true, bulb: [px, 5.15, pz], bulbR: 0.3 });
        poles.push({ id, x: px, z: pz, zone: zones.length - 1 });
      }

      // Церковь в дальнем углу: на ней набат.
      if (cfg.church && r === cfg.rows - 1 && c === cfg.cols - 1) {
        const tx = x + hw / 2 - 1.5;
        const tz = z + hd / 2 - 1.5;
        box(tx, tz, 3, 3, h, 8, 0x8d8579, MAT.PLASTER);
        props.push({ s: 'roof', x: tx + 1.5, z: tz + 1.5, w: 4.4, d: 4.4, y: h + 8, h: 4.6, c: 0x4a2f2a });
        box(tx + 1.1, tz + 3.02, 0.8, 0.02, h + 5.6, 1.2, 0xffc060, MAT.PLAIN, 1.6);
        church = { x: x + hw / 2, z: z + hd + 2.6 };
        churchDoor = { x: x + hw / 2, z: z + hd + 1.2 };
      }
      const sx = x + hw + 1.5;
      const sz = z - 1.4;
      shelters.push({ x: sx, z: sz, field: null });
      props.push({ s: 'sph', x: sx, y: 0.6, z: sz, sx: 1.2, sy: 0.9, sz: 1.2, c: 0x2c4a30, m: MAT.GRASS });
    }
  }

  // Река делит город на два берега, через неё идут только мосты.
  if (cfg.river) {
    const rx = (cfg.cols / 2) * stepX;
    box(rx - 5, 0, 10, cfg.d, -0.012, 0.03, 0x18384e, MAT.PLAIN, 0.05);
    for (const r of [1, 3]) box(rx - 6, r * stepZ - 2, 12, 4, 0.02, 0.1, 0x8a8d92, MAT.PLAIN, 0.1);
  }

  // Фонари на перекрёстках: тёплые пятна на дороге.
  let n = 0;
  for (let r = 0; r <= cfg.rows; r++) {
    for (let c = 0; c <= cfg.cols; c++) {
      // Луна делает тёмные дворы видимыми, но холодными. На Улице другого света нет.
      lights.push({ id: `moon${n++}`, x: Math.min(cfg.w - 1, c * stepX + 0.5), z: Math.min(cfg.d - 1, r * stepZ + 0.5), radius: stepX * 1.1, power: 0.5, warm: false, on: true, moon: true });
      if ((r + c) % 2 || cfg.poles) continue;
      const x = Math.min(cfg.w - 1, c * stepX + 1.9);
      const z = Math.min(cfg.d - 1, r * stepZ + 1.9);
      box(x - 0.08, z - 0.08, 0.16, 0.16, 0, 4, 0x2a2a2e);
      lights.push({ id: `lamp${n++}`, x, z, y: 4, radius: Math.max(6, cfg.cell * 12), power: 0.8, warm: true, on: true, bulb: [x, 4.1, z], bulbR: 0.22 });
    }
  }

  const nest = zones[cfg.nestZone ?? 0];
  return {
    id: cfg.id,
    title: cfg.title,
    cfg,
    grid: g,
    worldW: cfg.w,
    worldD: cfg.d,
    props,
    windows: [],
    lights,
    zones,
    clocks: [],
    wallHeight: 0.02,
    population: zones.length * 4,
    points: { nest: { x: nest.x, z: nest.z + cfg.houseD / 2 + 1.6 }, church, churchDoor, road: { x: cfg.w - 2, z: stepZ } },
    poles,
    dogRoad: { z: stepZ + 1.6, x0: 5, x1: cfg.w - 5 },
    treatSpots,
    shelters,
    doors,
    unitK: cfg.unitK,
    speedK: cfg.speedK,
    valueK: cfg.valueK,
    stompR: cfg.stompR,
    rules: cfg.rules,
    humans: cfg.poles ? streetPeople(cfg, doors) : guards(cfg, doors),
  };
}
