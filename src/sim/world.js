import { Bus, RNG, angleLerp, clamp, dist } from '../core/util.js';
import { bakeStaticLight, composeLight } from './light.js';
import { makeHuman, tickHuman } from './humans.js';

export const SPIDERS = {
  hero: { name: 'Мать', speed: 1.25, scale: 0.17, hp: 8 },
  carrier: { name: 'Рабочий', speed: 0.9, scale: 0.14, hp: 1 },
  fighter: { name: 'Боец', speed: 2.1, scale: 0.1, hp: 1 },
  gnawer: { name: 'Грызун', speed: 1.4, scale: 0.15, hp: 1 },
  widow: { name: 'Вдова', speed: 2.1, scale: 0.17, hp: 2 },
};

export const FOOD_GOAL = 100;
const DEFAULT_RULES = { goal: FOOD_GOAL, alertPer: 3.9, startWorkers: 2, workerCap: 8, workerCost: 8, workerStep: 4, decay: 0.45, treats: 9 };
const ALERT_REST = 6.5;
const ALERT_SAFE = 45;
const HIDE_BOOST = 1.35;
const GNAW_TIME = 5;
const WEB_FAST = 1.4;
const WEB_SLOW = 0.9;
const ROUTES_PER_TICK = 2;
const TREATS = [
  { name: 'Крошка', color: [2.4, 2.1, 1.4] },
  { name: 'Сахар', color: [2.7, 2.7, 2.9] },
  { name: 'Муха', color: [1.1, 2.6, 1.2] },
  { name: 'Сыр', color: [3, 2.3, 0.5] },
];
const STEP = { x: 0, z: 0 };

export class World {
  constructor(level, seed = 7, bus = new Bus()) {
    this.level = level;
    this.grid = level.grid;
    this.rng = new RNG(seed);
    this.bus = bus;
    this.rules = { ...DEFAULT_RULES, ...level.rules };
    this.unitK = level.unitK ?? 1;
    this.speedK = level.speedK ?? 1;
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
    this.poles = [];
    this.dogs = [];
    this.bell = null;
    this.lights = level.lights;
    this.humans = level.humans.map(makeHuman);
    this.webList = [];
    this.webV = 0;
    this.webDirty = 0;
    this.routeBudget = ROUTES_PER_TICK;
    this.silk = this.rules.silkStart ?? 0;
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
      world: this,
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
    return this.rules.workerCost + this.bought * this.rules.workerStep;
  }

  buyWorker() {
    if (this.count('carrier') >= this.rules.workerCap) return 'В гнезде нет места';
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

  removeNest(n) {
    this.nests = this.nests.filter((o) => o !== n);
    this.bus.emit('nestGone', n);
  }

  nearestNest(s) {
    let best = this.nests[0];
    let bestD = Infinity;
    for (const n of this.nests) {
      const d = dist(s.x, s.z, n.x, n.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // На картах с нитями путь зависит от паутины: поле пересчитывается, когда она меняется.
  liveField(t) {
    if (!this.rules.webRoutes) return t.field;
    if (t.fieldV !== this.webV && this.routeBudget > 0) {
      this.routeBudget--;
      t.field = this.grid.flowWeb(t.x, t.z);
      t.fieldV = this.webV;
    }
    return t.field;
  }

  onWeb(x, z) {
    return this.grid.web[this.grid.at(x, z)] > 0.3;
  }

  // Клетки паутины меняются часто, а пути пересчитываются не чаще раза в полсекунды.
  touchWeb() {
    this.webDirty = this.webDirty || 0.5;
  }

  eraseWeb(x, z, r) {
    const g = this.grid;
    const cx = g.cx(x);
    const cz = g.cz(z);
    let n = 0;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!g.inb(cx + dx, cz + dz) || dx * dx + dz * dz > r * r) continue;
        const i = g.idx(cx + dx, cz + dz);
        if (g.web[i] > 0) n++;
        g.web[i] = 0;
      }
    }
    if (n) this.touchWeb();
    return n;
  }

  seedWeb(x, z, r) {
    this.touchWeb();
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
      value: Math.round(2 + dist(p.x, p.z, home.x, home.z) * 0.7 * (this.level.valueK ?? 1)),
      worker: null,
      queued: false,
      field: this.grid.flow(p.x, p.z, 'spider'),
    };
    this.treats.push(t);
    this.bus.emit('treat', t);
  }

