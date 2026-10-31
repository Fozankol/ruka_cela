import { Bus, RNG, clamp, dist } from '../core/util.js';
import { bakeStaticLight, composeLight } from './light.js';
import { makeHuman, tickHuman } from './humans.js';

export const SPIDERS = {
  hero: { name: 'Мать', speed: 1.25, scale: 0.17, hp: 8, bite: 4, supply: 0 },
  ling: { name: 'Паучок', speed: 0.85, scale: 0.075, hp: 1, bite: 1, supply: 1, cost: 6, time: 3.5, key: 'Z', desc: 'Кусает, носит добычу, грызёт провода' },
  weaver: { name: 'Ткач', speed: 0.6, scale: 0.09, hp: 1, bite: 0, supply: 2, cost: 14, time: 6, key: 'X', desc: 'Плетёт паутину там, где стоит. Даёт шёлк' },
};

export const NEST_COST = 25;
export const NEST_TIME = 7;
const SUPPLY_BASE = 6;
const SUPPLY_PER_NEST = 12;
const WEAVE_RADIUS = 1.2;
const FLY_SOKI = 3;
const COCOON_LOAD = 5;
const STEP = { x: 0, z: 0 };

export class World {
  constructor(level, seed = 7) {
    this.level = level;
    this.grid = level.grid;
    this.rng = new RNG(seed);
    this.bus = new Bus();
    this.t = 0;
    this.res = { silk: 0, soki: 0 };
    this.stats = { bites: 0, clicks: 0, flies: 0, gathered: 0 };
    this.biteRate = 0.028;
    this.spiders = [];
    this.flies = [];
    this.food = null;
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
      hp: def.hp,
      dir: this.rng.range(-3.14, 3.14),
      order: null,
      on: null,
      load: 0,
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
    const built = this.nests.filter((n) => n.built >= 1).length;
    return built ? SUPPLY_BASE + built * SUPPLY_PER_NEST : 0;
  }

  // Заказ на рождение: соки списываются сразу, паук выходит из свободного гнезда.
  train(kind) {
    const def = SPIDERS[kind];
    if (!def?.cost || this.res.soki < def.cost) return 'Не хватает соков';
    if (this.supplyUsed() + def.supply > this.supplyCap()) return 'Рою тесно. Нужно новое гнездо';
    const ready = this.nests.filter((n) => n.built >= 1);
    if (!ready.length) return 'Нет гнезда';
    ready.sort((a, b) => a.queue.length - b.queue.length);
    this.res.soki -= def.cost;
    ready[0].queue.push({ kind, left: def.time, total: def.time });
    return null;
  }

  addNest(x, z, built = 1) {
    const n = { x, z, built, queue: [], field: this.grid.flow(x, z, 'spider') };
    this.nests.push(n);
    this.seedWeb(x, z, 3);
    this.bus.emit('nest', n);
    return n;
  }

