import { Bus, RNG, clamp, dist } from '../core/util.js';
import { bakeStaticLight, composeLight } from './light.js';
import { isDown, makeHuman, tickHuman } from './humans.js';

export const SPIDERS = {
  hero: { name: 'Каракурт', speed: 1.25, scale: 0.17 },
  ling: { name: 'Паучок', speed: 0.85, scale: 0.075, cost: 6, key: '1', desc: 'Ловит и кусает' },
  weaver: { name: 'Ткач', speed: 0.6, scale: 0.09, cost: 14, key: '2', desc: 'Плетёт паутину' },
};

const STEP = { x: 0, z: 0 };

export class World {
  constructor(level, seed = 7) {
    this.level = level;
    this.grid = level.grid;
    this.rng = new RNG(seed);
    this.bus = new Bus();
    this.t = 0;
    this.res = { silk: 0, soki: 0 };
    this.stats = { bites: 0, clicks: 0, started: 0 };
    this.alarm = 0;
    this.biteRate = 0.028;
    this.spiders = [];
    this.flies = [];
    this.nests = [];
    this.cocoons = [];
    this.webList = [];
    this.lights = level.lights;
    this.humans = level.humans.map(makeHuman);
    this.mark = null;
    this.markField = null;
    this.markDirty = false;
    this.markCool = 0;
    this.nextId = 1;
    this.script = null;
    this.flags = { resources: false, swarmBar: false, evolution: false };
    this.goal = null;
    this.wire = null;
    this.slippers = [];
    this.senseT = 0;
    this.lightT = 0;
    this.lightDirty = true;
    this.hero = null;
    for (const r of [1]) this.revealRoom(r);
    this.bakeLight();
  }

  // Сообщения интерфейсу и отрисовке.
  say(text, opts = {}) {
    this.bus.emit('say', { text, ...opts });
  }
  setObjective(text) {
    this.bus.emit('objective', text);
  }
  setBeacon(point) {
    this.goal = point;
  }

  bakeLight() {
    bakeStaticLight(this.grid, this.lights);
    composeLight(this.grid, this.lights);
    this.lightDirty = false;
  }

  setLamp(id, on) {
    const l = this.lights.find((s) => s.id === id);
    if (l && l.on !== on) {
      l.on = on;
      this.lightDirty = true;
      this.bus.emit('lamp', { id, on, light: l });
    }
  }

  blackout() {
    for (const l of this.lights) {
      if (!l.moon && !l.dynamic && l.on) {
        l.on = false;
        this.bus.emit('lamp', { id: l.id, on: false, light: l });
      }
    }
    this.powerCut = true;
    this.bus.emit('blackout');
    this.lightDirty = true;
  }

  // Открывает комнату вместе со стенами вокруг неё.
  revealRoom(room) {
    const g = this.grid;
    const R = 3;
    for (let cz = 0; cz < g.h; cz++) {
      for (let cx = 0; cx < g.w; cx++) {
        if (g.room[g.idx(cx, cz)] !== room) continue;
        for (let dz = -R; dz <= R; dz++) {
          for (let dx = -R; dx <= R; dx++) {
            if (g.inb(cx + dx, cz + dz)) g.seen[g.idx(cx + dx, cz + dz)] = 1;
          }
        }
      }
    }
  }

  spawn(kind, x, z) {
    const s = {
      id: this.nextId++,
      kind,
      x,
      z,
      px: x,
      pz: z,
      y: 0,
      dir: this.rng.range(-3.14, 3.14),
      ox: this.rng.range(-1, 1),
      oz: this.rng.range(-1, 1),
      job: null,
      on: null,
      climb: this.rng.next(),
      ang: this.rng.range(0, 6.28),
      thinkT: this.rng.range(0, 0.3),
      wanderT: 0,
      moving: false,
      hidden: false,
      moveSeed: this.rng.next(),
    };
    if (!this.grid.spiderOk(this.grid.at(x, z))) {
      this.grid.snapSpider(s);
      s.px = s.x;
      s.pz = s.z;
    }
    this.spiders.push(s);
    if (kind === 'hero') this.hero = s;
    return s;
  }

