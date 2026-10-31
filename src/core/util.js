export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const dist2 = (ax, az, bx, bz) => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function smooth(t) {
  const c = clamp(t);
  return c * c * (3 - 2 * c);
}

// Детерминированный генератор, чтобы симулятор баланса давал одинаковый результат.
export class RNG {
  constructor(seed = 1) {
    this.s = seed >>> 0;
  }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
}

export class Bus {
  constructor() {
    this.map = new Map();
  }
  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    const list = this.map.get(name);
    if (list) this.map.set(name, list.filter((f) => f !== fn));
  }
  emit(name, data) {
    const list = this.map.get(name);
    if (list) for (const fn of list) fn(data);
  }
}
