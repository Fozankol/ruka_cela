import { Grid, T } from '../../sim/grid.js';

export const ROOMS = { yard: 0, bedroom: 1, bath: 2, grandpa: 3, hall: 4, kitchen: 5, lena: 6 };

const YARD = 4;
const CELL = 0.125;
const HOUSE_W = 12.5;
const HOUSE_D = 9.8;

const COLORS = {
  floorWood: 0x7a5238,
  floorHall: 0x6a5a4a,
  floorTile: 0x5d6a70,
  floorKid: 0x6d5a78,
  wall: 0x9c9484,
  wood: 0x5c3a24,
  darkWood: 0x3a2518,
  linen: 0xb7b2a6,
  blanket: 0x5a6b82,
  blanketKid: 0xa86a70,
  metal: 0x8a9096,
  white: 0xc8c8c0,
  rug: 0x7c3a34,
};

// Все координаты комнат заданы относительно угла дома и сдвигаются на ширину двора.
const at = (v) => v + YARD;

export function buildHouse() {
  const worldW = HOUSE_W + YARD * 2;
  const worldD = HOUSE_D + YARD * 2;
  const g = new Grid(Math.ceil(worldW / CELL), Math.ceil(worldD / CELL), CELL);
  g.type.fill(T.GROUND);

  const rooms = [
    { id: ROOMS.bedroom, x: 0, z: 0, w: 5.5, d: 4.2, floor: COLORS.floorWood },
    { id: ROOMS.bath, x: 5.5, z: 0, w: 2.5, d: 4.2, floor: COLORS.floorTile },
    { id: ROOMS.grandpa, x: 8, z: 0, w: 4.5, d: 4.2, floor: COLORS.floorWood },
    { id: ROOMS.hall, x: 0, z: 4.2, w: 12.5, d: 1.6, floor: COLORS.floorHall },
    { id: ROOMS.kitchen, x: 0, z: 5.8, w: 6, d: 4, floor: COLORS.floorTile },
    { id: ROOMS.lena, x: 6, z: 5.8, w: 6.5, d: 4, floor: COLORS.floorKid },
  ];

  const t = 0.25;
  g.fillRect(at(-t), at(-t), HOUSE_W + t * 2, HOUSE_D + t * 2, T.WALL);
  for (const r of rooms) g.fillRect(at(r.x), at(r.z), r.w - CELL, r.d - CELL, T.FLOOR, r.id);

  const doors = [
    [1.6, 4.07, 1.0, 0.13],
    [6.3, 4.07, 0.9, 0.13],
    [9.6, 4.07, 1.0, 0.13],
    [2.4, 5.67, 1.1, 0.13],
    [8.2, 5.67, 1.0, 0.13],
  ];
  for (const [x, z, w, d] of doors) g.fillRect(at(x), at(z), w, d, T.DOOR);

  const props = [];
  const box = (x, z, w, d, y, h, c, emis = 0) => props.push({ s: 'box', x: at(x), z: at(z), w, d, y, h, c, emis });
  const lump = (x, y, z, sx, sy, sz, c) => props.push({ s: 'sph', x: at(x), y, z: at(z), sx, sy, sz, c });
  const cyl = (x, y, z, r, h, c) => props.push({ s: 'cyl', x: at(x), y, z: at(z), r, h, c });
  // Мебель с тенью под собой укрывает паука от света, глухая просто стоит на полу.
  const furn = (x, z, w, d, hollow = true) => {
    g.fillRect(at(x), at(z), w, d, T.FURN);
    if (!hollow) return;
    const x0 = g.cx(at(x));
    const z0 = g.cz(at(z));
    const x1 = g.cx(at(x + w - 1e-4));
    const z1 = g.cz(at(z + d - 1e-4));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) g.shade[g.idx(cx, cz)] = 1;
    props.push({ s: 'box', x: at(x), z: at(z), w, d, y: 0, h: 0.002, c: 0x0a0a0c });
  };
  const legs = (x, z, w, d, h, c) => {
    const s = 0.07;
    box(x, z, s, s, 0, h, c);
    box(x + w - s, z, s, s, 0, h, c);
    box(x, z + d - s, s, s, 0, h, c);
    box(x + w - s, z + d - s, s, s, 0, h, c);
  };

  for (const r of rooms) props.push({ s: 'floor', x: at(r.x), z: at(r.z), w: r.w, d: r.d, c: r.floor });

  // Спальня родителей: кровать с вытянутой к востоку рукой отца.
  furn(0.7, 0.15, 1.6, 2.1);
  box(0.7, 0.15, 1.6, 2.1, 0.22, 0.2, COLORS.wood);
  legs(0.7, 0.15, 1.6, 2.1, 0.22, COLORS.darkWood);
  box(0.65, 0.05, 1.7, 0.1, 0, 0.85, COLORS.darkWood);
  box(0.72, 0.17, 1.56, 2.06, 0.42, 0.12, COLORS.linen);
  lump(1.1, 0.6, 0.42, 0.28, 0.08, 0.17, COLORS.white);
  lump(1.9, 0.6, 0.42, 0.28, 0.08, 0.17, COLORS.white);
  lump(1.5, 0.56, 1.45, 0.76, 0.1, 0.8, COLORS.blanket);
  box(2.4, 0.12, 0.5, 0.45, 0, 0.5, COLORS.wood);
  box(0.12, 0.12, 0.5, 0.45, 0, 0.5, COLORS.wood);
  cyl(2.65, 0.5, 0.33, 0.06, 0.22, COLORS.metal);
  furn(3.3, 0.05, 2.0, 0.6, false);
  box(3.3, 0.05, 2.0, 0.6, 0.12, 1.0, COLORS.wood);
  box(3.32, 0.62, 1.96, 0.02, 0.2, 0.9, COLORS.darkWood);
  box(3.0, 2.4, 2.2, 1.45, 0, 0.012, COLORS.rug);

  // Тарелка с огрызком под кроватью, сюда слетаются мухи.
  cyl(1.75, 0, 1.75, 0.13, 0.015, COLORS.white);
  lump(1.76, 0.04, 1.74, 0.04, 0.05, 0.04, 0x8a5a2a);

  // Щель за шкафом: укрытие и первое гнездо.
  g.fillRect(at(5.1), at(0.05), 0.4, 0.3, T.CRACK);

  // Ванная.
  furn(5.65, 0.1, 0.8, 1.9);
  box(5.65, 0.1, 0.8, 1.9, 0, 0.55, COLORS.white);
  furn(7.1, 0.15, 0.7, 0.55);
  box(7.1, 0.15, 0.7, 0.55, 0, 0.8, COLORS.white);

  // Комната деда.
  furn(8.3, 0.2, 1.0, 2.0);
  box(8.3, 0.2, 1.0, 2.0, 0.2, 0.2, COLORS.darkWood);
  legs(8.3, 0.2, 1.0, 2.0, 0.2, COLORS.darkWood);
  box(8.32, 0.22, 0.96, 1.96, 0.4, 0.12, COLORS.linen);
  lump(8.8, 0.58, 0.46, 0.26, 0.08, 0.16, COLORS.white);
  furn(10.9, 0.15, 1.4, 0.5);
  box(10.9, 0.15, 1.4, 0.5, 0, 1.0, COLORS.wood);
  furn(10.9, 2.7, 0.9, 0.9);
  box(10.9, 2.7, 0.9, 0.9, 0.2, 0.25, 0x5a4a3a);
  box(10.9, 2.7, 0.9, 0.2, 0.2, 0.8, 0x5a4a3a);
  legs(10.9, 2.7, 0.9, 0.9, 0.2, COLORS.darkWood);

  // Коридор: щиток и кабель.
  furn(10.8, 4.25, 1.4, 0.3);
  box(10.8, 4.25, 1.4, 0.3, 0, 0.5, COLORS.wood);
  furn(0.2, 5.2, 1.2, 0.35);
  box(0.2, 5.2, 1.2, 0.35, 0, 0.35, COLORS.darkWood);
  box(5.0, 4.1, 0.5, 0.1, 0.55, 0.45, COLORS.metal);
  box(5.2, 4.18, 0.05, 0.05, 0, 0.55, 0x201818);

  // Кухня.
  furn(0.15, 6.0, 0.65, 3.6);
  box(0.15, 6.0, 0.65, 3.6, 0, 0.9, COLORS.white);
  box(0.12, 6.0, 0.7, 3.6, 0.9, 0.04, COLORS.darkWood);
  furn(5.2, 5.95, 0.65, 0.65);
  box(5.2, 5.95, 0.65, 0.65, 0, 1.15, COLORS.metal);
  furn(2.2, 7.1, 1.6, 1.0);
  box(2.2, 7.1, 1.6, 1.0, 0.7, 0.05, COLORS.wood);
  legs(2.2, 7.1, 1.6, 1.0, 0.7, COLORS.darkWood);
  cyl(5.5, 0, 9.3, 0.17, 0.42, 0x3a4a3a);

  // Комната Лены: кровать, стол с радиоприёмником, ящик с игрушками.
  furn(11.0, 7.3, 1.2, 2.2);
  box(11.0, 7.3, 1.2, 2.2, 0.15, 0.2, COLORS.wood);
  legs(11.0, 7.3, 1.2, 2.2, 0.15, COLORS.darkWood);
  box(11.02, 7.32, 1.16, 2.16, 0.35, 0.1, COLORS.linen);
  lump(11.6, 0.5, 7.55, 0.3, 0.07, 0.17, COLORS.white);
  lump(11.6, 0.5, 8.65, 0.56, 0.11, 0.78, COLORS.blanketKid);
  furn(6.3, 9.0, 1.7, 0.6);
  box(6.3, 9.0, 1.7, 0.6, 0.62, 0.05, COLORS.wood);
  legs(6.3, 9.0, 1.7, 0.6, 0.62, COLORS.darkWood);
  box(6.5, 9.15, 0.4, 0.2, 0.67, 0.2, 0x38444a);
  furn(8.8, 9.05, 1.0, 0.55);
  box(8.8, 9.05, 1.0, 0.55, 0, 0.42, 0x9a6a3a);
  box(8.0, 6.6, 2.0, 1.5, 0, 0.012, 0x4e6a70);

  // Двор: дорожка, забор и деревья.
  const windows = [
    { x: 0.8, z: -0.25, w: 1.4, d: 0.25, light: [1.5, 0.45, 2.0, 0.42] },
    { x: 9.6, z: -0.25, w: 1.2, d: 0.25, light: [10.2, 0.45, 2.0, 0.42] },
    { x: 1.8, z: 9.8, w: 1.4, d: 0.25, light: [2.5, 9.3, 2.2, 0.4] },
    { x: 9.4, z: 9.8, w: 1.4, d: 0.25, light: [10.1, 9.3, 2.2, 0.4], tag: 'lenaWindow' },
  ];

  const lights = [
    { id: 'bedroom', x: at(2.65), z: at(0.6), radius: 5.2, power: 1.15, warm: true, on: false, room: ROOMS.bedroom, bulb: [at(2.65), 0.76, at(0.33)] },
    { id: 'bath', x: at(6.7), z: at(2.1), radius: 3.6, power: 0.95, warm: true, on: false, room: ROOMS.bath },
    { id: 'grandpa', x: at(10.2), z: at(2.1), radius: 4.4, power: 0.9, warm: true, on: false, room: ROOMS.grandpa },
    { id: 'hall', x: at(6), z: at(5), radius: 6.5, power: 0.75, warm: true, on: false, room: ROOMS.hall },
    { id: 'kitchen', x: at(3), z: at(7.8), radius: 5.2, power: 0.9, warm: true, on: false, room: ROOMS.kitchen },
    { id: 'nightlight', x: at(10.6), z: at(9.2), radius: 3.1, power: 0.62, warm: true, on: true, room: ROOMS.lena, bulb: [at(10.6), 0.24, at(9.5)] },
  ];
  for (const w of windows) {
    const [lx, lz, r, p] = w.light;
    lights.push({ id: `moon${lights.length}`, x: at(lx), z: at(lz), radius: r, power: p * 0.28, warm: false, on: true, moon: true });
  }

  const fence = 2.8;
  const fw = HOUSE_W + fence * 2;
  const fd = HOUSE_D + fence * 2;
  for (let i = 0; i < 30; i++) {
    box(-fence + (i * fw) / 30, -fence, 0.09, 0.04, 0, 0.8, COLORS.darkWood);
    box(-fence + (i * fw) / 30, fd - fence, 0.09, 0.04, 0, 0.8, COLORS.darkWood);
  }
  for (let i = 0; i < 24; i++) {
    box(-fence, -fence + (i * fd) / 24, 0.04, 0.09, 0, 0.8, COLORS.darkWood);
    box(fw - fence, -fence + (i * fd) / 24, 0.04, 0.09, 0, 0.8, COLORS.darkWood);
  }
  const trees = [[-2, 12], [14.4, -2], [15, 7], [-2.2, 1.5], [3.5, 12.3], [13.8, 11.8]];
  for (const [x, z] of trees) {
    cyl(x, 0, z, 0.1, 1.5, COLORS.darkWood);
    lump(x, 2.1, z, 0.85, 1.1, 0.85, 0x22362a);
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
    wallHeight: 1.18,
    population: 4,
    points: {
      start: { x: at(3.7), z: at(2.5) },
      hand: { x: at(2.42), z: at(1.0) },
      crack: { x: at(5.3), z: at(0.2) },
      plate: { x: at(1.75), z: at(1.75) },
      wire: { x: at(5.22), z: at(4.34) },
      grandpa: { x: at(8.8), z: at(1.2) },
      lenaBed: { x: at(11.6), z: at(8.4) },
      lenaWindow: { x: at(10.1), z: at(9.6) },
      hallMid: { x: at(6), z: at(5) },
      outside: { x: at(10.1), z: at(11.2) },
    },
    humans: [
      { id: 'father', name: 'Отец', x: at(2.1), z: at(2.25), bedY: 0.56, height: 1.8, room: ROOMS.bedroom, danglingArm: true, tint: 0x4a5a70 },
      { id: 'mother', name: 'Мать', x: at(1.1), z: at(2.25), bedY: 0.56, height: 1.68, room: ROOMS.bedroom, tint: 0x6a5060 },
      { id: 'grandpa', name: 'Дед', x: at(8.8), z: at(2.1), bedY: 0.54, height: 1.7, room: ROOMS.grandpa, deepSleep: true, tint: 0x5a5a50 },
      { id: 'lena', name: 'Лена', x: at(11.6), z: at(9.35), bedY: 0.47, height: 1.32, room: ROOMS.lena, tint: 0x7a5060 },
    ],
  };
}