  // Вкусняшка на заданном месте: её может запирать свет столба.
  addTreatAt(p, { zone, locked = false, value = 5 } = {}) {
    const look = this.rng.pick(TREATS);
    const t = { x: p.x, z: p.z, name: look.name, color: look.color, value, worker: null, queued: false, zone, locked, field: this.grid.flow(p.x, p.z, 'spider'), fieldV: -1 };
    this.treats.push(t);
    this.bus.emit('treat', t);
    return t;
  }

  removeTreat(t) {
    if (!this.treats.includes(t)) return;
    this.treats = this.treats.filter((o) => o !== t);
    this.queue = this.queue.filter((o) => o !== t);
    this.bus.emit('treatGone', t);
    if (t.zone === undefined) this.addTreat();
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
    if (t.locked) {
      this.bus.emit('notice', 'Двор под светом. Сначала столб.');
      return false;
    }
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
      if (field[this.grid.at(s.x, s.z)] < 0) this.grid.snapToField(s, field);
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
    if (s.kind === 'fighter' && s.order?.type !== 'move') {
      this.stepFighter(s, def, dt);
      return;
    }
    const o = s.order;
    if (!o) {
      if (s.kind === 'hero') return;
      if (this.alarmOn) this.sendToShelter(s);
      else this.stepIdle(s, def, dt);
      return;
    }
    let speed = def.speed * this.speedK;
    if (this.rules.webRoutes) speed *= this.onWeb(s.x, s.z) ? WEB_FAST : WEB_SLOW;
    if (o.type === 'fetch') this.stepFetch(s, o, speed, dt);
    else if (o.type === 'hide') this.stepHide(s, o, speed * HIDE_BOOST, dt);
    else if (o.type === 'move') this.stepMove(s, o, speed, dt);
    else if (o.type === 'gnaw') this.stepGnaw(s, o, speed, dt);
    else if (o.type === 'hunt') this.stepHunt(s, o, speed, dt);
  }

  // Вдова идёт за живой целью, поэтому её путь обновляется на ходу.
  sendWidow(s, prey) {
    s.order = { type: 'hunt', prey, t: 0, field: null };
  }

  stepHunt(s, o, speed, dt) {
    const p = o.prey;
    if (p.down || p.state === 'gone') {
      s.order = null;
      return;
    }
    if (dist(s.x, s.z, p.x, p.z) < 0.55 * this.unitK) {
      s.order = null;
      s.rest = 7;
      this.bus.emit('ripple', { x: p.x, z: p.z, power: 1, kind: 'bite' });
      this.script?.onBite(p);
      return;
    }
    o.t -= dt;
    if (o.t <= 0) {
      o.t = 0.7;
      o.field = this.grid.flow(p.x, p.z, 'spider');
    }
    this.followField(s, o.field, speed * 1.3, dt);
  }

  sendGnaw(s, pole) {
    pole.gnaw = s;
    s.order = { type: 'gnaw', pole, t: GNAW_TIME };
  }

  stepGnaw(s, o, speed, dt) {
    const p = o.pole;
    if (dist(s.x, s.z, p.x, p.z) > 0.3 * this.unitK) {
      this.followField(s, this.liveField(p), speed, dt);
      return;
    }
    // Грызун сидит на столбе, снизу его не достать.
    s.perched = true;
    o.t -= dt;
    if (Math.floor(o.t * 5) !== Math.floor((o.t + dt) * 5)) this.bus.emit('ripple', { x: p.x, z: p.z, power: 0.5, kind: 'bite' });
    if (o.t > 0) return;
    p.cut = true;
    p.gnaw = null;
    s.order = null;
    s.perched = false;
    this.script?.onPoleCut(p);
  }

