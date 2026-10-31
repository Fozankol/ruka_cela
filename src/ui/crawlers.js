// Заражение интерфейса: прозрачный canvas поверх страницы, пауки бегают по экрану,
// в углах растёт паутина. Не перехватывает клики (pointer-events: none).
// Использование: const c = new Crawlers(); c.setInfection(0.5); каждый кадр c.update(dt); c.destroy().

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Детерминированный генератор, чтобы паутина не «прыгала» при перерисовке.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Углы лап относительно направления тела (рад) и длина сегментов в долях размера.
const LEG_ANGLES = [0.55, 1.05, 1.75, 2.35];

class Spider {
  constructor(w, h, mouse) {
    const r = Math.random;
    this.size = 7 + r() * 9;
    // Старт за краем экрана, цель на противоположном краю. Иногда путь проходит через курсор.
    const side = Math.floor(r() * 4);
    const pt = (s) => s === 0 ? [r() * w, -40] : s === 1 ? [w + 40, r() * h] : s === 2 ? [r() * w, h + 40] : [-40, r() * h];
    [this.x, this.y] = pt(side);
    this.waypoints = [];
    if (mouse.seen && r() < 0.35) this.waypoints.push([mouse.x, mouse.y]);
    else if (r() < 0.5) this.waypoints.push([w * (0.2 + 0.6 * r()), h * (0.2 + 0.6 * r())]);
    this.waypoints.push(pt((side + 2) % 4));
    this.speed = 90 + r() * 120; // px/с
    this.heading = Math.atan2(this.waypoints[0][1] - this.y, this.waypoints[0][0] - this.x);
    this.pause = 0;
    this.pauseCooldown = 0.6 + r() * 1.5;
    this.dead = false;

    // Лапы: 8 штук, две чередующиеся группы (тетраподная походка).
    this.legs = [];
    for (let side2 = -1; side2 <= 1; side2 += 2) {
      LEG_ANGLES.forEach((a, i) => {
        const leg = { a: a * side2, side: side2, group: (i + (side2 > 0 ? 0 : 1)) % 2, fx: 0, fy: 0, sx: 0, sy: 0, t: 1 };
        const [rx, ry] = this.rest(leg);
        leg.fx = leg.sx = rx; leg.fy = leg.sy = ry;
        this.legs.push(leg);
      });
    }
  }

  rest(leg) {
    const reach = this.size * 2.3;
    const a = this.heading + leg.a;
    // Ступня чуть впереди по ходу, чтобы шаг был естественным.
    return [this.x + Math.cos(a) * reach + Math.cos(this.heading) * this.size * 0.5,
            this.y + Math.sin(a) * reach + Math.sin(this.heading) * this.size * 0.5];
  }

  update(dt, w, h) {
    const wp = this.waypoints[0];
    let moving = false;
    if (this.pause > 0) this.pause -= dt;
    else if (wp) {
      const dx = wp[0] - this.x, dy = wp[1] - this.y, d = Math.hypot(dx, dy);
      const target = Math.atan2(dy, dx);
      let da = ((target - this.heading + Math.PI * 3) % TAU) - Math.PI;
      this.heading += clamp(da, -6 * dt, 6 * dt);
      const step = this.speed * dt * (0.4 + 0.6 * Math.max(0, Math.cos(da)));
      this.x += Math.cos(this.heading) * step;
      this.y += Math.sin(this.heading) * step;
      moving = true;
      if (d < 14) this.waypoints.shift();
      // Пауки замирают на полпути: это страшнее, чем ровный бег.
      this.pauseCooldown -= dt;
      if (this.pauseCooldown <= 0) { this.pause = 0.2 + Math.random() * 0.7; this.pauseCooldown = 0.8 + Math.random() * 2; }
    }
    // Последняя точка пути лежит за краем экрана, так что паук исчезает уже невидимым.
    if (!this.waypoints.length) this.dead = true;

    const stepDur = clamp(18 / this.speed, 0.06, 0.16);
    const stepping = [0, 0];
    for (const l of this.legs) if (l.t < 1) stepping[l.group]++;
    for (const l of this.legs) {
      if (l.t < 1) {
        l.t = Math.min(1, l.t + dt / stepDur);
        const [rx, ry] = this.rest(l);
        const e = l.t * l.t * (3 - 2 * l.t);
        l.fx = l.sx + (rx - l.sx) * e;
        l.fy = l.sy + (ry - l.sy) * e;
      } else if (moving || this.pause <= 0) {
        const [rx, ry] = this.rest(l);
        if (Math.hypot(rx - l.fx, ry - l.fy) > this.size * 1.1 && stepping[1 - l.group] === 0) {
          l.t = 0; l.sx = l.fx; l.sy = l.fy; stepping[l.group]++;
        }
      }
    }
  }

