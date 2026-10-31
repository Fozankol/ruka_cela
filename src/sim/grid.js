// Клеточная карта одного масштаба. На ней живут свет, паутина, обзор и поиск пути.
export const T = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, FURN: 4, CRACK: 5, GROUND: 6 };

const SPIDER_OK = [false, true, false, true, true, true, true];
const HUMAN_OK = [false, true, false, true, false, false, true];

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Grid {
  constructor(w, h, cell) {
    this.w = w;
    this.h = h;
    this.cell = cell;
    const n = w * h;
    this.n = n;
    this.type = new Uint8Array(n);
    this.room = new Uint8Array(n);
    this.shade = new Uint8Array(n);
    this.height = new Float32Array(n);
    this.lightW = new Float32Array(n);
    this.lightC = new Float32Array(n);
    this.staticW = new Float32Array(n);
    this.staticC = new Float32Array(n);
    this.web = new Float32Array(n);
    this.sense = new Float32Array(n);
    this.seen = new Uint8Array(n);
    this.queue = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.stampId = 0;
  }

  idx(x, z) {
    return z * this.w + x;
  }
  inb(x, z) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }
  cx(wx) {
    return Math.max(0, Math.min(this.w - 1, Math.floor(wx / this.cell)));
  }
  cz(wz) {
    return Math.max(0, Math.min(this.h - 1, Math.floor(wz / this.cell)));
  }
  at(wx, wz) {
    return this.idx(this.cx(wx), this.cz(wz));
  }
  wx(cx) {
    return (cx + 0.5) * this.cell;
  }
  wz(cz) {
    return (cz + 0.5) * this.cell;
  }
  fillRect(x, z, w, d, type, room = -1) {
    const x0 = this.cx(x);
    const z0 = this.cz(z);
    const x1 = this.cx(x + w - 1e-4);
    const z1 = this.cz(z + d - 1e-4);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const i = this.idx(cx, cz);
        if (type >= 0) this.type[i] = type;
        if (room >= 0) this.room[i] = room;
      }
    }
  }
  // Высота предметов на клетке: по ней камера понимает, что впереди препятствие.
  raise(x, z, w, d, top) {
    const x1 = this.cx(x + w - 1e-4);
    const z1 = this.cz(z + d - 1e-4);
    for (let cz = this.cz(z); cz <= z1; cz++) {
      for (let cx = this.cx(x); cx <= x1; cx++) {
        const i = this.idx(cx, cz);
        if (top > this.height[i]) this.height[i] = top;
      }
    }
  }
  spiderOk(i) {
    return SPIDER_OK[this.type[i]];
  }
  humanOk(i) {
    return HUMAN_OK[this.type[i]];
  }
  // Под мебелью темно: там свет не считается, хотя комната освещена.
  lit(i) {
    return (this.lightW[i] + this.lightC[i]) * (this.shade[i] ? 0.16 : 1);
  }
  litAt(wx, wz) {
    return this.lit(this.at(wx, wz));
  }

  // Поле расстояний от цели. Отрицательное значение значит «недостижимо».
  flow(wx, wz, walker = 'spider') {
    const ok = walker === 'spider' ? SPIDER_OK : HUMAN_OK;
    const { w, h, type, queue } = this;
    const field = new Int32Array(this.n).fill(-1);
    let start = this.nearestOk(wx, wz, ok);
    if (start < 0) return field;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    field[start] = 0;
    while (head < tail) {
      const i = queue[head++];
      const cx = i % w;
      const cz = (i - cx) / w;
      const d = field[i] + 1;
      for (let k = 0; k < 4; k++) {
        const nx = cx + N4[k][0];
        const nz = cz + N4[k][1];
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const ni = nz * w + nx;
        if (field[ni] >= 0 || !ok[type[ni]]) continue;
        field[ni] = d;
        queue[tail++] = ni;
      }
    }
    return field;
  }

  nearestOk(wx, wz, ok) {
    const cx = this.cx(wx);
    const cz = this.cz(wz);
    for (let r = 0; r < 24; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.inb(nx, nz)) continue;
          const i = this.idx(nx, nz);
          if (ok[this.type[i]]) return i;
        }
      }
    }
    return -1;
  }

  // То же для человека: случайно зашедшего на мебель возвращаем на пол.
  snapHuman(o) {
    const i = this.nearestOk(o.x, o.z, HUMAN_OK);
    if (i < 0) return;
    const cx = i % this.w;
    o.x = this.wx(cx);
    o.z = this.wz((i - cx) / this.w);
  }

  // Возвращает застрявшего в стене паука на ближайшую проходимую клетку.
  snapSpider(o) {
    const i = this.nearestOk(o.x, o.z, SPIDER_OK);
    if (i < 0) return;
    const cx = i % this.w;
    o.x = this.wx(cx);
    o.z = this.wz((i - cx) / this.w);
  }

  clearLine(x0, z0, x1, z1, ok) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (this.cell * 0.5));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (!ok[this.type[this.at(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)]]) return false;
    }
    return true;
  }

  // Самая дальняя точка пути, до которой можно дойти по прямой. Убирает рывки по клеткам.
  smoothStep(field, x, z, walker, out) {
    const ok = walker === 'spider' ? SPIDER_OK : HUMAN_OK;
    if (!this.nextStep(field, x, z, out)) return false;
    let px = out.x;
    let pz = out.z;
    const p = { x: 0, z: 0 };
    for (let i = 0; i < 9; i++) {
      if (!this.nextStep(field, px, pz, p) || (p.x === px && p.z === pz)) break;
      px = p.x;
      pz = p.z;
      if (!this.clearLine(x, z, px, pz, ok)) break;
      out.x = px;
      out.z = pz;
    }
    return true;
  }

  // Следующая точка пути по полю расстояний, без срезания углов через стены.
  nextStep(field, wx, wz, out) {
    const cx = this.cx(wx);
    const cz = this.cz(wz);
    const here = field[this.idx(cx, cz)];
    if (here < 0) return false;
    if (here === 0) {
      out.x = this.wx(cx);
      out.z = this.wz(cz);
      return true;
    }
    let best = here;
    let bx = cx;
    let bz = cz;
    for (let k = 0; k < 8; k++) {
      const dx = N8[k][0];
      const dz = N8[k][1];
      const nx = cx + dx;
      const nz = cz + dz;
      if (!this.inb(nx, nz)) continue;
      const v = field[this.idx(nx, nz)];
      if (v < 0 || v >= best) continue;
      if (dx && dz) {
        if (field[this.idx(cx + dx, cz)] < 0 || field[this.idx(cx, cz + dz)] < 0) continue;
      }
      best = v;
      bx = nx;
      bz = nz;
    }
    out.x = this.wx(bx);
    out.z = this.wz(bz);
    return true;
  }
}
