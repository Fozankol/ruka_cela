import { Bus, RNG, angleLerp, clamp, dist } from '../core/util.js';
import { UPGRADES, upgradeCost } from '../content/upgrades.js';
import { bakeStaticLight, composeLight } from './light.js';
import { makeHuman, tickHuman } from './humans.js';

export const SPIDERS = {
  hero: { name: 'Мать', speed: 1.25, scale: 0.17, hp: 8, bite: 4, supply: 0 },
  fighter: { name: 'Боец', speed: 1.05, scale: 0.115, hp: 3, bite: 3, supply: 1, cost: 12, grow: 1.13, time: 5, desc: 'Ждёт нападения, потом кусает сам' },
  carrier: { name: 'Носильщик', speed: 0.95, scale: 0.085, hp: 2, bite: 0, supply: 1, cost: 5, grow: 1.16, time: 3, desc: 'Сам носит еду в гнездо' },
};

const HEAL_RADIUS = 1.1;
const STEP = { x: 0, z: 0 };

export class World {
  constructor(level, seed = 7) {
    this.level = level;
    this.grid = level.grid;
    this.rng = new RNG(seed);
    this.bus = new Bus();
    this.t = 0;
    this.res = { soki: 0 };
    this.stats = { bites: 0, clicks: 0, flies: 0, gathered: 0 };
    this.biteRate = 0.028;
    this.spiders = [];
    this.flies = [];
    this.foods = [];
    this.mods = { carry: 0, cap: 8, birth: 1, speed: 1, quiet: 1, bite: 0, hp: 0 };
    this.levels = {};
    this.suspicion = 0;
    this.income = 0;
    this.incomeT = 0;
    this.incomeSum = 0;
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
    this.flags = { resources: false, swarmBar: false };
    this.goal = null;
    this.wire = null;
    this.senseT = 0;
    this.lightT = 0;
    this.lightDirty = true;
    this.hero = null;
    this.rts = false;
    this.selectedCount = 0;
    this.hunt = new Map();
    this.freeT = 0;
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

  blackout() {
    for (const l of this.lights) {
      if (!l.moon && !l.dynamic && l.warm && l.on) {
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
      hp: def.hp + (kind === 'fighter' ? this.mods.hp : 0),
      maxHp: def.hp + (kind === 'fighter' ? this.mods.hp : 0),
      dir: this.rng.range(-3.14, 3.14),
      order: null,
      on: null,
      load: 0,
      restT: 0,
      climb: this.rng.next(),
      ang: this.rng.range(0, 6.28),
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
    this.bus.emit('spawned', s);
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

  supplyUsed() {
    let n = 0;
    for (const s of this.spiders) n += SPIDERS[s.kind].supply;
    for (const nest of this.nests) for (const q of nest.queue) n += SPIDERS[q.kind].supply;
    return n;
  }

  supplyCap() {
    return this.nests.length ? this.mods.cap : 0;
  }

  // Цена растёт с каждым пауком этого вида.
  unitCost(kind) {
    const def = SPIDERS[kind];
    let owned = this.count(kind);
    for (const n of this.nests) for (const q of n.queue) if (q.kind === kind) owned++;
    return Math.round(def.cost * def.grow ** owned);
  }

  train(kind) {
    const def = SPIDERS[kind];
    const cost = this.unitCost(kind);
    if (this.res.soki < cost) return 'Не хватает соков';
    if (this.supplyUsed() + def.supply > this.supplyCap()) return 'В гнезде нет места';
    const n = this.nests[0];
    if (!n) return 'Нет гнезда';
    this.res.soki -= cost;
    const time = def.time * this.mods.birth;
    n.queue.push({ kind, left: time, total: time });
    this.raiseSuspicion(0.4);
    return null;
  }

  buyUpgrade(id) {
    const u = UPGRADES.find((x) => x.id === id);
    const level = this.levels[id] ?? 0;
    if (!u || level >= u.max) return 'Максимум';
    const cost = upgradeCost(u, level);
    if (this.res.soki < cost) return 'Не хватает соков';
    this.res.soki -= cost;
    this.levels[id] = level + 1;
    u.apply(this.mods, this);
    const n = this.nests[0];
    if (n) this.seedWeb(n.x, n.z, 3 + Object.values(this.levels).reduce((a, b) => a + b, 0));
    this.bus.emit('upgrade', id);
    return null;
  }

  raiseSuspicion(v) {
    this.suspicion = clamp(this.suspicion + v * this.mods.quiet, 0, 100);
  }

  addFood(def) {
    const food = { open: true, stock: def.max ?? 0, ...def, field: this.grid.flow(def.x, def.z, 'spider') };
    this.foods.push(food);
    return food;
  }

  // Открывает следующий закрытый источник еды.
  openFood() {
    const f = this.foods.find((x) => !x.open);
    if (!f) return;
    f.open = true;
    this.revealRoom(f.room);
    this.bus.emit('notice', 'Открыто: ' + f.name);
  }

  strength() {
    let v = 0;
    for (const s of this.spiders) if (s.kind === 'fighter') v += SPIDERS.fighter.bite + this.mods.bite;
    return v;
  }

  addNest(x, z) {
    const n = { x, z, built: 1, queue: [], field: this.grid.flow(x, z, 'spider') };
    this.nests.push(n);
    this.seedWeb(x, z, 3);
    this.bus.emit('nest', n);
    return n;
  }

  nearestNest(s) {
    let best = null;
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

  updateNests(dt) {
    for (const n of this.nests) {
      const q = n.queue[0];
      if (q) {
        q.left -= dt;
        if (q.left <= 0) {
          n.queue.shift();
          const s = this.spawn(q.kind, n.x - 0.3 + this.rng.range(-0.15, 0.15), n.z + 0.35 + this.rng.range(0, 0.2));
          this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.5, kind: 'hatch' });
          this.bus.emit('trained', s);
        }
      }
      // В гнезде раны затягиваются: раненых выгодно отводить домой.
      for (const s of this.spiders) {
        if (s.hp < s.maxHp && dist(s.x, s.z, n.x, n.z) < HEAL_RADIUS) s.hp = Math.min(s.maxHp, s.hp + dt * 0.4);
      }
    }
    // Без носильщиков экономика встала бы навсегда: кладка понемногу даёт одного даром.
    if (this.rts && this.nests.length && this.count('carrier') === 0 && this.res.soki < this.unitCost('carrier')) {
      this.freeT += dt;
      if (this.freeT > 12) {
        this.freeT = 0;
        const n = this.nests[0];
        this.spawn('carrier', n.x - 0.3, n.z + 0.35);
      }
    }
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
    const web = this.grid.web[this.grid.at(s.x, s.z)];
    const want = Math.min(speed * (1 + web * 0.25), d / Math.max(dt, 1e-3));
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

  huntField(h) {
    let c = this.hunt.get(h);
    if (!c || this.t - c.t > 0.5) {
      c = { t: this.t, field: this.grid.flow(h.x, h.z, 'spider') };
      this.hunt.set(h, c);
    }
    return c.field;
  }

  canBite(h) {
    return h.huntable && !['cocoon', 'gone', 'still'].includes(h.state);
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
    if (s.on) {
      this.stepAttached(s, dt);
      return;
    }
    const speed = def.speed * this.mods.speed;
    if (!s.order && s.kind === 'carrier') this.autoWork(s, dt);
    const o = s.order;
    if (!o) return;
    if (o.type === 'move') this.stepMove(s, o, speed, dt);
    else if (o.type === 'attack') this.stepAttack(s, o, speed, dt);
    else if (o.type === 'gnaw') this.stepGnaw(s, speed, dt);
    else if (o.type === 'gather') this.stepGather(s, o, speed, dt);
  }

  // К еде рядом с человеком с фонарём носильщики не суются.
  foodSafe(f) {
    for (const h of this.humans) if (h.torch && dist(h.x, h.z, f.x, f.z) < 2.2) return false;
    return true;
  }

  // Носильщик сам выбирает самую выгодную еду с учётом дороги.
  autoWork(s, dt) {
    s.restT -= dt;
    if (s.restT > 0) return;
    let best = null;
    let bestV = 0;
    for (const f of this.foods) {
      if (!f.open || f.stock <= 0 || !this.foodSafe(f)) continue;
      const v = f.value / (2 + dist(s.x, s.z, f.x, f.z));
      if (v > bestV) {
        bestV = v;
        best = f;
      }
    }
    if (best) s.order = { type: 'gather', food: best, phase: 'go' };
  }

  stepMove(s, o, speed, dt) {
    if (dist(s.x, s.z, o.x, o.z) < 0.5) {
      if (this.steer(s, o.x, o.z, speed, dt)) s.order = null;
      return;
    }
    this.followField(s, o.field, speed, dt);
  }

  stepAttack(s, o, speed, dt) {
    const h = o.h;
    if (!this.canBite(h)) {
      s.order = null;
      return;
    }
    if (dist(s.x, s.z, h.x, h.z) < 0.36 || (h.lie > 0.5 && dist(s.x, s.z, h.x, h.z - 0.8) < 0.95)) {
      s.on = h;
      s.order = null;
      s.ang = this.rng.range(0, 6.28);
      s.biteNow = SPIDERS[s.kind].bite + this.mods.bite;
      h.attached += s.biteNow;
      this.stats.bites++;
      this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.5, kind: 'bite' });
      return;
    }
    this.followField(s, this.huntField(h), speed, dt);
  }

  stepGnaw(s, speed, dt) {
    const w = this.wire;
    if (!w || w.done) {
      s.order = null;
      return;
    }
    if (dist(s.x, s.z, w.x, w.z) > 0.42) {
      this.followField(s, w.field, speed, dt);
      return;
    }
    this.steer(s, w.x + Math.cos(s.ang) * 0.24, w.z + Math.sin(s.ang) * 0.14, speed, dt);
    w.progress += dt * w.rate;
    w.chew = (w.chew ?? 0) - dt;
    if (w.chew <= 0) {
      w.chew = 0.35;
      this.bus.emit('ripple', { x: w.x, z: w.z, power: 0.45, kind: 'bite' });
    }
  }

  // Носильщик ходит между едой и гнездом сам.
  stepGather(s, o, speed, dt) {
    if (o.phase === 'back') {
      const n = this.nearestNest(s);
      if (!n) {
        s.order = null;
        return;
      }
      if (dist(s.x, s.z, n.x, n.z) < 0.42) {
        this.res.soki += s.load;
        this.stats.gathered += s.load;
        this.incomeSum += s.load;
        this.raiseSuspicion(0.2);
        this.bus.emit('deposit', { x: s.x, z: s.z, v: s.load });
        this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.25, kind: 'hatch' });
        s.load = 0;
        s.order = null;
        s.restT = 0;
        return;
      }
      this.followField(s, n.field, speed * 0.85, dt);
      return;
    }
    const f = o.food;
    if (f.stock <= 0 || !this.foodSafe(f)) {
      s.order = null;
      s.restT = 1;
      return;
    }
    if (dist(s.x, s.z, f.x, f.z) < 0.5) {
      f.stock -= 1;
      s.load = f.value + this.mods.carry;
      o.phase = 'back';
      this.bus.emit('ripple', { x: f.x, z: f.z, power: 0.3, kind: 'bite' });
      return;
    }
    this.followField(s, f.field, speed, dt);
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
    if (s.on) s.on.attached = Math.max(0, s.on.attached - (s.biteNow ?? 0));
    s.on = null;
    s.y = 0;
    if (!this.grid.spiderOk(this.grid.at(s.x, s.z))) this.grid.snapSpider(s);
    s.px = s.x;
    s.pz = s.z;
  }