  draw(ctx) {
    const s = this.size, hx = Math.cos(this.heading), hy = Math.sin(this.heading);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(70,58,54,0.95)';
    ctx.lineWidth = Math.max(1, s * 0.16);
    const seg = s * 1.55;
    for (const l of this.legs) {
      const bx = this.x + hx * s * 0.25, by = this.y + hy * s * 0.25;
      const dx = l.fx - bx, dy = l.fy - by, d = Math.hypot(dx, dy) || 1;
      // Колено: двухзвенная ИК, сгиб наружу от тела.
      const half = Math.min(d / 2, seg);
      const lift = Math.sqrt(Math.max(0, seg * seg - half * half)) + (l.t < 1 ? Math.sin(l.t * Math.PI) * s * 0.4 : 0);
      const nx = -dy / d * l.side, ny = dx / d * l.side;
      const kx = bx + dx / 2 + nx * lift * 0.6 * -1, ky = by + dy / 2 + ny * lift * 0.6 * -1;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(kx, ky); ctx.lineTo(l.fx, l.fy); ctx.stroke();
    }
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading);
    ctx.fillStyle = '#070505';
    // Светлый контур, чтобы чёрный паук читался и на тёмном стекле HUD.
    ctx.strokeStyle = 'rgba(210,185,165,0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(-s * 0.9, 0, s * 1.05, s * 0.8, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(s * 0.45, 0, s * 0.6, s * 0.5, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(190,30,30,0.85)';
    ctx.beginPath(); ctx.arc(s * 0.85, -s * 0.16, s * 0.08, 0, TAU); ctx.arc(s * 0.85, s * 0.16, s * 0.08, 0, TAU); ctx.fill();
    ctx.restore();
  }
}

export class Crawlers {
  constructor({ parent = document.body, zIndex = 9000 } = {}) {
    this.infection = 0;
    this.spiders = [];
    this.spawnIn = 2;
    this.mouse = { x: 0, y: 0, seen: false };
    this.webKey = -1;

    const cv = document.createElement('canvas');
    cv.setAttribute('aria-hidden', 'true');
    Object.assign(cv.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: String(zIndex) });
    parent.appendChild(cv);
    this.canvas = cv;
    this.ctx = cv.getContext('2d');
    this.webCanvas = document.createElement('canvas');

