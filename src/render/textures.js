import * as THREE from 'three';

// Материалы создаются кодом при загрузке: чужих файлов нет, а всё бесшовно повторяется.
export const MAT = { PLAIN: 0, PLANK: 1, PLASTER: 2, FABRIC: 3, CARPET: 4, TILE: 5, WOOD: 6, GRASS: 7 };

// Размер повторения в метрах и блеск для каждого материала.
export const MAT_SCALE = [1.2, 1.7, 1.4, 0.4, 0.5, 1.2, 1.1, 2.2];
export const MAT_GLOSS = [0.25, 0.36, 0.05, 0.02, 0.01, 0.8, 0.26, 0.03];

const SIZE = 512;
const LAYERS = 8;

const hash = (x, y, s) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// Шум с заданным периодом, поэтому края текстуры совпадают.
function noise(u, v, px, py, s) {
  const x = u * px;
  const y = v * py;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const w = (a) => ((a % px) + px) % px;
  const h = (a) => ((a % py) + py) % py;
  const a = hash(w(ix), h(iy), s);
  const b = hash(w(ix + 1), h(iy), s);
  const c = hash(w(ix), h(iy + 1), s);
  const d = hash(w(ix + 1), h(iy + 1), s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(u, v, px, py, s, oct = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += noise(u, v, px, py, s + i) * amp;
    norm += amp;
    amp *= 0.5;
    px *= 2;
    py *= 2;
  }
  return sum / norm;
}

const painters = [
  // Обычная поверхность с лёгкими разводами.
  (u, v) => {
    const n = fbm(u, v, 6, 6, 1);
    const g = 0.46 + n * 0.1;
    return [g, g, g, n];
  },
  // Половицы.
  (u, v) => {
    const rows = 7;
    const row = Math.floor(v * rows);
    const fv = v * rows - row;
    const shift = hash(row, 1, 3);
    const cu = (u + shift) % 1;
    const col = Math.floor(cu * 3);
    const fu = cu * 3 - col;
    const id = row * 7 + col;
    const seam = Math.min(fv, 1 - fv) * 12;
    const joint = Math.min(fu, 1 - fu) * 26;
    const edge = Math.min(1, Math.min(seam, joint));
    const tint = 0.34 + hash(id, 5, 2) * 0.22;
    const grain = fbm(u + hash(id, 2, 9), v, 5, 60, 11, 4);
    const ring = Math.sin(grain * 22 + hash(id, 3, 4) * 6) * 0.5 + 0.5;
    const g = tint * (0.74 + ring * 0.2 + grain * 0.24) * (0.3 + edge * 0.7);
    return [g * 1.04, g * 0.96, g * 0.9, (0.45 + ring * 0.12) * edge];
  },
  // Штукатурка с мелкими неровностями и пятнами.
  (u, v) => {
    const big = fbm(u, v, 4, 4, 21, 3);
    const fine = fbm(u, v, 48, 48, 25, 2);
    const g = 0.42 + big * 0.14 + fine * 0.05;
    return [g, g * 0.98, g * 0.94, big * 0.4 + fine * 0.6];
  },
  // Тканое полотно.
  (u, v) => {
    const a = Math.sin(u * Math.PI * 2 * 128);
    const b = Math.sin(v * Math.PI * 2 * 128);
    const over = Math.sin(u * Math.PI * 2 * 64) * Math.sin(v * Math.PI * 2 * 64) > 0;
    const w = (over ? a : b) * 0.5 + 0.5;
    const n = fbm(u, v, 12, 12, 31, 3);
    const g = 0.44 + w * 0.025 + n * 0.09;
    return [g, g, g, w * 0.3 + n * 0.7];
  },
  // Ковёр: густой ворс.
  (u, v) => {
    const n = fbm(u, v, 96, 96, 41, 2);
    const blot = fbm(u, v, 6, 6, 45, 3);
    const g = 0.3 + n * 0.3 + blot * 0.08;
    return [g, g, g, n];
  },
  // Плитка со швами.
  (u, v) => {
    const k = 5;
    const fx = u * k - Math.floor(u * k);
    const fy = v * k - Math.floor(v * k);
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy) * 34;
    const flat = Math.min(1, edge);
    const id = Math.floor(u * k) * 11 + Math.floor(v * k);
    const n = fbm(u, v, 8, 8, 51, 3);
    const g = (0.46 + hash(id, 8, 2) * 0.09 + n * 0.05) * (0.42 + flat * 0.58);
    return [g * 0.98, g, g * 1.02, flat * (0.8 + n * 0.1)];
  },
  // Дерево мебели: длинные волокна.
  (u, v) => {
    const grain = fbm(u, v, 44, 3, 61, 4);
    const warp = fbm(u, v, 3, 2, 65, 2);
    const ring = Math.sin((u + warp * 0.2) * Math.PI * 2 * 22 + grain * 5) * 0.5 + 0.5;
    const g = 0.38 + ring * 0.05 + grain * 0.13;
    return [g * 1.06, g * 0.96, g * 0.86, ring * 0.5 + grain * 0.5];
  },
  // Трава и земля.
  (u, v) => {
    const blades = fbm(u, v, 64, 64, 71, 3);
    const patch = fbm(u, v, 5, 5, 75, 4);
    const g = 0.26 + blades * 0.34;
    return [g * (0.8 + patch * 0.5), g * (1.05 - patch * 0.2), g * 0.7, blades];
  },
];

export function buildMaterialAtlas() {
  const data = new Uint8Array(SIZE * SIZE * LAYERS * 4);
  let o = 0;
  for (let l = 0; l < LAYERS; l++) {
    const paint = painters[l];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const [r, g, b, h] = paint(x / SIZE, y / SIZE);
        data[o++] = Math.min(255, r * 255);
        data[o++] = Math.min(255, g * 255);
        data[o++] = Math.min(255, b * 255);
        data[o++] = Math.min(255, h * 255);
      }
    }
  }
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, LAYERS);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