  nearestNest(s) {
    let best = null;
    let bestD = Infinity;
    for (const n of this.nests) {
      if (n.built < 1) continue;
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
      if (!q) continue;
      q.left -= dt;
      if (q.left > 0) continue;
      n.queue.shift();
      const s = this.spawn(q.kind, n.x + this.rng.range(-0.2, 0.2), n.z + 0.15 + this.rng.range(0, 0.2));
      this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.5, kind: 'hatch' });
      this.bus.emit('trained', s);
      if (n.rally) this.command([s], { type: 'move', x: n.rally.x, z: n.rally.z });
    }
    // Даже после полного разгрома рой не исчезает: кладка понемногу даёт паучка даром.
    if (this.rts && this.nests.length && this.count('ling') === 0 && this.res.soki < SPIDERS.ling.cost) {
      this.freeT += dt;
      if (this.freeT > 14) {
        this.freeT = 0;
        const n = this.nests[0];
        this.spawn('ling', n.x, n.z + 0.2);
      }
    }
    if (this.rts && !this.hero && this.nests.length) {
      this.heroT = (this.heroT ?? 30) - dt;
      if (this.heroT <= 0) {
        this.heroT = 30;
        const n = this.nests[0];
        this.spawn('hero', n.x, n.z + 0.2);
        this.bus.emit('radio', { who: 'Рой', text: 'Новая мать выбралась из кокона.' });
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

  followField(s, field, speed, dt) {
    if (!field) return false;
    if (!this.grid.nextStep(field, s.x, s.z, STEP)) {
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
    const web = this.grid.web[this.grid.at(s.x, s.z)];
    const v = Math.min(speed * (1 + web * 0.3) * dt, d);
    s.x += (dx / d) * v;
    s.z += (dz / d) * v;
    s.dir = Math.atan2(dz, dx);
    s.moving = true;
    return d <= v + 0.01;
  }

  // Точка в кольцах вокруг цели, чтобы группа вставала строем, а не в одну кучу.
  slot(x, z, i) {
    const a = i * 2.4;
    const r = 0.1 * Math.sqrt(i);
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    return this.grid.spiderOk(this.grid.at(px, pz)) ? { x: px, z: pz } : { x, z };
  }

  // Единая точка входа для всех приказов игрока.
  command(list, cmd) {
    if (!list.length) return;
    const units = list.filter((s) => this.spiders.includes(s));
    const field = cmd.x !== undefined ? this.grid.flow(cmd.x, cmd.z, 'spider') : null;
    units.forEach((s, i) => {
      if (s.on) this.detach(s);
      this.releaseFly(s);
      switch (cmd.type) {
        case 'stop':
          s.order = null;
          break;
        case 'hide':
          s.order = { type: 'hide' };
          break;
        case 'move':
        case 'amove': {
          const p = this.slot(cmd.x, cmd.z, i);
          s.order = { type: cmd.type, x: p.x, z: p.z, field };
          break;
        }
        case 'attack':
          // Ткачи не кусаются: они подходят и остаются рядом.
          if (SPIDERS[s.kind].bite > 0) s.order = { type: 'attack', h: cmd.h };
          else s.order = { type: 'move', x: cmd.h.x, z: cmd.h.z, field: this.grid.flow(cmd.h.x, cmd.h.z, 'spider') };
          break;
        case 'gnaw':
          if (s.kind === 'ling') s.order = { type: 'gnaw' };
          break;
        case 'gather':
          if (s.kind === 'ling') s.order = { type: 'gather', src: cmd.src, c: cmd.c, phase: s.load > 0 ? 'back' : 'go', fly: null };
          break;
        case 'nest':
          if (s.kind === 'hero') s.order = { type: 'nest', x: cmd.x, z: cmd.z, field };
          break;
        default:
          break;
      }
    });
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
    const o = s.order;
    if (!o) return;
    switch (o.type) {
      case 'move':
      case 'amove':
        this.stepMove(s, o, def, dt);
        break;
      case 'attack':
        this.stepAttack(s, o, def, dt);
        break;
      case 'gnaw':
        this.stepGnaw(s, def, dt);
        break;
      case 'gather':
        this.stepGather(s, o, def, dt);
        break;
      case 'nest':
        this.stepBuild(s, o, def, dt);
        break;
      default:
        break;
    }
  }

  stepMove(s, o, def, dt) {
    if (o.type === 'amove') {
      o.look = (o.look ?? this.rng.next() * 0.3) - dt;
      if (o.look <= 0) {
        o.look = 0.3;
        for (const h of this.humans) {
          if (this.canBite(h) && dist(s.x, s.z, h.x, h.z) < 1.8) {
            s.order = { type: 'attack', h };
            return;
          }
        }
      }
    }
    const d = dist(s.x, s.z, o.x, o.z);
    if (d < 0.05) {
      s.order = null;
      return;
    }
    const steps = o.field[this.grid.at(s.x, s.z)];
    if (steps >= 0 && steps <= 3) {
      if (this.steer(s, o.x, o.z, def.speed, dt)) s.order = null;
    } else {
      this.followField(s, o.field, def.speed, dt);
    }
  }

  stepAttack(s, o, def, dt) {
    const h = o.h;
    if (!this.canBite(h)) {
      s.order = null;
      return;
    }
    if (dist(s.x, s.z, h.x, h.z) < 0.34 || (h.lie > 0.5 && dist(s.x, s.z, h.x, h.z - 0.8) < 0.95)) {
      s.on = h;
      s.order = null;
      s.ang = this.rng.range(0, 6.28);
      h.attached += def.bite;
      this.stats.bites++;
      return;
    }
    this.followField(s, this.huntField(h), def.speed * 1.1, dt);
  }

  stepGnaw(s, def, dt) {
    const w = this.wire;
    if (!w || w.done) {
      s.order = null;
      return;
    }
    const steps = w.field[this.grid.at(s.x, s.z)];
    if (steps > 3 && this.grid.nextStep(w.field, s.x, s.z, STEP)) {
      this.steer(s, STEP.x, STEP.z, def.speed, dt);
    } else if (this.steer(s, w.x + Math.cos(s.ang) * 0.2, w.z + Math.sin(s.ang) * 0.12, def.speed, dt)) {
      w.progress += dt * w.rate;
      w.chew = (w.chew ?? 0) - dt;
      if (w.chew <= 0) {
        w.chew = 0.35;
        this.bus.emit('ripple', { x: w.x, z: w.z, power: 0.45, kind: 'bite' });
      }
    }
  }

  // Паучок ходит между добычей и гнездом, пока не получит другой приказ.
  stepGather(s, o, def, dt) {
    if (o.phase === 'back') {
      const n = this.nearestNest(s);
      if (!n) {
        s.order = null;
        return;
      }
      if (dist(s.x, s.z, n.x, n.z) < 0.4) {
        this.res.soki += s.load;
        this.stats.gathered += s.load;
        s.load = 0;
        o.phase = 'go';
        this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.25, kind: 'hatch' });
        return;
      }
      this.followField(s, n.field, def.speed * 0.9, dt);
      return;
    }
    if (o.src === 'cocoon') {
      const c = o.c;
      if (c.left <= 0) {
        s.order = null;
        return;
      }
      if (dist(s.x, s.z, c.x, c.z) < 0.6) {
        const v = Math.min(COCOON_LOAD, c.left);
        c.left -= v;
        s.load = v;
        o.phase = 'back';
        return;
      }
      this.followField(s, c.field, def.speed, dt);
      return;
    }
    if (o.fly && !this.flies.includes(o.fly)) o.fly = null;
    if (!o.fly) {
      let best = null;
      let bestD = Infinity;
      for (const f of this.flies) {
        if (f.taken) continue;
        const d = dist(s.x, s.z, f.x, f.z);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      if (best) {
        best.taken = true;
        o.fly = best;
      }
    }
    const atFood = this.food && dist(s.x, s.z, this.food.x, this.food.z) < 1.1;
    if (o.fly && atFood) {
      if (this.steer(s, o.fly.x, o.fly.z, def.speed * 1.2, dt)) {
        this.flies = this.flies.filter((f) => f !== o.fly);
        this.stats.flies++;
        this.bus.emit('ripple', { x: o.fly.x, z: o.fly.z, power: 0.35, kind: 'bite' });
        this.bus.emit('flyEaten', o.fly);
        o.fly = null;
        s.load = FLY_SOKI;
        o.phase = 'back';
      }
    } else if (this.food && !atFood) {
      this.followField(s, this.food.field, def.speed, dt);
    }
  }

  // Мать садится и строит гнездо. Шёлк списывается в момент начала.
  stepBuild(s, o, def, dt) {
    if (dist(s.x, s.z, o.x, o.z) > 0.2) {
      this.followField(s, o.field, def.speed, dt);
      return;
    }
    if (!o.nest) {
      if (this.res.silk < NEST_COST) {
        s.order = null;
        this.bus.emit('notice', 'Нужно больше шёлка');
        return;
      }
      this.res.silk -= NEST_COST;
      o.nest = this.addNest(o.x, o.z, 0);
    }
    o.nest.built = Math.min(1, o.nest.built + dt / NEST_TIME);
    if (o.nest.built >= 1) {
      s.order = null;
      this.bus.emit('notice', 'Гнездо готово. Рою просторнее');
    }
  }

  releaseFly(s) {
    if (s.order?.fly) s.order.fly.taken = false;
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
    if (s.on) s.on.attached = Math.max(0, s.on.attached - SPIDERS[s.kind].bite);
    s.on = null;
    s.y = 0;
    if (!this.grid.spiderOk(this.grid.at(s.x, s.z))) this.grid.snapSpider(s);
    s.px = s.x;
    s.pz = s.z;
  }

  damage(s, n = 1) {
    s.hp -= n;
    if (s.hp <= 0) this.killSpider(s);
  }

  killSpider(s) {
    if (s.on) this.detach(s);
    this.releaseFly(s);
    this.spiders = this.spiders.filter((o) => o !== s);
    this.bus.emit('ripple', { x: s.x, z: s.z, power: 0.4, kind: 'death' });
    this.bus.emit('spiderDead', s);
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
    const r = 0.33;
    this.bus.emit('slipper', { x, z, phase: 'hit', life: 0.3 });
    this.bus.emit('ripple', { x, z, power: 1.6, kind: 'stomp' });
    this.bus.emit('shake', 0.9);
    // Тапок давит не больше трёх: иначе один удар сносил бы всю группу в тесной комнате.
    let kills = 0;
    for (const s of [...this.spiders]) {
      if (s.hidden || s.on || dist(s.x, s.z, x, z) >= r) continue;
      if (s.kind === 'hero') {
        this.damage(s, this.rts ? 3 : 99);
      } else if (kills < 3) {
        this.damage(s, 1);
        kills++;
      }
    }
  }

  onParalyzed(h) {
    this.bus.emit('human', { h, event: 'para' });
  }

  onCocoon(h) {
    const lying = h.lie > 0.5;
    const c = { x: h.x, z: lying ? h.z - h.height * 0.46 : h.z, lie: lying, h, left: 40 };
    c.field = this.grid.flow(c.x, c.z, 'spider');
    this.cocoons.push(c);
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
  }

  addFly(cx, cz) {
    this.flies.push({ cx, cz, x: cx, z: cz, y: 0.2, a: this.rng.range(0, 6), r: this.rng.range(0.1, 0.42), w: this.rng.range(1.6, 3), taken: false });
  }

  // Ткач плетёт вокруг себя, пока стоит без приказа.
  updateWeb(dt) {
    const g = this.grid;
    let weavers = 0;
    for (const s of this.spiders) {
      if (s.kind !== 'weaver') continue;
      weavers++;
      if (s.order || s.hidden) continue;
      let n = Math.floor(dt * 34 + this.rng.next());
      const r = WEAVE_RADIUS / g.cell;
      const cx = g.cx(s.x);
      const cz = g.cz(s.z);
      while (n-- > 0) {
        const a = this.rng.range(0, 6.283);
        const q = Math.sqrt(this.rng.next()) * r;
        const nx = cx + Math.round(Math.cos(a) * q);
        const nz = cz + Math.round(Math.sin(a) * q);
        if (!g.inb(nx, nz)) continue;
        const i = g.idx(nx, nz);
        if (!g.spiderOk(i) || g.lit(i) > 0.3) continue;
        if (g.web[i] === 0) this.webList.push(i);
        g.web[i] = Math.min(1, g.web[i] + 0.3);
      }
    }
    const built = this.nests.filter((n) => n.built >= 1).length;
    this.res.silk += dt * (0.25 * built + weavers * 0.55);
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
      h.fadeTarget = h.state === 'gone' || h.state === 'still' ? 0 : sense[i] > 0.5 || g.lit(i) > 0.2 ? 1 : 0;
    }
  }

  tick(dt) {
    this.t += dt;
    this.updateMarkField(dt);
    for (const s of [...this.spiders]) this.stepSpider(s, dt);
    for (const h of this.humans) tickHuman(this, h, dt);
    this.updateFlies(dt);
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