    this.onMove = (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.seen = true; };
    this.onResize = () => this.resize();
    addEventListener('pointermove', this.onMove, { passive: true });
    addEventListener('resize', this.onResize);
    this.resize();
  }

  resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    for (const c of [this.canvas, this.webCanvas]) { c.width = Math.round(this.w * this.dpr); c.height = Math.round(this.h * this.dpr); }
    this.webKey = -1;
  }

  setInfection(v) {
    this.infection = clamp(Number(v) || 0, 0, 1);
    if (this.infection === 0) this.spiders.length = 0;
  }

  /** Запустить паука немедленно (для тестов и сюжетных моментов). */
  spawn() { this.spiders.push(new Spider(this.w, this.h, this.mouse)); }

  update(dt) {
    dt = Math.min(dt || 0, 0.1);
    const inf = this.infection;
    if (inf > 0) {
      this.spawnIn -= dt;
      const max = 1 + Math.floor(inf * 3);
      if (this.spawnIn <= 0) {
        if (this.spiders.length < max) this.spawn();
        // Редко: при 0.1 раз в ~20 с, при 1 раз в ~4 с.
        this.spawnIn = (4 + 18 * (1 - inf)) * (0.6 + Math.random() * 0.8);
      }
    }
    for (const s of this.spiders) s.update(dt, this.w, this.h);
    this.spiders = this.spiders.filter((s) => !s.dead);

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (inf === 0 && !this.spiders.length) return;

    const key = Math.round(inf * 200);
    if (key !== this.webKey) { this.webKey = key; this.drawWebs(); }
    ctx.drawImage(this.webCanvas, 0, 0);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const s of this.spiders) s.draw(ctx);
  }

  drawWebs() {
    const ctx = this.webCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.webCanvas.width, this.webCanvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const inf = this.infection, w = this.w, h = this.h;

    // Тёмная виньетка по краям при сильном заражении; центр остаётся чистым.
    if (inf > 0.4) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${0.45 * smooth(0.4, 1, inf)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }

    const maxR = Math.min(w, h) * 0.3;
    const corners = [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]];
    // Углы зарастают по очереди.
    const delays = [0, 0.15, 0.35, 0.55];
    corners.forEach(([cx, cy, sx, sy], ci) => {
      const g = smooth(delays[ci], delays[ci] + 0.45, inf);
      if (g <= 0) return;
      const R = maxR * (0.25 + 0.75 * g);
      const rand = rng(1234 + ci * 977);
      const spokes = 7 + Math.floor(rand() * 4);
      const ang = [];
      for (let i = 0; i < spokes; i++) ang.push((i + 0.15 + rand() * 0.7) / spokes * (Math.PI / 2));
      const len = ang.map(() => R * (0.75 + rand() * 0.25));
      const p = (a, r) => [cx + sx * Math.cos(a) * r, cy + sy * Math.sin(a) * r];

      ctx.lineWidth = 0.8;
      ctx.strokeStyle = `rgba(225,225,215,${0.18 + 0.22 * g})`;
      ctx.beginPath();
      ang.forEach((a, i) => { const [x, y] = p(a, len[i]); ctx.moveTo(cx, cy); ctx.lineTo(x, y); });
      ctx.stroke();

      // Спираль: провисающие дуги между соседними спицами.
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = `rgba(225,225,215,${0.12 + 0.2 * g})`;
      const rings = Math.floor(4 + 9 * g);
      ctx.beginPath();
      for (let k = 1; k <= rings; k++) {
        const f = k / (rings + 1);
        for (let i = 0; i < spokes - 1; i++) {
          const r1 = len[i] * f * (0.95 + rand() * 0.1), r2 = len[i + 1] * f * (0.95 + rand() * 0.1);
          const [x1, y1] = p(ang[i], r1), [x2, y2] = p(ang[i + 1], r2);
          const [mx, my] = p((ang[i] + ang[i + 1]) / 2, (r1 + r2) / 2 * 0.9);
          ctx.moveTo(x1, y1); ctx.quadraticCurveTo(mx, my, x2, y2);
        }
      }
      ctx.stroke();

      // Обрывки нитей, тянущиеся дальше по краю экрана.
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = `rgba(225,225,215,${0.1 * g})`;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const [x, y] = p(ang[Math.floor(rand() * spokes)], R * (0.4 + rand() * 0.5));
        const [x2, y2] = p(rand() * Math.PI / 2, R * (1.2 + rand() * 0.6 * g));
        ctx.moveTo(x, y); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    });
  }

  destroy() {
    removeEventListener('pointermove', this.onMove);
    removeEventListener('resize', this.onResize);
    this.canvas.remove();
    this.spiders.length = 0;
  }
}
