import { T } from './grid.js';

// Свет распространяется заливкой, поэтому не проходит сквозь стены.
function flood(g, s, W, C) {
  const target = s.warm ? W : C;
  const cellR = Math.ceil(s.radius / g.cell);
  const scx = g.cx(s.x);
  const scz = g.cz(s.z);
  const { queue, stamp, w, h, type, cell } = g;
  const id = ++g.stampId;
  const start = g.idx(scx, scz);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  stamp[start] = id;
  const hasCone = s.cone !== undefined && s.cone !== null;
  const dirX = hasCone ? Math.cos(s.dir) : 0;
  const dirZ = hasCone ? Math.sin(s.dir) : 0;
  const cosCone = hasCone ? Math.cos(s.cone) : 0;
  while (head < tail) {
    const i = queue[head++];
    const cx = i % w;
    const cz = (i - cx) / w;
    const dx = (cx - scx) * cell;
    const dz = (cz - scz) * cell;
    const d = Math.hypot(dx, dz);
    if (d <= s.radius) {
      let v = 1 - d / s.radius;
      v = v * v * s.power;
      if (hasCone && d > 0.12) {
        const c = (dx * dirX + dz * dirZ) / d;
        v *= c < cosCone ? Math.max(0, 1 - (cosCone - c) * 6) : 1;
      }
      target[i] += v;
    }
    const neigh = [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]];
    for (const [nx, nz] of neigh) {
      if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
      if (Math.abs(nx - scx) > cellR || Math.abs(nz - scz) > cellR) continue;
      const ni = nz * w + nx;
      if (stamp[ni] === id || type[ni] === T.WALL) continue;
      stamp[ni] = id;
      queue[tail++] = ni;
    }
  }
}

export function bakeStaticLight(g, lights) {
  g.staticW.fill(0);
  g.staticC.fill(0);
  for (const s of lights) if (s.on && !s.dynamic) flood(g, s, g.staticW, g.staticC);
}

export function composeLight(g, lights) {
  g.lightW.set(g.staticW);
  g.lightC.set(g.staticC);
  for (const s of lights) if (s.on && s.dynamic) flood(g, s, g.lightW, g.lightC);
}
