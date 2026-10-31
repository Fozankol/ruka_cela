import { Bus, RNG, angleLerp, clamp, dist } from '../core/util.js';
import { bakeStaticLight, composeLight } from './light.js';
import { makeHuman, tickHuman } from './humans.js';

export const SPIDERS = {
  hero: { name: 'Мать', speed: 1.25, scale: 0.17, hp: 8 },
  carrier: { name: 'Рабочий', speed: 0.9, scale: 0.14, hp: 1 },
  fighter: { name: 'Рой', speed: 2.1, scale: 0.1, hp: 1 },
};

export const FOOD_GOAL = 100;
const WORKER_COST = 8;
const WORKER_COST_STEP = 4;
const WORKER_MAX = 8;
const ALERT_PER_FOOD = 1.3;
const ALERT_DECAY = 0.45;
const ALERT_REST = 6.5;
const ALERT_SAFE = 45;
const HIDE_BOOST = 1.35;
const TREATS = [
  { name: 'Крошка', color: [2.4, 2.1, 1.4] },
  { name: 'Сахар', color: [2.7, 2.7, 2.9] },
  { name: 'Муха', color: [1.1, 2.6, 1.2] },
  { name: 'Сыр', color: [3, 2.3, 0.5] },
];
const STEP = { x: 0, z: 0 };

export class World {
  constructor(level, seed = 7) {
    this.level = level;
    this.grid = level.grid;
    this.rng = new RNG(seed);
    this.bus = new Bus();
    this.t = 0;
    this.food = 0;
    this.alert = 0;
    this.alarmOn = false;
    this.bought = 0;
    this.stats = { bites: 0, clicks: 0, gathered: 0, lost: 0 };
    this.biteRate = 0;
    this.spiders = [];
    this.flies = [];
    this.treats = [];
    this.queue = [];
    this.nests = [];
    this.lights = level.lights;
    this.humans = level.humans.map(makeHuman);
    this.webList = [];
    this.mark = null;
    this.markField = null;
    this.markDirty = false;
    this.markCool = 0;
    this.nextId = 1;
    this.script = null;
    this.flags = { resources: false };
    this.goal = null;
    this.senseT = 0;
    this.lightT = 0;
    this.lightDirty = true;
    this.hero = null;
    this.rts = false;
    this.revealRoom(1);
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
    const def = SPIDERS[kind];
    const s = {
      id: this.nextId++,
      kind,
      x,
      z,
      px: x,
      pz: z,
      y: 0,
      vx: 0,
      vz: 0,
      hp: def.hp,
      dir: this.rng.range(-3.14, 3.14),
      order: null,
      on: null,
      load: 0,
      ang: this.rng.range(0, 6.28),
      moving: false,
      hidden: false,
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

  // Рабочий стоит еду, то есть отодвигает победу, но окупается на дистанции.
  workerCost() {
    return WORKER_COST + this.bought * WORKER_COST_STEP;
  }

  buyWorker() {
    if (this.count('carrier') >= WORKER_MAX) return 'В гнезде нет места';
    const cost = this.workerCost();
    if (this.food < cost) return 'Не хватает еды';
    this.food -= cost;
    this.bought++;
    const n = this.nests[0];
    const s = this.spawn('carrier', n.x - 0.5, n.z + 0.6);
    this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.5, kind: 'hatch' });
    return null;
  }

  count(kind) {
    let n = 0;
    for (const s of this.spiders) if (s.kind === kind) n++;
    return n;
  }

