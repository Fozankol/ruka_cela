import { Grid, T } from '../../sim/grid.js';
import { MAT } from '../../render/textures.js';

export const ROOMS = { yard: 0, bedroom: 1, bath: 2, grandpa: 3, hall: 4, kitchen: 5, lena: 6 };

const YARD = 4;
const CELL = 0.125;
const HOUSE_W = 12.5;
const HOUSE_D = 9.8;

const C = {
  floorWood: 0x8a5e40,
  floorHall: 0x76604c,
  floorTile: 0x6f8088,
  floorTile2: 0x8a8a80,
  floorKid: 0x8a6a58,
  wood: 0x6c452c,
  darkWood: 0x3e2719,
  light: 0x9a7a54,
  linen: 0xb9b4a8,
  blanket: 0x4d6488,
  blanketOld: 0x6e6452,
  blanketKid: 0xb06a78,
  metal: 0x8a9096,
  white: 0xcfcfc6,
  rug: 0x8a3a30,
  rugTrim: 0xa98a58,
  shade: 0xc9b488,
};

const MAT_OF = {
  [C.wood]: MAT.WOOD,
  [C.darkWood]: MAT.WOOD,
  [C.light]: MAT.WOOD,
  [C.linen]: MAT.FABRIC,
  [C.blanket]: MAT.FABRIC,
  [C.blanketOld]: MAT.FABRIC,
  [C.blanketKid]: MAT.FABRIC,
  [C.rug]: MAT.CARPET,
  [C.rugTrim]: MAT.CARPET,
};

// Все координаты комнат заданы относительно угла дома и сдвигаются на ширину двора.
const at = (v) => v + YARD;