  count(kind) {
    let n = 0;
    for (const s of this.spiders) if (s.kind === kind) n++;
    return n;
  }

  swarmCount() {
    return this.spiders.length;
  }

  buy(kind) {
    const def = SPIDERS[kind];
    const nest = this.nests[0];
    if (!def || !nest || this.res.soki < def.cost) return false;
    this.res.soki -= def.cost;
    const s = this.spawn(kind, nest.x + this.rng.range(-0.2, 0.2), nest.z + this.rng.range(-0.2, 0.2));
    this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.5, kind: 'hatch' });
    return true;
  }

  addNest(x, z) {
    this.nests.push({ x, z });
    this.seedWeb(x, z, 3);
    this.bus.emit('nest', { x, z });
  }

  seedWeb(x, z, r) {
    const g = this.grid;
    const cx = g.cx(x);
    const cz = g.cz(z);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!g.inb(cx + dx, cz + dz) || dx * dx + dz * dz > r * r) continue;
        const i = g.idx(cx + dx, cz + dz);
        if (!g.spiderOk(i)) continue;
        if (g.web[i] === 0) this.webList.push(i);
        g.web[i] = Math.max(g.web[i], 0.8);
      }
    }
  }

  setMark(x, z, fromClick = false) {
    if (fromClick) this.stats.clicks++;
    if (!this.mark) this.mark = { x, z };
    const p = this.markLimit ? this.markLimit(x, z) : { x, z };
    this.mark.x = p.x;
    this.mark.z = p.z;
    this.markDirty = true;
    this.bus.emit('mark', this.mark);
  }

  updateMarkField(dt) {
    this.markCool -= dt;
    if (this.markDirty && this.markCool <= 0 && this.mark) {
      this.markField = this.grid.flow(this.mark.x, this.mark.z, 'spider');
      this.markDirty = false;
      this.markCool = 0.12;
    }
  }

  moveAlongField(s, speed, dt) {
    if (!this.markField) return false;
    if (!this.grid.nextStep(this.markField, s.x, s.z, STEP)) {
      if (!this.grid.spiderOk(this.grid.at(s.x, s.z))) this.grid.snapSpider(s);
      return false;
    }
    return this.steer(s, STEP.x, STEP.z, speed, dt);
  }

  steer(s, tx, tz, speed, dt) {
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return true;
    const v = Math.min(speed * dt, d);
    s.x += (dx / d) * v;
    s.z += (dz / d) * v;
    s.dir = Math.atan2(dz, dx);
    s.moving = true;
    return d <= v + 0.01;
  }

  // Пауки идут к метке и по пути сами находят добычу.
  stepSpider(s, dt) {
    s.px = s.x;
    s.pz = s.z;
    s.moving = false;
    if (s.hidden) return;
    const def = SPIDERS[s.kind];
    if (s.kind === 'hero') {
      if (this.heroLocked) return;
      if (this.mark) {
        const d = dist(s.x, s.z, this.mark.x, this.mark.z);
        if (d > 0.05) this.moveAlongField(s, def.speed, dt);
      }
      return;
    }
    if (s.on) {
      this.stepAttached(s, dt);
      return;
    }
    s.thinkT -= dt;
    if (s.thinkT <= 0 && !s.job) {
      s.thinkT = 0.3;
      this.findJob(s);
    }
    if (s.job) {
      this.stepJob(s, def, dt);
      return;
    }
    if (s.kind === 'weaver') {
      this.wander(s, this.nests[0] ?? s, 0.7, def, dt);
      return;
    }
    if (this.mark) {
      const d = dist(s.x, s.z, this.mark.x, this.mark.z);
      const spread = 0.25 + Math.sqrt(this.spiders.length) * 0.05;
      if (d > spread * 1.6) {
        this.moveAlongField(s, def.speed * (0.85 + s.moveSeed * 0.3), dt);
      } else {
        this.wander(s, this.mark, spread, def, dt);
      }
    } else if (this.nests[0]) {
      this.wander(s, this.nests[0], 0.6, def, dt);
    }
  }

  wander(s, c, r, def, dt) {
    s.wanderT -= dt;
    if (s.wanderT <= 0) {
      s.wanderT = this.rng.range(0.6, 2.4);
      s.wx = c.x + this.rng.range(-r, r);
      s.wz = c.z + this.rng.range(-r, r);
      s.pause = this.rng.next() < 0.45;
    }
    if (s.pause) return;
    if (!this.grid.spiderOk(this.grid.at(s.wx, s.wz))) {
      s.wanderT = 0;
      return;
    }
    const nx = s.x + (s.wx - s.x) * 0.02;
    const nz = s.z + (s.wz - s.z) * 0.02;
    if (!this.grid.spiderOk(this.grid.at(nx, nz))) {
      s.wanderT = 0;
      return;
    }
    if (this.steer(s, s.wx, s.wz, def.speed * 0.55, dt)) s.pause = true;
  }

  findJob(s) {
    if (s.kind !== 'ling') return;
    const near = this.mark && dist(s.x, s.z, this.mark.x, this.mark.z) < 1.6;
    if (this.wire && !this.wire.done && dist(s.x, s.z, this.wire.x, this.wire.z) < 0.9) {
      s.job = { type: 'wire' };
      return;
    }
    for (const f of this.flies) {
      if (!f.taken && dist(s.x, s.z, f.x, f.z) < 1.3) {
        f.taken = true;
        s.job = { type: 'fly', fly: f };
        return;
      }
    }
    for (const h of this.humans) {
      if (!h.huntable || h.state === 'cocoon' || h.state === 'gone' || h.state === 'still') continue;
      if (dist(s.x, s.z, h.x, h.z) < (near ? 2.4 : 1.3)) {
        s.job = { type: 'human', h, field: this.grid.flow(h.x, h.z, 'spider'), t: 0 };
        return;
      }
    }
  }

  stepJob(s, def, dt) {
    const job = s.job;
    if (job.type === 'fly') {
      const f = job.fly;
      if (!this.flies.includes(f)) {
        s.job = null;
        return;
      }
      if (this.steer(s, f.x, f.z, def.speed * 1.3, dt)) {
        this.flies = this.flies.filter((o) => o !== f);
        this.res.soki += 3;
        this.stats.flies = (this.stats.flies ?? 0) + 1;
        this.bus.emit('ripple', { x: f.x, z: f.z, power: 0.35, kind: 'bite' });
        this.bus.emit('flyEaten', f);
        s.job = null;
      }
    } else if (job.type === 'wire') {
      if (!this.wire || this.wire.done) {
        s.job = null;
        return;
      }
      if (this.steer(s, this.wire.x + s.ox * 0.14, this.wire.z + s.oz * 0.08, def.speed, dt)) {
        this.wire.progress += dt * this.wire.rate;
      }
    } else if (job.type === 'human') {
      const h = job.h;
      job.t += dt;
      if (isDown(h) && h.state !== 'para' && h.state !== 'wrap') {
        s.job = null;
        return;
      }
      if (dist(s.x, s.z, h.x, h.z) < 0.34 || (h.lie > 0.5 && dist(s.x, s.z, h.x, h.z - 0.8) < 0.95)) {
        s.on = h;
        s.job = null;
        s.ang = this.rng.range(0, 6.28);
        h.attached++;
        this.stats.bites++;
        return;
      }
      if (job.t > 1.2) {
        job.t = 0;
        job.field = this.grid.flow(h.x, h.z, 'spider');
      }
      if (this.grid.nextStep(job.field, s.x, s.z, STEP)) this.steer(s, STEP.x, STEP.z, def.speed * 1.1, dt);
      else s.job = null;
    }
  }

  stepAttached(s, dt) {
    const h = s.on;
    if (h.state === 'cocoon' || h.state === 'gone') {
      this.detach(s);
      return;
    }
    s.moving = true;
    if (h.lie > 0.5) {
      const along = s.climb * h.height * 0.9;
      s.x = h.x - 0.2 + (s.ang / 6.28) * 0.4;
      s.z = h.z - along;
      s.y = h.bedY + 0.14;
    } else {
      s.climb = Math.min(1, s.climb + dt * 0.08);
      s.ang += dt * 0.6;
      s.x = h.x + Math.cos(s.ang) * 0.17;
      s.z = h.z + Math.sin(s.ang) * 0.17;
      s.y = s.climb * h.height * 0.95;
    }
    s.dir = s.ang + 1.57;
  }

  detach(s) {
    if (s.on) s.on.attached = Math.max(0, s.on.attached - 1);
    s.on = null;
    s.y = 0;
    if (!this.grid.spiderOk(this.grid.at(s.x, s.z))) {
      const n = this.nests[0] ?? this.mark;
      if (n) {
        s.x = n.x;
        s.z = n.z;
      }
    }
    s.px = s.x;
    s.pz = s.z;
  }

  killSpider(s) {
    if (s.on) this.detach(s);
    this.spiders = this.spiders.filter((o) => o !== s);
    this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.4, kind: 'death' });
    if (s === this.hero) {
      this.hero = null;
      this.bus.emit('heroDead');
    }
  }

  swat(h) {
    for (const s of this.spiders) {
      if (s.on === h) {
        this.killSpider(s);
        return;
      }
    }
  }

  slipperHit(h, x, z) {
    const r = 0.33;
    this.bus.emit('slipper', { x, z, phase: 'hit', life: 0.3 });
    this.bus.emit('ripple', { x, z, power: 1.6, kind: 'stomp' });
    this.bus.emit('shake', 0.9);
    // Тапок давит не больше трёх: иначе один удар сносил бы весь рой в тесной комнате.
    let kills = 0;
    for (const s of [...this.spiders]) {
      if (s.hidden || s.on || dist(s.x, s.z, x, z) >= r) continue;
      if (s.kind === 'hero' || kills < 3) {
        this.killSpider(s);
        kills++;
      }
    }
  }

  onParalyzed(h) {
    this.bus.emit('human', { h, event: 'para' });
  }

  onCocoon(h) {
    this.cocoons.push({ x: h.x, z: h.z, lie: h.lie > 0.5, h, left: 40 });
    this.level.population -= 1;
    this.dread = (this.dread ?? 0) + 0.12;
    this.bus.emit('human', { h, event: 'cocoon' });
    this.bus.emit('population', this.level.population);
    for (const s of this.spiders) if (s.on === h) this.detach(s);
    this.script?.onCocoon?.(h);
  }

  updateFlies(dt) {
    for (const f of this.flies) {
      f.a += dt * f.w;
      f.x = f.cx + Math.cos(f.a) * f.r;
      f.z = f.cz + Math.sin(f.a * 1.3) * f.r;
      f.y = 0.1 + Math.abs(Math.sin(f.a * 2.1)) * 0.35;
    }
    for (const c of this.cocoons) {
      if (c.left > 0) {
        const v = Math.min(c.left, dt * 2.2);
        c.left -= v;
        this.res.soki += v;
      }
    }
  }

  addFly(cx, cz) {
    this.flies.push({ cx, cz, x: cx, z: cz, y: 0.2, a: this.rng.range(0, 6), r: this.rng.range(0.1, 0.42), w: this.rng.range(1.6, 3), taken: false });
  }

  updateWeb(dt) {
    const g = this.grid;
    if (!this.webList.length) return;
    const weavers = this.count('weaver');
    const budget = (0.3 * this.nests.length + weavers * 1.1) * dt * 24;
    let n = Math.floor(budget + this.rng.next());
    while (n-- > 0) {
      const i = this.webList[Math.floor(this.rng.next() * this.webList.length)];
      const cx = i % g.w;
      const cz = (i - cx) / g.w;
      const side = this.rng.int(0, 3);
      const nx = cx + (side === 0 ? 1 : side === 1 ? -1 : 0);
      const nz = cz + (side === 2 ? 1 : side === 3 ? -1 : 0);
      if (!g.inb(nx, nz)) continue;
      const ni = g.idx(nx, nz);
      if (!g.spiderOk(ni) || g.lit(ni) > 0.3) continue;
      if (g.web[ni] === 0) this.webList.push(ni);
      g.web[ni] = Math.min(1, g.web[ni] + 0.34);
    }
    this.res.silk += dt * (0.3 * this.nests.length + weavers * 0.5 + this.count('ling') * 0.03 + this.webList.length * 0.0012);
    this.hatchFromNests(dt);
  }

  // Гнёзда сами выводят паучат за шёлк: рой восстанавливается и после разгрома.
  hatchFromNests(dt) {
    this.nestT = (this.nestT ?? 0) - dt;
    if (this.nestT > 0 || !this.nests.length) return;
    this.nestT = 5 / this.nests.length;
    if (this.res.silk < 3 || this.count('ling') >= 30) return;
    this.res.silk -= 3;
    const n = this.nests[Math.floor(this.rng.next() * this.nests.length)];
    const s = this.spawn('ling', n.x + this.rng.range(-0.15, 0.15), n.z + this.rng.range(-0.15, 0.15));
    this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.4, kind: 'hatch' });
  }

  updateSense(dt) {
    this.senseT -= dt;
    if (this.senseT > 0) return;
    this.senseT = 0.15;
    const g = this.grid;
    const { sense, seen, web } = g;
    for (let i = 0; i < g.n; i++) {
      const lit = g.lit(i) > 0.16 ? 1 : 0;
      const base = web[i] > 0 || lit ? 1 : seen[i] ? 0.7 : 0.24;
      sense[i] += (base - sense[i]) * 0.3;
    }
    const stampR = (s, r) => {
      const cx = g.cx(s.x);
      const cz = g.cz(s.z);
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (!g.inb(nx, nz) || dx * dx + dz * dz > r * r) continue;
          const i = g.idx(nx, nz);
          seen[i] = 1;
          sense[i] = 1;
        }
      }
    };
    const step = Math.max(1, Math.floor(this.spiders.length / 40));
    for (let k = 0; k < this.spiders.length; k += step) stampR(this.spiders[k], 14);
    for (const h of this.humans) {
      const i = g.at(h.x, h.z);
      const target = h.state === 'gone' ? 0 : h.state === 'still' ? 0 : sense[i] > 0.5 || g.lit(i) > 0.2 ? 1 : 0;
      h.fadeTarget = target;
    }
  }

  tick(dt) {
    this.t += dt;
    this.updateMarkField(dt);
    for (const s of this.spiders) this.stepSpider(s, dt);
    for (const h of this.humans) tickHuman(this, h, dt);
    this.updateFlies(dt);
    this.updateWeb(dt);
    if (this.wire && !this.wire.done && this.wire.progress >= 1) {
      this.wire.done = true;
      for (const s of this.spiders) if (s.job?.type === 'wire') s.job = null;
    }
    this.lightT -= dt;
    if (this.lightDirty) bakeStaticLight(this.grid, this.lights), (this.lightDirty = false), (this.lightT = 0);
    if (this.lightT <= 0) {
      this.lightT = 0.08;
      composeLight(this.grid, this.lights);
    }
    this.updateSense(dt);
    this.script?.tick(dt);
    for (const h of this.humans) h.fade = clamp(h.fade + (h.fadeTarget - h.fade) * dt * 3);
  }
}