  // Боец держится у гнезда и сам бросается на людей с факелами.
  stepFighter(s, def, dt) {
    const speed = def.speed * this.speedK * 0.7;
    const reach = 0.5 * this.unitK;
    let foe = null;
    let bestD = 3.6 * this.unitK;
    for (const h of this.humans) {
      if (!h.foe) continue;
      const d = dist(s.x, s.z, h.x, h.z);
      if (d < bestD) {
        bestD = d;
        foe = h;
      }
    }
    if (foe) {
      if (bestD > reach) {
        this.steer(s, foe.x, foe.z, speed, dt);
        return;
      }
      foe.hp -= dt;
      if (foe.hp <= 0 && foe.foe) this.script?.onFoeDown(foe);
      return;
    }
    if (s.order?.type === 'storm') {
      const b = this.bell;
      if (dist(s.x, s.z, b.x, b.z) > 1.3 * this.unitK) this.followField(s, this.liveField(b), speed, dt);
      else this.script?.hitBell(dt);
      return;
    }
    const n = this.nearestNest(s);
    const a = s.id * 2.4;
    const r = (0.9 + (s.id % 3) * 0.25) * this.unitK;
    const x = n.x + Math.cos(a) * r;
    const z = n.z + Math.sin(a) * r;
    if (dist(s.x, s.z, x, z) < 0.1) return;
    if (dist(s.x, s.z, n.x, n.z) > 3 * this.unitK) this.followField(s, this.liveField(n), speed, dt);
    else this.steer(s, x, z, speed * 0.5, dt);
  }

  // Свободный рабочий ждёт у гнезда на своём месте, а не в общей куче.
  stepIdle(s, def, dt) {
    if (this.queue.length && s.kind === 'carrier') {
      this.assign(s, this.queue.shift());
      return;
    }
    // Вкусняшку, которой коснулась паутина, рабочие забирают сами.
    if (this.rules.autoGather && s.kind === 'carrier') {
      const t = this.nearestOpenTreat(s);
      if (t) {
        this.assign(s, t);
        return;
      }
    }
    s.rest = Math.max(0, (s.rest ?? 0) - dt);
    const n = this.nearestNest(s);
    const a = s.id * 2.4;
    const r = (0.45 + (s.id % 3) * 0.16) * this.unitK;
    const x = n.x - 0.55 + Math.cos(a) * r;
    const z = n.z + 0.7 + Math.sin(a) * r;
    if (dist(s.x, s.z, x, z) > 0.1 && this.grid.spiderOk(this.grid.at(x, z))) {
      if (dist(s.x, s.z, x, z) < 0.5 * this.unitK) {
        // Своё место бывает за стеной: тогда рабочий ждёт там, где стоит.
        if (this.grid.spiderLine(s.x, s.z, x, z)) this.steer(s, x, z, def.speed * this.speedK * 0.5, dt);
      } else this.followField(s, this.liveField(n), def.speed * this.speedK * 0.8, dt);
    }
  }