  addNest(x, z) {
    const n = { x, z, built: 1, queue: [], field: this.grid.flow(x, z, 'spider') };
    this.nests.push(n);
    this.seedWeb(x, z, 3);
    this.bus.emit('nest', n);
    return n;
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

  // Вкусняшка появляется в свободном месте. Чем дальше от гнезда, тем она ценнее.
  addTreat() {
    const home = this.nests[0];
    const free = this.level.treatSpots.filter((p) => !this.treats.some((t) => dist(t.x, t.z, p.x, p.z) < 0.6));
    if (!free.length) return;
    const p = this.rng.pick(free);
    const look = this.rng.pick(TREATS);
    const t = {
      x: p.x,
      z: p.z,
      name: look.name,
      color: look.color,
      value: Math.round(2 + dist(p.x, p.z, home.x, home.z) * 0.7),
      worker: null,
      queued: false,
      field: this.grid.flow(p.x, p.z, 'spider'),
    };
    this.treats.push(t);
    this.bus.emit('treat', t);
  }

  removeTreat(t) {
    this.treats = this.treats.filter((o) => o !== t);
    this.queue = this.queue.filter((o) => o !== t);
    this.bus.emit('treatGone', t);
    this.addTreat();
  }

  freeWorker(t) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.spiders) {
      if (s.kind !== 'carrier' || s.hidden || s.load > 0 || s.order?.type === 'fetch') continue;
      const d = dist(s.x, s.z, t.x, t.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // Клик по вкусняшке: идёт ближайший свободный рабочий, а если все заняты, она ждёт очереди.
  dispatch(t) {
    if (t.worker || t.queued || this.alarmOn) return false;
    const s = this.freeWorker(t);
    if (s) {
      this.assign(s, t);
    } else {
      t.queued = true;
      this.queue.push(t);
    }
    return true;
  }

  assign(s, t) {
    t.worker = s;
    t.queued = false;
    s.order = { type: 'fetch', t, phase: 'go' };
  }

  // Вступление: у игрока только Мать, и она ползёт туда, куда указали.
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

  // Идём к самой дальней точке пути, которую видно по прямой: так нет рывков по клеткам.
  followField(s, field, speed, dt) {
    if (!field) return false;
    if (!this.grid.smoothStep(field, s.x, s.z, 'spider', STEP)) {
      if (!this.grid.spiderOk(this.grid.at(s.x, s.z))) this.grid.snapSpider(s);
      return false;
    }
    return this.steer(s, STEP.x, STEP.z, speed, dt);
  }

  // Плавный разгон и поворот: паук не меняет направление мгновенно.
  steer(s, tx, tz, speed, dt) {
    const dx = tx - s.x;
    const dz = tz - s.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.012) {
      s.vx = 0;
      s.vz = 0;
      return true;
    }
    const want = Math.min(speed, d / Math.max(dt, 1e-3));
    const k = Math.min(1, dt * 10);
    s.vx += ((dx / d) * want - s.vx) * k;
    s.vz += ((dz / d) * want - s.vz) * k;
    const nx = s.x + s.vx * dt;
    const nz = s.z + s.vz * dt;
    if (this.grid.spiderOk(this.grid.at(nx, nz))) {
      s.x = nx;
      s.z = nz;
    } else if (this.grid.spiderOk(this.grid.at(nx, s.z))) {
      s.x = nx;
      s.vz = 0;
    } else if (this.grid.spiderOk(this.grid.at(s.x, nz))) {
      s.z = nz;
      s.vx = 0;
    } else {
      s.vx = 0;
      s.vz = 0;
    }
    s.dir = angleLerp(s.dir, Math.atan2(s.vz, s.vx), Math.min(1, dt * 11));
    s.moving = true;
    return d < 0.06;
  }

  stepSpider(s, dt) {
    s.px = s.x;
    s.pz = s.z;
    s.moving = false;
    if (s.hidden) return;
    const def = SPIDERS[s.kind];
    if (s.kind === 'hero' && !this.rts) {
      if (!this.heroLocked && this.mark && dist(s.x, s.z, this.mark.x, this.mark.z) > 0.05) {
        this.followField(s, this.markField, def.speed, dt);
      }
      return;
    }
    const o = s.order;
    if (!o) {
      if (s.kind === 'carrier' && !this.alarmOn) this.stepIdle(s, def, dt);
      return;
    }
    if (o.type === 'fetch') this.stepFetch(s, o, def.speed, dt);
    else if (o.type === 'hide') this.stepHide(s, o, def.speed * HIDE_BOOST, dt);
    else if (o.type === 'move') this.stepMove(s, o, def.speed, dt);
  }

  // Свободный рабочий ждёт у гнезда на своём месте, а не в общей куче.
  stepIdle(s, def, dt) {
    if (this.queue.length) {
      this.assign(s, this.queue.shift());
      return;
    }
    const n = this.nests[0];
    const a = s.id * 2.4;
    const r = 0.45 + (s.id % 3) * 0.16;
    const x = n.x - 0.55 + Math.cos(a) * r;
    const z = n.z + 0.7 + Math.sin(a) * r;
    if (dist(s.x, s.z, x, z) > 0.1 && this.grid.spiderOk(this.grid.at(x, z))) {
      if (dist(s.x, s.z, x, z) < 0.5) this.steer(s, x, z, def.speed * 0.5, dt);
      else this.followField(s, n.field, def.speed * 0.8, dt);
    }
  }

  stepMove(s, o, speed, dt) {
    if (dist(s.x, s.z, o.x, o.z) < 0.3) s.order = null;
    else this.followField(s, o.field, speed, dt);
  }

  stepFetch(s, o, speed, dt) {
    if (o.phase === 'back') {
      const n = this.nests[0];
      if (dist(s.x, s.z, n.x, n.z) < 0.45) {
        this.deposit(s);
        return;
      }
      this.followField(s, n.field, speed * 0.9, dt);
      return;
    }
    const t = o.t;
    if (dist(s.x, s.z, t.x, t.z) < 0.2) {
      s.load = t.value;
      o.phase = 'back';
      this.bus.emit('ripple', { x: t.x, z: t.z, power: 0.4, kind: 'hatch' });
      this.removeTreat(t);
      return;
    }
    this.followField(s, t.field, speed, dt);
  }

  deposit(s) {
    this.food = Math.min(FOOD_GOAL, this.food + s.load);
    this.stats.gathered += s.load;
    if (!this.alarmOn) this.alert = clamp(this.alert + s.load * ALERT_PER_FOOD, 0, 100);
    this.bus.emit('deposit', { x: s.x, z: s.z, v: s.load });
    this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.3, kind: 'hatch' });
    s.load = 0;
    s.order = null;
  }

  // Тревога: все бегут в ближайшее укрытие. Вкусняшки остаются лежать на месте.
  scatter() {
    for (const t of this.treats) {
      t.worker = null;
      t.queued = false;
    }
    this.queue = [];
    for (const s of this.spiders) {
      if (s.kind !== 'carrier') continue;
      let best = null;
      let bestD = Infinity;
      for (const c of this.level.shelters) {
        const steps = c.field[this.grid.at(s.x, s.z)];
        if (steps >= 0 && steps < bestD) {
          bestD = steps;
          best = c;
        }
      }
      s.order = best ? { type: 'hide', shelter: best } : null;
    }
  }

  stepHide(s, o, speed, dt) {
    if (dist(s.x, s.z, o.shelter.x, o.shelter.z) < 0.3) {
      s.hidden = true;
      s.order = null;
      return;
    }
    this.followField(s, o.shelter.field, speed, dt);
  }

  regroup() {
    for (const s of this.spiders) {
      if (s.kind !== 'carrier') continue;
      s.hidden = false;
      s.order = s.load > 0 ? { type: 'fetch', phase: 'back' } : null;
    }
  }

  damage(s, n = 1) {
    s.hp -= n;
    if (s.hp <= 0) this.killSpider(s);
  }

  killSpider(s) {
    if (s.order?.t) s.order.t.worker = null;
    this.spiders = this.spiders.filter((o) => o !== s);
    this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.4, kind: 'death' });
    this.bus.emit('spiderDead', s);
    if (s.kind === 'carrier') {
      this.stats.lost++;
      this.bus.emit('notice', 'Рабочего раздавили!');
    }
    if (s === this.hero) {
      this.hero = null;
      this.bus.emit('heroDead');
    }
  }

  swat() {}

  slipperHit(h, x, z) {
    const r = 0.36;
    this.bus.emit('slipper', { x, z, phase: 'hit', life: 0.3 });
    this.bus.emit('ripple', { x, z, power: 1.6, kind: 'stomp' });
    this.bus.emit('shake', 0.9);
    for (const s of [...this.spiders]) {
      if (!s.hidden && dist(s.x, s.z, x, z) < r) this.damage(s, 99);
    }
  }

  onParalyzed() {}
  onCocoon() {}

  // Пауки расталкивают друг друга, поэтому не стоят в одной точке.
  separate(dt) {
    const list = this.spiders;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.hidden) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.hidden) continue;
        const min = (SPIDERS[a.kind].scale + SPIDERS[b.kind].scale) * 1.1;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) * Math.min(1, dt * 6);
        const px = (dx / d) * push;
        const pz = (dz / d) * push;
        if (this.grid.spiderOk(this.grid.at(a.x - px, a.z - pz))) {
          a.x -= px;
          a.z -= pz;
        }
        if (this.grid.spiderOk(this.grid.at(b.x + px, b.z + pz))) {
          b.x += px;
          b.z += pz;
        }
      }
    }
  }

  updateSense(dt) {
    this.senseT -= dt;
    if (this.senseT > 0) return;
    this.senseT = 0.15;
    const g = this.grid;
    const { sense, seen, web } = g;
    for (let i = 0; i < g.n; i++) {
      const lit = g.lit(i) > 0.16 ? 1 : 0;
      const base = web[i] > 0 || lit ? 1 : seen[i] ? 0.8 : 0.24;
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
    for (const s of this.spiders) stampR(s, 14);
    for (const h of this.humans) {
      const i = g.at(h.x, h.z);
      h.fadeTarget = h.state === 'gone' ? 0 : sense[i] > 0.5 || g.lit(i) > 0.2 ? 1 : 0;
    }
  }

  // Тревога спадает сама. Пока все в укрытиях, жильцы успокаиваются быстрее.
  updateAlert(dt) {
    if (!this.nests.length) return;
    if (!this.alarmOn && this.alert >= 100) this.script?.onAlarm();
    this.alert = Math.max(0, this.alert - dt * (this.alarmOn ? ALERT_REST : ALERT_DECAY));
    if (this.alarmOn && this.alert <= ALERT_SAFE) this.script?.onCalm();
  }

  tick(dt) {
    this.t += dt;
    this.updateMarkField(dt);
    for (const s of [...this.spiders]) this.stepSpider(s, dt);
    this.separate(dt);
    for (const h of this.humans) tickHuman(this, h, dt);
    this.updateAlert(dt);
    this.lightT -= dt;
    if (this.lightDirty) {
      bakeStaticLight(this.grid, this.lights);
      this.lightDirty = false;
      this.lightT = 0;
    }
    if (this.lightT <= 0) {
      this.lightT = 0.08;
      composeLight(this.grid, this.lights);
    }
    this.updateSense(dt);
    this.script?.tick(dt);
    for (const h of this.humans) h.fade = clamp(h.fade + (h.fadeTarget - h.fade) * dt * 3);
  }
}