  damage(s, n = 1) {
    s.hp -= n;
    this.bus.emit('hurt', s);
    if (s.hp <= 0) this.killSpider(s);
  }

  killSpider(s) {
    if (s.on) this.detach(s);
    this.spiders = this.spiders.filter((o) => o !== s);
    this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.4, kind: 'death' });
    this.bus.emit('spiderDead', s);
    if (s.kind === 'carrier') {
      this.bus.emit('notice', 'Носильщика раздавили!');
      this.raiseSuspicion(3);
    }
    if (s === this.hero) {
      this.hero = null;
      this.bus.emit('heroDead');
    }
  }

  swat(h) {
    for (const s of this.spiders) {
      if (s.on === h) {
        this.damage(s, 1);
        return;
      }
    }
  }

  slipperHit(h, x, z) {
    const r = 0.36;
    this.bus.emit('slipper', { x, z, phase: 'hit', life: 0.3 });
    this.bus.emit('ripple', { x, z, power: 1.6, kind: 'stomp' });
    this.bus.emit('shake', 0.9);
    for (const s of [...this.spiders]) {
      if (s.hidden || s.on || dist(s.x, s.z, x, z) >= r) continue;
      if (s.kind === 'hero' && !this.rts) this.damage(s, 99);
      else this.damage(s, 2);
    }
  }

  onParalyzed(h) {
    this.bus.emit('human', { h, event: 'para' });
  }

  onCocoon(h) {
    const lying = h.lie > 0.5;
    const c = this.addFood({ x: h.x, z: lying ? h.z - h.height * 0.46 : h.z, value: 6, stock: 8, regen: 0, name: 'Кокон', cocoon: true });
    c.h = h;
    this.cocoons.push(c);
    this.level.population -= 1;
    this.dread = (this.dread ?? 0) + 0.12;
    this.bus.emit('human', { h, event: 'cocoon' });
    this.bus.emit('population', this.level.population);
    for (const s of this.spiders) if (s.on === h) this.detach(s);
    this.script?.onCocoon?.(h);
  }

  // Источники пополняются, мухи вокруг них показывают, что там есть еда.
  updateFoods(dt) {
    for (const f of this.foods) {
      if (!f.open || !f.regen) continue;
      f.stock = Math.min(f.max, f.stock + f.regen * dt);
      if (!f.bugs) continue;
      const want = Math.min(6, Math.floor(f.stock));
      let have = 0;
      for (const b of this.flies) if (b.food === f) have++;
      if (have < want) this.addFly(f);
      else if (have > want) this.flies.splice(this.flies.findIndex((b) => b.food === f), 1);
    }
    for (const b of this.flies) {
      b.a += dt * b.w;
      b.x = b.cx + Math.cos(b.a) * b.r;
      b.z = b.cz + Math.sin(b.a * 1.3) * b.r;
      b.y = 0.1 + Math.abs(Math.sin(b.a * 2.1)) * 0.35;
    }
    this.incomeT += dt;
    if (this.incomeT >= 5) {
      this.income = this.incomeSum / this.incomeT;
      this.incomeT = 0;
      this.incomeSum = 0;
    }
    this.suspicion = Math.max(0, this.suspicion - dt * 0.15);
  }

  addFly(food) {
    const cx = food.x + this.rng.range(-0.25, 0.25);
    const cz = food.z + this.rng.range(-0.25, 0.25);
    this.flies.push({ food, cx, cz, x: cx, z: cz, y: 0.2, a: this.rng.range(0, 6), r: this.rng.range(0.1, 0.42), w: this.rng.range(1.6, 3) });
  }

  // Паутина сама понемногу разрастается от гнезда.
  updateWeb(dt) {
    const g = this.grid;
    if (!this.webList.length) return;
    let n = Math.floor(dt * 4 * this.nests.length + this.rng.next());
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
  }

  // Пауки расталкивают друг друга, поэтому не стоят в одной точке.
  separate(dt) {
    const list = this.spiders;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.hidden || a.on) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.hidden || b.on) continue;
        const min = (SPIDERS[a.kind].scale + SPIDERS[b.kind].scale) * 0.9;
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
    for (const s of this.spiders) stampR(s, 14);
    for (const h of this.humans) {
      const i = g.at(h.x, h.z);
      h.fadeTarget = h.state === 'gone' || h.state === 'still' ? 0 : sense[i] > 0.5 || g.lit(i) > 0.2 ? 1 : 0;
    }
  }

  tick(dt) {
    this.t += dt;
    this.updateMarkField(dt);
    for (const s of [...this.spiders]) this.stepSpider(s, dt);
    this.separate(dt);
    for (const h of this.humans) tickHuman(this, h, dt);
    this.updateFoods(dt);
    this.updateWeb(dt);
    this.updateNests(dt);
    if (this.wire && !this.wire.done && this.wire.progress >= 1) this.wire.done = true;
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