  nearestOpenTreat(s) {
    let best = null;
    let bestD = Infinity;
    for (const t of this.treats) {
      if (t.worker || t.queued || t.locked || !this.onWeb(t.x, t.z)) continue;
      const d = dist(s.x, s.z, t.x, t.z);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  stepMove(s, o, speed, dt) {
    if (dist(s.x, s.z, o.x, o.z) < 0.3 || o.field[this.grid.at(s.x, s.z)] === 0) s.order = null;
    else this.followField(s, o.field, speed, dt);
  }

  stepFetch(s, o, speed, dt) {
    if (o.phase === 'back') {
      const n = this.nearestNest(s);
      if (dist(s.x, s.z, n.x, n.z) < 0.45 * this.unitK || n.field[this.grid.at(s.x, s.z)] === 0) {
        this.deposit(s);
        return;
      }
      this.followField(s, this.liveField(n), speed * 0.9, dt);
      return;
    }
    const t = o.t;
    const field = this.liveField(t);
    // Вкусняшку уже унёс другой рабочий: идём за новой, а не к пустому месту.
    if (!this.treats.includes(t)) {
      s.order = null;
      return;
    }
    if (dist(s.x, s.z, t.x, t.z) < 0.2 * this.unitK || field[this.grid.at(s.x, s.z)] === 0) {
      s.load = t.value;
      o.phase = 'back';
      this.bus.emit('ripple', { x: t.x, z: t.z, power: 0.4, kind: 'hatch' });
      this.removeTreat(t);
      return;
    }
    this.followField(s, field, speed, dt);
  }

  deposit(s) {
    this.food = Math.min(this.rules.goal, this.food + s.load);
    this.stats.gathered += s.load;
    if (!this.alarmOn) this.alert = clamp(this.alert + s.load * this.rules.alertPer, 0, 100);
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
      if (s.kind === 'fighter' || s.kind === 'hero') continue;
      if (s.order?.pole) s.order.pole.gnaw = null;
      if (s.order?.type === 'fetch') s.exposed = true;
      else this.sendToShelter(s);
    }
  }

  sendToShelter(s) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.level.shelters) {
      const steps = c.field[this.grid.at(s.x, s.z)];
      if (steps >= 0 && steps < bestD) {
        bestD = steps;
        best = c;
      }
    }
    s.exposed = false;
    s.order = best ? { type: 'hide', shelter: best } : null;
  }

  // Рабочий с заданием сам его не бросит: игрок снимает его кликом по красной метке.
  recall(s) {
    if (s.order?.t?.worker) s.order.t.worker = null;
    this.sendToShelter(s);
    this.bus.emit('order', { x: s.x, z: s.z });
  }

  // Где показывать красную метку: на вкусняшке, а если рабочий уже несёт её, то на нём самом.
  exposedMarks() {
    const out = [];
    for (const s of this.spiders) {
      if (!s.exposed) continue;
      const t = s.order?.phase === 'go' ? s.order.t : null;
      out.push({ s, x: t ? t.x : s.x, z: t ? t.z : s.z });
    }
    return out;
  }

  stepHide(s, o, speed, dt) {
    if (dist(s.x, s.z, o.shelter.x, o.shelter.z) < 0.3 * this.unitK || o.shelter.field[this.grid.at(s.x, s.z)] === 0) {
      s.hidden = true;
      s.order = null;
      return;
    }
    this.followField(s, o.shelter.field, speed, dt);
  }

  regroup() {
    for (const s of this.spiders) {
      if (s.kind === 'fighter' || s.kind === 'hero') continue;
      s.hidden = false;
      if (s.exposed) {
        s.exposed = false;
        continue;
      }
      s.order = s.load > 0 ? { type: 'fetch', phase: 'back' } : null;
    }
  }

  damage(s, n = 1) {
    s.hp -= n;
    if (s.hp <= 0) this.killSpider(s);
  }

  killSpider(s) {
    if (s.order?.t?.worker) s.order.t.worker = null;
    if (s.order?.pole) s.order.pole.gnaw = null;
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
    const r = this.level.stompR ?? 0.36;
    this.bus.emit('slipper', { x, z, phase: 'hit', life: 0.3 });
    this.bus.emit('ripple', { x, z, power: 1.6, kind: 'stomp' });
    this.bus.emit('shake', 0.9);
    for (const s of [...this.spiders]) {
      if (!s.hidden && dist(s.x, s.z, x, z) < r) this.damage(s, 99);
    }
  }

  onParalyzed() {}

  onCocoon(h) {
    this.bus.emit('human', { h, event: 'cocoon' });
    this.script?.onCocoon?.(h);
  }

  // Пауки расталкивают друг друга, поэтому не стоят в одной точке.
  separate(dt) {
    const list = this.spiders;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.hidden) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.hidden) continue;
        const min = (SPIDERS[a.kind].scale + SPIDERS[b.kind].scale) * 1.1 * this.unitK;
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
    if (!this.alarmOn && this.alert >= 100 && !this.goalDone) this.script?.onAlarm();
    this.alert = Math.max(0, this.alert - dt * (this.alarmOn ? ALERT_REST : this.rules.decay));
    if (this.alarmOn && this.alert <= ALERT_SAFE) this.script?.onCalm();
  }

  tick(dt) {
    this.t += dt;
    this.routeBudget = ROUTES_PER_TICK;
    if (this.webDirty > 0) {
      this.webDirty -= dt;
      if (this.webDirty <= 0) {
        this.webDirty = 0;
        this.webV++;
      }
    }
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