export function buildHouse() {
  const worldW = HOUSE_W + YARD * 2;
  const worldD = HOUSE_D + YARD * 2;
  const g = new Grid(Math.ceil(worldW / CELL), Math.ceil(worldD / CELL), CELL);
  g.type.fill(T.GROUND);

  const rooms = [
    { id: ROOMS.bedroom, x: 0, z: 0, w: 5.5, d: 4.2, floor: C.floorWood, m: MAT.PLANK },
    { id: ROOMS.bath, x: 5.5, z: 0, w: 2.5, d: 4.2, floor: C.floorTile, m: MAT.TILE },
    { id: ROOMS.grandpa, x: 8, z: 0, w: 4.5, d: 4.2, floor: C.floorWood, m: MAT.PLANK },
    { id: ROOMS.hall, x: 0, z: 4.2, w: 12.5, d: 1.6, floor: C.floorHall, m: MAT.PLANK },
    { id: ROOMS.kitchen, x: 0, z: 5.8, w: 6, d: 4, floor: C.floorTile2, m: MAT.TILE },
    { id: ROOMS.lena, x: 6, z: 5.8, w: 6.5, d: 4, floor: C.floorKid, m: MAT.PLANK },
  ];

  const t = 0.25;
  g.fillRect(at(-t), at(-t), HOUSE_W + t * 2, HOUSE_D + t * 2, T.WALL);
  // Отступ в две клетки оставляет стену между комнатами при любом размере.
  for (const r of rooms) g.fillRect(at(r.x), at(r.z), r.w - CELL, r.d - CELL * 2, T.FLOOR, r.id);

  const doors = [
    [1.6, 4.07, 1.0, 0.13],
    [6.3, 4.07, 0.9, 0.13],
    [9.6, 4.07, 1.0, 0.13],
    [2.4, 5.67, 1.1, 0.13],
    [8.2, 5.67, 1.0, 0.13],
  ];
  for (const [x, z, w, d] of doors) g.fillRect(at(x), at(z), w, d, T.DOOR);

  const props = [];
  const mof = (c) => MAT_OF[c] ?? MAT.PLAIN;
  const box = (x, z, w, d, y, h, c, emis = 0) => props.push({ s: 'box', x: at(x), z: at(z), w, d, y, h, c, emis, m: mof(c) });
  const soft = (x, z, w, d, y, h, c, r = 0.04) => props.push({ s: 'rbox', x: at(x), z: at(z), w, d, y, h, c, r, m: mof(c) });
  const lump = (x, y, z, sx, sy, sz, c) => props.push({ s: 'sph', x: at(x), y, z: at(z), sx, sy, sz, c, m: mof(c) });
  const cyl = (x, y, z, r, h, c, r1) => props.push({ s: 'cyl', x: at(x), y, z: at(z), r, r1, h, c, m: mof(c) });
  const quilt = (x, z, w, d, y, c, bodies) => props.push({ s: 'blanket', x: at(x), z: at(z), w, d, y, c, bodies: bodies.map((b) => ({ ...b, x: at(b.x), z0: at(b.z0), z1: at(b.z1) })) });
  const drape = (x, z, w, y, h, c) => props.push({ s: 'curtain', x: at(x), z: at(z), w, y, h, c });

  // Мебель с тенью под собой укрывает паука от света, глухая просто стоит на полу.
  const furn = (x, z, w, d, hollow = true) => {
    g.fillRect(at(x), at(z), w, d, T.FURN);
    if (!hollow) return;
    const x0 = g.cx(at(x));
    const z0 = g.cz(at(z));
    const x1 = g.cx(at(x + w - 1e-4));
    const z1 = g.cz(at(z + d - 1e-4));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) g.shade[g.idx(cx, cz)] = 1;
  };
  const legs = (x, z, w, d, h, c) => {
    const s = 0.07;
    box(x, z, s, s, 0, h, c);
    box(x + w - s, z, s, s, 0, h, c);
    box(x, z + d - s, s, s, 0, h, c);
    box(x + w - s, z + d - s, s, s, 0, h, c);
  };
  const chair = (x, z, c = C.wood) => {
    legs(x, z, 0.42, 0.42, 0.44, c);
    soft(x, z, 0.42, 0.42, 0.44, 0.04, c, 0.015);
    box(x, z + 0.38, 0.42, 0.04, 0.48, 0.42, c);
  };
  const drawers = (x, z, w, y, h, n) => {
    for (let i = 0; i < n; i++) {
      box(x + 0.03, z, w - 0.06, 0.006, y + (i * h) / n + 0.02, h / n - 0.04, C.light);
      lump(x + w / 2, y + (i + 0.5) * (h / n), z + 0.012, 0.012, 0.012, 0.012, C.metal);
    }
  };

  for (const r of rooms) props.push({ s: 'floor', x: at(r.x), z: at(r.z), w: r.w, d: r.d, c: r.floor, m: r.m });

  // Спальня родителей: кровать с вытянутой к востоку рукой отца.
  furn(0.7, 0.15, 1.6, 2.1);
  soft(0.7, 0.15, 1.6, 2.1, 0.2, 0.2, C.wood, 0.03);
  legs(0.74, 0.2, 1.52, 2.0, 0.22, C.darkWood);
  soft(0.62, 0.04, 1.76, 0.1, 0, 0.92, C.darkWood, 0.03);
  soft(0.72, 0.17, 1.56, 2.06, 0.4, 0.15, C.linen, 0.06);
  soft(0.8, 0.26, 0.64, 0.42, 0.54, 0.11, C.white, 0.05);
  soft(1.58, 0.26, 0.64, 0.42, 0.54, 0.11, C.white, 0.05);
  quilt(0.72, 1.2, 1.56, 1.02, 0.575, C.blanket, [
    { x: 1.1, z0: 1.1, z1: 2.25, h: 0.13 },
    { x: 2.08, z0: 1.1, z1: 2.25, h: 0.14 },
  ]);

  // Тумбочки, лампа, будильник и стакан воды.
  soft(2.4, 0.12, 0.5, 0.45, 0, 0.5, C.wood, 0.015);
  drawers(2.4, 0.57, 0.5, 0.04, 0.44, 2);
  soft(0.12, 0.12, 0.5, 0.45, 0, 0.5, C.wood, 0.015);
  drawers(0.12, 0.57, 0.5, 0.04, 0.44, 2);
  cyl(2.68, 0.5, 0.3, 0.05, 0.03, C.metal);
  cyl(2.68, 0.53, 0.3, 0.013, 0.14, C.metal);
  cyl(2.68, 0.66, 0.3, 0.075, 0.15, C.shade, 0.115);
  soft(2.46, 0.46, 0.15, 0.09, 0.5, 0.06, C.darkWood, 0.012);
  cyl(2.8, 0.5, 0.5, 0.032, 0.11, 0xa8c0cc);
  soft(0.2, 0.2, 0.2, 0.28, 0.5, 0.035, 0x6a3530, 0.006);

  // Шкаф, ковёр, стул с одеждой и тапки у кровати.
  furn(3.3, 0.05, 2.0, 0.6, false);
  soft(3.3, 0.05, 2.0, 0.6, 0.06, 1.08, C.wood, 0.015);
  box(4.29, 0.645, 0.02, 0.008, 0.1, 1.0, C.darkWood);
  box(3.33, 0.647, 0.94, 0.006, 0.12, 0.96, C.light);
  box(4.33, 0.647, 0.94, 0.006, 0.12, 0.96, C.light);
  cyl(4.24, 0.62, 0.66, 0.012, 0.09, C.metal);
  cyl(4.36, 0.62, 0.66, 0.012, 0.09, C.metal);
  soft(3.0, 2.4, 2.2, 1.45, 0, 0.012, C.rugTrim, 0.004);
  soft(3.1, 2.5, 2.0, 1.25, 0.002, 0.012, C.rug, 0.004);
  furn(0.25, 3.3, 0.44, 0.44);
  chair(0.25, 3.3);
  soft(0.26, 3.32, 0.4, 0.3, 0.48, 0.06, 0x51606e, 0.03);
  soft(2.46, 1.62, 0.12, 0.27, 0, 0.05, C.darkWood, 0.022);
  soft(2.62, 1.68, 0.12, 0.27, 0, 0.05, C.darkWood, 0.022);
  box(5.33, 1.6, 0.04, 0.72, 0.62, 0.46, C.darkWood);
  box(5.325, 1.66, 0.008, 0.6, 0.68, 0.34, 0x56685e);
  drape(0.44, 0.03, 0.4, 0.46, 0.68, 0x7a5a5a);
  drape(2.18, 0.03, 0.4, 0.46, 0.68, 0x7a5a5a);

  // Забытая на полу тарелка с огрызком: сюда слетаются мухи.
  cyl(3.75, 0, 1.75, 0.15, 0.015, C.white);
  lump(3.76, 0.05, 1.74, 0.05, 0.06, 0.05, 0x8a5a2a);

  // Щель за шкафом: укрытие и первое гнездо.
  g.fillRect(at(5.1), at(0.05), 0.4, 0.3, T.CRACK);

  // Ванная.
  furn(5.65, 0.1, 0.8, 1.9, false);
  soft(5.65, 0.1, 0.8, 1.9, 0, 0.56, C.white, 0.06);
  soft(5.73, 0.2, 0.64, 1.7, 0.47, 0.1, 0x8aa0a8, 0.05);
  furn(7.1, 0.15, 0.7, 0.55, false);
  soft(7.1, 0.15, 0.7, 0.55, 0, 0.76, C.white, 0.03);
  cyl(7.45, 0.76, 0.42, 0.16, 0.05, 0xdadad0);
  box(7.05, 0.04, 0.8, 0.03, 0.82, 0.3, 0x9fb7c4);
  furn(7.26, 3.1, 0.5, 0.72, false);
  soft(7.3, 3.14, 0.42, 0.62, 0, 0.42, C.white, 0.06);
  soft(7.33, 3.56, 0.36, 0.2, 0.3, 0.42, C.white, 0.03);

  // Комната деда: узкая кровать, кресло, полка с книгами.
  furn(8.3, 0.2, 1.0, 2.0);
  soft(8.3, 0.2, 1.0, 2.0, 0.18, 0.2, C.darkWood, 0.025);
  legs(8.34, 0.24, 0.92, 1.92, 0.2, C.darkWood);
  soft(8.25, 0.1, 1.1, 0.08, 0, 0.74, C.darkWood, 0.02);
  soft(8.32, 0.22, 0.96, 1.96, 0.38, 0.14, C.linen, 0.05);
  soft(8.42, 0.3, 0.76, 0.4, 0.5, 0.1, C.white, 0.05);
  quilt(8.32, 0.9, 0.96, 1.28, 0.53, C.blanketOld, [{ x: 8.8, z0: 0.92, z1: 2.15, h: 0.13 }]);
  furn(10.9, 0.15, 1.4, 0.5, false);
  soft(10.9, 0.15, 1.4, 0.5, 0, 1.08, C.wood, 0.012);
  for (let shelf = 0; shelf < 3; shelf++) {
    box(10.93, 0.645, 1.34, 0.01, 0.13 + shelf * 0.33, 0.27, C.darkWood);
    for (let i = 0; i < 13; i++) {
      const tint = [0x7a3a30, 0x3a5a6a, 0x8a7a4a, 0x4a6a4a, 0x6a4a6a][(i * 3 + shelf) % 5];
      box(10.96 + i * 0.1, 0.65, 0.085, 0.02, 0.14 + shelf * 0.33, 0.18 + ((i * 7 + shelf) % 4) * 0.022, tint);
    }
  }
  furn(10.9, 2.7, 0.9, 0.9);
  legs(10.95, 2.75, 0.8, 0.8, 0.14, C.darkWood);
  soft(10.9, 2.7, 0.9, 0.9, 0.14, 0.24, 0x5e4a3a, 0.06);
  soft(10.9, 3.42, 0.9, 0.18, 0.14, 0.72, 0x5e4a3a, 0.06);
  soft(10.9, 2.7, 0.14, 0.9, 0.3, 0.26, 0x5e4a3a, 0.05);
  soft(11.66, 2.7, 0.14, 0.9, 0.3, 0.26, 0x5e4a3a, 0.05);
  drape(9.22, 0.03, 0.4, 0.46, 0.68, 0x5e6a5a);
  drape(10.8, 0.03, 0.4, 0.46, 0.68, 0x5e6a5a);

  // Коридор: вешалка, обувница, щиток с кабелем.
  furn(10.8, 4.25, 1.4, 0.3, false);
  soft(10.8, 4.25, 1.4, 0.3, 0, 0.5, C.wood, 0.015);
  furn(0.2, 5.2, 1.2, 0.35, false);
  soft(0.2, 5.2, 1.2, 0.35, 0, 0.36, C.darkWood, 0.015);
  soft(0.34, 5.27, 0.11, 0.25, 0.36, 0.09, 0x2a2a30, 0.03);
  soft(0.5, 5.27, 0.11, 0.25, 0.36, 0.09, 0x2a2a30, 0.03);
  soft(4.95, 4.08, 0.56, 0.12, 0.55, 0.46, C.metal, 0.012);
  box(5.2, 4.18, 0.05, 0.05, 0, 0.56, 0x201818);

  // Кухня.
  furn(0.15, 6.0, 0.65, 3.6, false);
  soft(0.15, 6.0, 0.65, 3.6, 0, 0.88, C.wood, 0.012);
  soft(0.12, 5.98, 0.72, 3.64, 0.88, 0.04, 0x8a8a84, 0.01);
  soft(0.2, 7.2, 0.5, 0.55, 0.92, 0.06, C.metal, 0.012);
  cyl(0.45, 0.98, 6.5, 0.12, 0.17, 0x54403a);
  furn(5.2, 5.95, 0.65, 0.65, false);
  soft(5.2, 5.95, 0.65, 0.65, 0, 1.12, C.white, 0.05);
  furn(2.2, 7.1, 1.6, 1.0);
  soft(2.2, 7.1, 1.6, 1.0, 0.7, 0.05, C.wood, 0.012);
  legs(2.24, 7.14, 1.52, 0.92, 0.7, C.darkWood);
  cyl(2.6, 0.75, 7.6, 0.11, 0.012, C.white);
  cyl(3.4, 0.75, 7.6, 0.11, 0.012, C.white);
  cyl(3.0, 0.75, 7.55, 0.05, 0.18, 0x7a9aa8);
  furn(2.4, 6.56, 0.44, 0.44);
  chair(2.4, 6.56);
  furn(3.2, 6.56, 0.44, 0.44);
  chair(3.2, 6.56);
  furn(5.33, 9.13, 0.34, 0.34, false);
  cyl(5.5, 0, 9.3, 0.17, 0.42, 0x3a4a3a, 0.13);
  drape(1.46, 9.72, 0.4, 0.46, 0.68, 0xa08a5a);
  drape(3.14, 9.72, 0.4, 0.46, 0.68, 0xa08a5a);

  // Комната Лены: кровать с мишкой, стол с приёмником, рисунки на стене.
  furn(11.0, 7.3, 1.2, 2.2);
  soft(11.0, 7.3, 1.2, 2.2, 0.14, 0.2, C.light, 0.03);
  legs(11.04, 7.34, 1.12, 2.12, 0.15, C.darkWood);
  soft(11.02, 7.32, 1.16, 2.16, 0.33, 0.12, C.linen, 0.05);
  soft(11.2, 7.38, 0.8, 0.38, 0.44, 0.1, C.white, 0.05);
  quilt(11.02, 8.0, 1.16, 1.48, 0.46, C.blanketKid, [{ x: 11.6, z0: 8.0, z1: 9.3, h: 0.11 }]);
  lump(11.2, 0.56, 7.8, 0.07, 0.08, 0.065, 0x8a6236);
  lump(11.2, 0.67, 7.78, 0.05, 0.05, 0.05, 0x8a6236);
  lump(11.16, 0.71, 7.78, 0.018, 0.018, 0.012, 0x8a6236);
  lump(11.24, 0.71, 7.78, 0.018, 0.018, 0.012, 0x8a6236);
  furn(6.3, 9.0, 1.7, 0.6);
  soft(6.3, 9.0, 1.7, 0.6, 0.62, 0.05, C.light, 0.012);
  legs(6.34, 9.04, 1.62, 0.52, 0.62, C.wood);
  soft(6.5, 9.14, 0.42, 0.2, 0.67, 0.2, 0x38444a, 0.02);
  cyl(6.86, 0.87, 9.2, 0.004, 0.26, C.metal);
  cyl(6.58, 0.76, 9.135, 0.04, 0.008, 0x5a6a72);
  furn(8.8, 9.05, 1.0, 0.55, false);
  soft(8.8, 9.05, 1.0, 0.55, 0, 0.42, 0x9a6a3a, 0.02);
  furn(7.1, 8.5, 0.44, 0.44);
  chair(7.1, 8.5, C.light);
  cyl(9.0, 0, 7.35, 1.05, 0.012, 0x4e6a70);
  cyl(9.0, 0.002, 7.35, 0.82, 0.012, 0x6a8a84);
  box(6.13, 6.4, 0.012, 0.32, 0.72, 0.26, 0xd8c88a);
  box(6.13, 6.85, 0.012, 0.26, 0.76, 0.32, 0x9ac0b0);
  box(6.13, 7.3, 0.012, 0.34, 0.7, 0.26, 0xd09a9a);
  soft(10.5, 9.42, 0.2, 0.14, 0, 0.14, 0xbfae8a, 0.03);
  drape(9.06, 9.72, 0.4, 0.46, 0.68, 0xb08a98);
  drape(10.74, 9.72, 0.4, 0.46, 0.68, 0xb08a98);

  // Дверные косяки.
  for (const [x, z, w] of doors) {
    box(x - 0.05, z - 0.02, 0.06, 0.18, 0, 1.18, C.darkWood);
    box(x + w - 0.01, z - 0.02, 0.06, 0.18, 0, 1.18, C.darkWood);
  }

  const windows = [
    { x: 0.8, z: -0.25, w: 1.4, d: 0.25, light: [1.5, 0.45, 2.0, 0.42] },
    { x: 9.6, z: -0.25, w: 1.2, d: 0.25, light: [10.2, 0.45, 2.0, 0.42] },
    { x: 1.8, z: 9.8, w: 1.4, d: 0.25, light: [2.5, 9.3, 2.2, 0.4] },
    { x: 9.4, z: 9.8, w: 1.4, d: 0.25, light: [10.1, 9.3, 2.2, 0.4], tag: 'lenaWindow' },
  ];

  const lights = [
    { id: 'bedroom', x: at(2.68), z: at(0.42), radius: 5.2, power: 1.15, warm: true, on: false, room: ROOMS.bedroom, bulb: [at(2.68), 0.76, at(0.3)], bulbR: 0.1 },
    { id: 'bath', x: at(6.7), z: at(2.1), radius: 3.6, power: 0.95, warm: true, on: false, room: ROOMS.bath },
    { id: 'grandpa', x: at(10.2), z: at(2.1), radius: 4.4, power: 0.9, warm: true, on: false, room: ROOMS.grandpa },
    { id: 'hall', x: at(6), z: at(5), radius: 6.5, power: 0.75, warm: true, on: false, room: ROOMS.hall },
    { id: 'kitchen', x: at(3), z: at(7.8), radius: 5.2, power: 0.9, warm: true, on: false, room: ROOMS.kitchen },
    { id: 'nightlight', x: at(10.6), z: at(9.3), radius: 3.3, power: 0.66, warm: true, on: true, room: ROOMS.lena, bulb: [at(10.6), 0.2, at(9.49)], bulbR: 0.075 },
  ];
  // Лунное пятно у кровати: рука и паук отбрасывают тень ещё до того, как зажжётся лампа.
  lights.push({ id: 'moonbeam', x: at(2.95), z: at(1.2), y: 1.15, radius: 2.3, power: 0.55, warm: false, on: true });
  for (const w of windows) {
    const [lx, lz, r, p] = w.light;
    lights.push({ id: `moon${lights.length}`, x: at(lx), z: at(lz), radius: r, power: p * 0.28, warm: false, on: true, moon: true });
  }

  const fence = 2.8;
  const fw = HOUSE_W + fence * 2;
  const fd = HOUSE_D + fence * 2;
  for (let i = 0; i < 30; i++) {
    box(-fence + (i * fw) / 30, -fence, 0.09, 0.04, 0, 0.8, C.darkWood);
    box(-fence + (i * fw) / 30, fd - fence, 0.09, 0.04, 0, 0.8, C.darkWood);
  }
  for (let i = 0; i < 24; i++) {
    box(-fence, -fence + (i * fd) / 24, 0.04, 0.09, 0, 0.8, C.darkWood);
    box(fw - fence, -fence + (i * fd) / 24, 0.04, 0.09, 0, 0.8, C.darkWood);
  }
  const trees = [[-2, 12], [14.4, -2], [15, 7], [-2.2, 1.5], [3.5, 12.3], [13.8, 11.8]];
  for (const [x, z] of trees) {
    cyl(x, 0, z, 0.1, 1.5, C.darkWood);
    lump(x, 2.1, z, 0.85, 1.1, 0.85, 0x2a4432);
  }

  // Карта высот для камеры: стены, мебель, одеяла и деревья.
  const WALL_TOP = 1.2;
  for (let i = 0; i < g.n; i++) if (g.type[i] === T.WALL) g.height[i] = WALL_TOP;
  for (const p of props) {
    if ((p.s === 'box' || p.s === 'rbox') && p.h > 0.03 && p.w >= 0.12 && p.d >= 0.12) g.raise(p.x, p.z, p.w, p.d, p.y + p.h);
    else if (p.s === 'cyl' && p.r >= 0.1) g.raise(p.x - p.r, p.z - p.r, p.r * 2, p.r * 2, p.y + p.h);
    else if (p.s === 'sph' && p.sx >= 0.2) g.raise(p.x - p.sx, p.z - p.sz, p.sx * 2, p.sz * 2, p.y + p.sy);
    else if (p.s === 'blanket') g.raise(p.x - 0.2, p.z, p.w + 0.4, p.d + 0.2, p.y + 0.12);
  }

  return {
    id: 'house',
    title: 'Дом',
    grid: g,
    worldW,
    worldD,
    props,
    windows: windows.map((w) => ({ ...w, x: at(w.x), z: at(w.z) })),
    lights,
    clocks: [{ text: '02:14', x: at(2.535), y: 0.53, z: at(0.553) }],
    wallHeight: 1.18,
    population: 4,
    points: {
      start: { x: at(3.7), z: at(2.5) },
      hand: { x: at(2.88), z: at(0.92) },
      crack: { x: at(5.3), z: at(0.2) },
      plate: { x: at(3.75), z: at(1.75) },
      wire: { x: at(5.22), z: at(4.34) },
      grandpa: { x: at(8.8), z: at(1.2) },
      lenaBed: { x: at(11.6), z: at(8.4) },
      lenaWindow: { x: at(10.1), z: at(9.6) },
      hallMid: { x: at(6), z: at(5) },
      outside: { x: at(10.1), z: at(11.2) },
    },
    humans: [
      { id: 'father', name: 'Отец', x: at(2.1), z: at(2.25), bedY: 0.56, height: 1.8, room: ROOMS.bedroom, danglingArm: true, tint: 0x56688a, pants: 0x3e4a60, hair: 0x241b14 },
      { id: 'mother', name: 'Мать', x: at(1.1), z: at(2.25), bedY: 0.56, height: 1.68, room: ROOMS.bedroom, tint: 0x8a6078, pants: 0x644858, hair: 0x3a2518, longHair: true },
      { id: 'grandpa', name: 'Дед', x: at(8.8), z: at(2.1), bedY: 0.52, height: 1.7, room: ROOMS.grandpa, deepSleep: true, tint: 0xa8a498, pants: 0x4a4a42, hair: 0xa0a09c },
      { id: 'lena', name: 'Лена', x: at(11.6), z: at(8.85), bedY: 0.44, height: 1.32, room: ROOMS.lena, tint: 0xc9a0b4, pants: 0x9a7a90, hair: 0x4a2c1a, longHair: true, skin: 0xc49a80 },
    ],
  };
}
