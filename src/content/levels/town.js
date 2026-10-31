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
    objective: 'Соседи ничего не знают. Кликай по вкусняшкам во дворах.',
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
    speedK: 2.4,
    valueK: 0.3,
    stompR: 0.8,
    camera: { dist: 49, pitch: 1.14, yaw: 1.57, soft: 1 },
    rules: { goal: 200, alertPer: 0.75, startWorkers: 3, workerCap: 10, workerCost: 10, workerStep: 5, decay: 0.5, treats: 11 },
  },
  village: {
    id: 'village',
    title: 'Село',
    intro: 'Прошёл месяц.',
    objective: 'Рой вышел за забор. Село спит, но у него есть ружья.',
    w: 92,
    d: 66,
    cell: 0.5,
    rows: 3,
    cols: 5,
    houseW: 8,
    houseD: 7,
    height: [2.4, 3.2],
    guards: 5,
    unitK: 6,
    speedK: 4.6,
    valueK: 0.2,
    stompR: 1.4,
    camera: { dist: 98, pitch: 1.14, yaw: 1.57, soft: 1 },
    rules: { goal: 400, alertPer: 0.5, startWorkers: 4, workerCap: 12, workerCost: 15, workerStep: 7, decay: 0.5, treats: 13 },
  },
  town: {
    id: 'town',
    title: 'Город',
    intro: 'Прошёл сезон.',
    objective: 'Город не спит. Огней больше, чем темноты.',
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
    camera: { dist: 162, pitch: 1.14, yaw: 1.57, soft: 1 },
    rules: { goal: 800, alertPer: 0.3, startWorkers: 5, workerCap: 14, workerCost: 25, workerStep: 10, decay: 0.5, treats: 15 },
  },
};

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
      zones.push({ wins, x: x + hw / 2, z: z + hd / 2, r: Math.round(Math.max(hw, hd) / cfg.cell) });
      doors.push({ x: x + hw / 2, z: z + hd + 1.2 });

      // Двор: забор, кусты-укрытия и места для вкусняшек.
      const yard = [
        [x - 1.6, z + hd * 0.5],
        [x + hw + 1.6, z + hd * 0.5],
        [x + hw * 0.5, z + hd + 2],
        [x + hw * 0.5, z - 1.8],
      ];
      for (const [px, pz] of yard) treatSpots.push({ x: px, z: pz });
      const sx = x + hw + 1.5;
      const sz = z - 1.4;
      shelters.push({ x: sx, z: sz, field: null });
      props.push({ s: 'sph', x: sx, y: 0.6, z: sz, sx: 1.2, sy: 0.9, sz: 1.2, c: 0x2c4a30, m: MAT.GRASS });
    }
  }

  // Фонари на перекрёстках: тёплые пятна на дороге.
  let n = 0;
  for (let r = 0; r <= cfg.rows; r++) {
    for (let c = 0; c <= cfg.cols; c++) {
      if ((r + c) % 2) continue;
      const x = Math.min(cfg.w - 1, c * stepX + 1.9);
      const z = Math.min(cfg.d - 1, r * stepZ + 1.9);
      box(x - 0.08, z - 0.08, 0.16, 0.16, 0, 4, 0x2a2a2e);
      lights.push({ id: `lamp${n++}`, x, z, y: 4, radius: Math.max(6, cfg.cell * 12), power: 0.8, warm: true, on: true, bulb: [x, 4.1, z], bulbR: 0.22 });
    }
  }

  const nest = zones[0];
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
    points: { nest: { x: nest.x, z: nest.z + cfg.houseD / 2 + 1.6 } },
    treatSpots,
    shelters,
    doors,
    unitK: cfg.unitK,
    speedK: cfg.speedK,
    valueK: cfg.valueK,
    stompR: cfg.stompR,
    rules: cfg.rules,
    humans: Array.from({ length: cfg.guards }, (_, i) => ({
      id: `guard${i}`,
      name: 'Сосед',
      x: doors[i % doors.length].x,
      z: doors[i % doors.length].z,
      height: 1.8 * Math.max(1, cfg.unitK * 0.55),
      tint: 0x4a5a70,
      pants: 0x33384a,
      outdoor: true,
    })),
  };
}
