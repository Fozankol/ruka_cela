import { dist } from '../../core/util.js';
import { dropTorch, giveTorch, goTo, setState } from '../../sim/humans.js';
import { LIT, OutdoorScript } from './outdoor.js';

const GNAWER_COST = 24;
const GNAWER_STEP = 12;
const DOG_RADIUS = 3.4;
const DOG_SPEED = 3.4;
const DOG_RUN = 5;
const FIX_TIME = 8;
const SIEGE = 7;
const CAUGHT = 3;
const SPRAY_TIME = 32;
const SPRAY_R = 5;
const LOOK_TIME = 9;

// Сколько слухов приносит каждое событие. При 100 приезжает дезинсектор.
const RUMOR = { pole: 4, take: 11, escape: 20, warn: 10, bark: 0.5 };

// Улица: нить тянется от гнезда, свет её сжигает, а каждый взятый дом видят соседи.
export class StreetScript extends OutdoorScript {
  begin() {
    const { w } = this;
    const L = w.level;
    this.paints = true;
    this.alertLabel = 'Слухи';
    this.fallen = 1;
    this.total = L.zones.length;
    this.boughtGnawers = 0;
    this.taught = 0;
    this.caught = 0;
    this.escaped = 0;
    this.fix = null;
    this.fixT = 24;
    this.spray = null;
    this.patrolT = 0;
    this.lookers = [];
    this.rumorK = 1.4;
    w.silk = w.rules.silkStart;
    w.poles = L.poles.map((p) => ({ ...p, cut: false, gnaw: null, field: w.grid.flow(p.x, p.z, 'spider'), fieldV: -1 }));
    this.houses = L.zones.map((z, i) => {
      const def = L.cfg.houses[i];
      const pole = w.poles.find((p) => p.zone === i) ?? null;
      const door = L.doors[i];
      return { i, z, def, pole, door: { ...door, fieldV: -1, field: null }, state: i === 0 ? 'ours' : 'lit', t: 0, warned: false, people: w.humans.filter((h) => h.house === i) };
    });
    for (const house of this.houses) {
      if (!house.pole) continue;
      const value = Math.round((5 + dist(house.pole.x, house.pole.z, L.points.nest.x, L.points.nest.z) * 0.09) * (house.def.trait === 'pantry' ? 2 : 1));
      for (const spot of house.z.yard) w.addTreatAt(spot, { zone: house.i, locked: true, value });
    }
    const n = L.points.nest;
    w.spawn('gnawer', n.x + 0.8, n.z + 1.2);
    const r = L.dogRoad;
    w.dogs = [{ x: r.x0, z: r.z, roadZ: r.z, x0: r.x0, x1: r.x1, way: 1, wait: 0, dir: 0, moving: true, angry: false, bark: 0, down: false, gone: false, prey: null, tear: 0 }];
    w.setObjective('Зажми мышь и тяни от паутины к соседнему дому. По нити рой бежит быстрее, и его не видно.');
  }

  moodFloor() {
    return this.spray || this.houses?.some((h) => h.state === 'siege') ? 0.9 : this.fix ? 0.5 : 0;
  }

  summary() {
    return `Поймано людей: ${this.caught}. Сбежало: ${this.escaped}.`;
  }

  rumor(v) {
    const { w } = this;
    w.alert = Math.min(100, w.alert + v * this.rumorK);
  }

  progress() {
    return (this.fallen - 1) / (this.total - 1);
  }

  meter() {
    return { label: 'Дома', text: `${this.fallen} / ${this.total}`, share: this.fallen / this.total };
  }

  gnawerCost() {
    return GNAWER_COST + this.boughtGnawers * GNAWER_STEP;
  }

  actions() {
    const { w } = this;
    const cost = this.gnawerCost();
    const wc = this.widowCost();
    return [
      {
        label: `Грызун: ${cost} еды`,
        disabled: w.food < cost || w.count('gnawer') >= 3,
        run: () => {
          if (w.food < cost) return;
          w.food -= cost;
          this.boughtGnawers++;
          const n = w.nests[0];
          w.spawn('gnawer', n.x + 0.8, n.z + 1.2);
        },
      },
      {
        label: `Вдова: ${wc} еды`,
        disabled: w.food < wc || w.count('widow') >= 2,
        run: () => this.buyWidow(),
      },
    ];
  }

  freeGnawer(p) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.w.spiders) {
      if (s.kind !== 'gnawer' || s.hidden || s.order) continue;
      const d = dist(s.x, s.z, p.x, p.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  huntable() {
    const { w } = this;
    const out = w.humans.filter((h) => h.state !== 'gone' && h.state !== 'para' && h.state !== 'cocoon' && h.fade > 0.2);
    for (const d of w.dogs) if (!d.down) out.push(d);
    return out;
  }

  targets() {
    const { w } = this;
    const out = [];
    for (const p of w.poles) {
      if (p.cut || p.dead) continue;
      out.push({ x: p.x, z: p.z, busy: !!p.gnaw, label: p.gnaw ? 'Грызун уже здесь' : 'Перегрызть столб', run: () => this.clickPole(p) });
    }
    for (const house of this.houses) {
      if (house.state === 'dark' && w.onWeb(house.door.x, house.door.z)) {
        out.push({ x: house.door.x, z: house.door.z, hot: true, label: 'Ворваться в дом', run: () => this.invade(house) });
      }
    }
    if (w.count('widow')) {
      for (const h of this.huntable()) out.push({ x: h.x, z: h.z, small: true, label: h.prey !== undefined ? 'Укусить собаку' : `Укусить: ${h.name}`, run: () => this.hunt(h) });
    }
    return out;
  }

  clickPole(p) {
    const { w } = this;
    if (p.gnaw) return;
    const s = this.freeGnawer(p);
    if (!s) {
      w.bus.emit('notice', 'Все Грызуны заняты');
      return;
    }
    w.sendGnaw(s, p);
    w.stats.clicks++;
    w.bus.emit('order', { x: p.x, z: p.z });
  }

  circles() {
    const { w } = this;
    const out = [];
    for (const d of w.dogs) if (!d.down) out.push({ x: d.x, z: d.z, r: DOG_RADIUS, hot: d.angry });
    if (this.fix?.working) out.push({ x: this.fix.pole.x, z: this.fix.pole.z, r: 3, hot: true });
    return out;
  }

  clouds() {
    const s = this.spray;
    return s ? [{ x: s.h.x, z: s.h.z, r: SPRAY_R * 1.3 }] : [];
  }

  labels() {
    const out = [];
    for (const house of this.houses) {
      if (!house.def) continue;
      const left = house.people.filter((h) => h.state === 'gone').length;
      if (house.state === 'taken') {
        out.push({ x: house.z.x, y: 5, z: house.z.z, text: 'Под шёлком', cls: 'mine' });
        continue;
      }
      const state = house.state === 'siege' ? `Захват ${Math.max(0, Math.ceil(house.t))}` : house.warned ? 'Предупреждены' : house.state === 'dark' ? 'Без света' : '';
      out.push({ x: house.z.x, y: 5, z: house.z.z, text: house.def.name, sub: house.def.hint, note: [`Людей: ${left}`, state].filter(Boolean).join(' · ') });
    }
    return out;
  }

  // Первый удар о свет объясняет, зачем нужен Грызун.
  onLightBlock() {
    if (this.taught !== 0) return;
    this.taught = 1;
    this.w.setObjective('Нить сгорает в свете столба. Кликни по жёлтому кругу у столба: Грызун перережет провод.');
  }

  onPoleCut(p) {
    const { w } = this;
    const house = this.houses[p.zone];
    w.setLamp(p.id, false);
    w.bus.emit('flash', { dim: true });
    w.bus.emit('ripple', { x: p.x, z: p.z, power: 1, kind: 'stomp' });
    this.rumor(RUMOR.pole);
    for (const t of w.treats) if (t.zone === p.zone) t.locked = false;
    if (house.state === 'lit') house.state = 'dark';
    this.checkOutside(house);
    if (this.taught < 2) {
      this.taught = 2;
      w.setObjective('Дом без света. Заплети дорогу до двери и окружи её: кто побежит по нитям, тот застрянет. Потом кликни по красному кругу.');
    }
  }

  // Жилец выходит посмотреть, что случилось со светом.
  checkOutside(house) {
    const { w } = this;
    const h = house.people.find((x) => x.state === 'gone');
    if (!h) return;
    this.emerge(h, house.door);
    h.home = house.door;
    h.net = true;
    h.brain = null;
    h.torch.radius = 3.6 * w.level.unitK;
    goTo(w, h, house.pole.x, house.pole.z + 1.2, () => {
      this.lookers.push({ h, t: 3 });
    }, h.speed);
    w.bus.emit('radio', { who: 'Сосед', text: 'Опять свет пропал. Схожу гляну, что там.' });
  }

  invade(house) {
    const { w } = this;
    if (house.state !== 'dark') return;
    house.state = 'siege';
    house.t = SIEGE * (house.warned ? 1.7 : 1);
    house.door.field = w.grid.flow(house.door.x, house.door.z, 'spider');
    w.stats.clicks++;
    w.bus.emit('order', { x: house.door.x, z: house.door.z, attack: true });
    w.bus.emit('radio', { who: house.def.who, text: 'Что это шуршит в стенах?!' });
    for (const s of w.spiders) {
      if (s.kind !== 'carrier' && s.kind !== 'gnawer') continue;
      if (s.order || s.load) continue;
      s.order = { type: 'move', x: house.door.x, z: house.door.z, field: house.door.field };
    }
    const guard = house.people.find((h) => h.state === 'gone');
    if (guard) {
      this.emerge(guard, house.door);
      guard.net = true;
      guard.home = house.door;
      guard.brain = (world, hm) => {
        hm.pause = 0.6;
      };
    }
  }

  takeHouse(house) {
    const { w } = this;
    house.state = 'taken';
    this.fallen++;
    w.level.population = Math.max(0, w.level.population - house.people.length);
    if (house.pole) house.pole.dead = true;
    if (this.fix?.pole === house.pole) this.dismiss();
    w.bus.emit('zone', { index: house.i, world: w, noWeb: true });
    w.bus.emit('shake', 0.45);
    w.bus.emit('scream', house.door);
    this.rumor(RUMOR.take);
    this.seedLater = { house, t: 6 };
    for (const h of house.people) {
      if (h.state === 'gone') {
        this.appear(h, house.door);
        h.home = house.door;
      }
      if (h.state !== 'para' && h.state !== 'cocoon') this.flee(h);
    }
    this.applyTrait(house);
    for (const s of w.spiders) if (s.order?.type === 'move') s.order = null;
    this.neighbors(house);
    if (this.fallen === 2) w.setObjective('Жильцы бегут к соседям. Кто доберётся, поднимет всех. Слухи растут, при 100 приедет дезинсектор. Вдова укусит того, по кому кликнешь.');
    if (this.fallen >= this.total) this.complete();
  }

  applyTrait(house) {
    const { w } = this;
    const t = house.def.trait;
    if (t === 'dog') {
      for (const d of w.dogs) d.gone = d.down = true;
      w.bus.emit('notice', 'Собаку увели. Дорога свободна');
    } else if (t === 'electric') {
      this.noFix = true;
      if (this.fix) this.dismiss();
      w.bus.emit('notice', 'Электрика больше не будет');
    } else if (t === 'police') {
      this.rumorK = 0.7;
      w.bus.emit('notice', 'Участковый молчит. Слухи ползут медленнее');
    } else if (t === 'pantry') {
      w.food += 30;
      w.bus.emit('notice', 'Кладовая: +30 еды');
    }
  }

  // Беглец идёт к ближайшему светлому дому, а если таких нет, прочь с улицы.
  flee(h) {
    const { w } = this;
    const lit = this.houses.filter((x) => x.state === 'lit' || x.state === 'dark').sort((a, b) => dist(a.door.x, a.door.z, h.x, h.z) - dist(b.door.x, b.door.z, h.x, h.z))[0];
    const e = w.level.points.road;
    const t = lit ? lit.door : e;
    h.flee = true;
    h.net = true;
    h.aggressive = false;
    h.brain = null;
    h.stuck = 0;
    dropTorch(w, h);
    h.speed = 1.5 * w.level.speedK;
    goTo(w, h, t.x, t.z, () => this.onEscaped(h, lit), h.speed);
  }

  onEscaped(h, house) {
    const { w } = this;
    h.flee = false;
    h.net = false;
    setState(h, 'gone');
    this.escaped++;
    if (house && house.state !== 'taken') {
      house.warned = true;
      house.people.push(h);
      h.house = house.i;
      this.rumor(RUMOR.warn);
      w.bus.emit('notice', `${house.def.name}: соседи предупреждены`);
    } else {
      this.rumor(RUMOR.escape);
      w.bus.emit('notice', 'Беглец ушёл с улицы и рассказывает всем');
    }
  }

  // Соседи выходят на крыльцо и смотрят: мир этих людей рушится на их глазах.
  neighbors(from) {
    const { w } = this;
    for (const house of this.houses) {
      if (house === from || (house.state !== 'lit' && house.state !== 'dark')) continue;
      const h = house.people.find((x) => x.state === 'gone');
      if (!h) continue;
      this.emerge(h, house.door);
      h.home = house.door;
      h.net = true;
      this.lookers.push({ h, t: LOOK_TIME });
    }
    w.bus.emit('radio', { who: from.def.who, text: 'Они в доме! Бегите! Зовите всех!' });
  }

  onBite(p) {
    const { w } = this;
    if (p.prey !== undefined) {
      p.down = true;
      p.moving = false;
      w.bus.emit('notice', 'Собака замотана');
      w.bus.emit('human', { h: { x: p.x, z: p.z, height: 1.6, lie: 0 }, event: 'cocoon' });
      w.food += 15;
      return;
    }
    if (this.spray?.h === p) {
      this.spray = null;
      p.crew = 'spent';
      w.alert = Math.max(0, w.alert - 30);
      w.bus.emit('notice', 'Дезинсектор в коконе');
    }
    if (this.fix?.h === p) {
      this.fix = null;
      this.fixT = 40;
      w.bus.emit('notice', 'Электрик в коконе');
    }
    this.wrap(p);
  }

  onCocoon() {
    const { w } = this;
    this.caught++;
    w.food += 12;
    w.bus.emit('deposit', { x: w.nests[0].x, z: w.nests[0].z, v: 12 });
  }

  updateNet(dt) {
    const { w } = this;
    for (const h of w.humans) {
      if (!h.net || h.state === 'gone' || h.state === 'para' || h.state === 'cocoon') continue;
      if (w.onWeb(h.x, h.z)) h.stuck = (h.stuck ?? 0) + dt;
      else h.stuck = Math.max(0, (h.stuck ?? 0) - dt * 0.5);
      if (h.stuck >= CAUGHT) {
        this.wrap(h);
        w.bus.emit('notice', `${h.name} застрял в паутине`);
      }
    }
  }

  updateDogs(dt) {
    const { w } = this;
    const g = w.grid;
    for (const d of w.dogs) {
      if (d.down) continue;
      // Поймав паука, собака занята им: в это время дорогу можно перейти.
      if ((d.rest ?? 0) > 0) {
        d.rest -= dt;
        d.moving = false;
        d.angry = false;
        continue;
      }
      // Паук вне нити виден собаке. Она бросается за ним, а потом возвращается на дорогу.
      let prey = null;
      let best = DOG_RADIUS;
      for (const s of w.spiders) {
        if (s.hidden || s.perched || w.onWeb(s.x, s.z)) continue;
        const dd = dist(s.x, s.z, d.x, d.z);
        if (dd < best) {
          best = dd;
          prey = s;
        }
      }
      d.angry = !!prey;
      d.bark -= dt;
      if (prey) {
        const k = (DOG_RUN * dt) / Math.max(best, 0.01);
        const nx = d.x + (prey.x - d.x) * k;
        const nz = d.z + (prey.z - d.z) * k;
        if (g.humanOk(g.at(nx, d.z))) d.x = nx;
        if (g.humanOk(g.at(d.x, nz))) d.z = nz;
        d.dir = Math.atan2(prey.z - d.z, prey.x - d.x);
        d.moving = true;
        if (best < 0.9) {
          w.damage(prey, 99);
          d.rest = 8;
          w.bus.emit('notice', 'Собака поймала паука');
        }
        if (d.bark <= 0) {
          d.bark = 0.9;
          w.bus.emit('bark', d);
          this.rumor(RUMOR.bark);
        }
        continue;
      }
      if (Math.abs(d.z - d.roadZ) > 0.2) {
        const k = Math.min(1, (DOG_SPEED * dt) / Math.abs(d.z - d.roadZ));
        d.z += (d.roadZ - d.z) * k;
        d.dir = d.z < d.roadZ ? Math.PI / 2 : -Math.PI / 2;
        d.moving = true;
        continue;
      }
      d.moving = d.wait <= 0;
      if (d.wait > 0) {
        d.wait -= dt;
      } else {
        d.x += d.way * DOG_SPEED * dt;
        d.dir = d.way > 0 ? 0 : Math.PI;
        if (d.x > d.x1 || d.x < d.x0) {
          d.way = d.x > d.x1 ? -1 : 1;
          d.wait = 1.6;
        }
      }
      // Там, где собака идёт по дороге, она рвёт нити лапами.
      d.tear -= dt;
      if (d.tear <= 0 && w.onWeb(d.x, d.z)) {
        d.tear = 0.3;
        w.eraseWeb(d.x, d.z, 6);
      }
    }
  }

  // Зажжённый столб выжигает нити в своём круге.
  burnLit() {
    const { w } = this;
    const g = w.grid;
    w.bakeLight();
    let n = 0;
    for (let i = 0; i < g.n; i++) {
      if (g.web[i] > 0 && g.lightW[i] > LIT) {
        g.web[i] = 0;
        n++;
      }
    }
    if (n) w.touchWeb();
  }

  // Со второго дома электрик идёт к разрезанному столбу, пока дом ещё не взят.
  updateElectric(dt) {
    const { w } = this;
    if (this.noFix) return;
    if (this.fix) {
      const f = this.fix;
      if (f.working) {
        f.t -= dt;
        if (f.t <= 0) {
          f.pole.cut = false;
          w.setLamp(f.pole.id, true);
          for (const t of w.treats) if (t.zone === f.pole.zone) t.locked = true;
          const house = this.houses[f.pole.zone];
          if (house.state === 'dark') house.state = 'lit';
          this.burnLit();
          w.bus.emit('notice', 'Электрик починил столб. Нити в свете сгорели');
          this.dismiss();
        }
      }
      return;
    }
    if (this.fallen < 2) return;
    this.fixT -= dt;
    const broken = w.poles.filter((p) => p.cut && !p.dead && this.houses[p.zone].state === 'dark');
    if (this.fixT > 0 || !broken.length) return;
    this.fixT = 38;
    const pole = w.rng.pick(broken);
    const h = w.humans.find((x) => x.crew === 'electric');
    if (!h || h.state === 'para' || h.state === 'cocoon') return;
    this.appear(h, w.level.points.road);
    h.speed = 1.1 * w.level.speedK;
    giveTorch(w, h);
    h.torch.radius = 3.4 * w.level.unitK;
    this.fix = { h, pole, working: false, t: FIX_TIME };
    w.say('Приехал электрик. Он починит разрезанный столб.', { ms: 3000 });
    goTo(w, h, pole.x, pole.z + 1, () => {
      if (this.fix) this.fix.working = true;
    }, h.speed);
  }

  dismiss() {
    const { w } = this;
    const { h } = this.fix;
    this.fix = null;
    const e = w.level.points.road;
    goTo(w, h, e.x, e.z, () => {
      dropTorch(w, h);
      setState(h, 'gone');
    }, h.speed);
  }

  // При 100 слухов приезжает дезинсектор: туман убирает нити и убивает пауков.
  onAlarm() {
    const { w } = this;
    w.alert = 35;
    const h = w.humans.find((x) => x.crew === 'spray');
    if (this.spray || !h || h.state === 'para' || h.state === 'cocoon') return;
    this.appear(h, w.level.points.road);
    h.speed = 1 * w.level.speedK;
    this.spray = { h, t: SPRAY_TIME, puff: 0, walk: 0 };
    w.say('Приехал дезинсектор!', { big: true, ms: 2200 });
    w.bus.emit('alarm');
    w.bus.emit('radio', { who: 'Диспетчер', text: 'Бригада выехала. Просьба окна закрыть, дышать через раз.' });
  }

  nearestWeb(h) {
    const { w } = this;
    const g = w.grid;
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k < w.webList.length; k += 3) {
      const i = w.webList[k];
      if (g.web[i] <= 0) continue;
      const cx = i % g.w;
      const x = g.wx(cx);
      const z = g.wz((i - cx) / g.w);
      const d = dist(x, z, h.x, h.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    const cx = best % g.w;
    return { x: g.wx(cx), z: g.wz((best - cx) / g.w) };
  }

  updateSpray(dt) {
    const { w } = this;
    const s = this.spray;
    if (!s) return;
    const { h } = s;
    s.t -= dt;
    s.puff -= dt;
    if (s.puff <= 0) {
      s.puff = 0.4;
      w.eraseWeb(h.x, h.z, Math.round(SPRAY_R / w.grid.cell));
      for (const p of [...w.spiders]) {
        if (!p.hidden && dist(p.x, p.z, h.x, h.z) < SPRAY_R) w.damage(p, 99);
      }
    }
    if (s.t <= 0) {
      this.spray = null;
      const e = w.level.points.road;
      goTo(w, h, e.x, e.z, () => setState(h, 'gone'), h.speed);
      w.bus.emit('notice', 'Дезинсектор уехал. Баллон пуст');
      return;
    }
    if (h.state === 'alert') {
      s.walk -= dt;
      if (s.walk <= 0) {
        s.walk = 1.2;
        const t = this.nearestWeb(h) ?? w.nests[0];
        goTo(w, h, t.x, t.z, () => {}, h.speed);
      }
    }
  }

  updateLookers(dt) {
    this.lookers = this.lookers.filter((l) => {
      if (l.h.state === 'para' || l.h.state === 'cocoon' || l.h.state === 'gone') return false;
      l.t -= dt;
      if (l.t > 0) return true;
      this.sendHome(l.h);
      return false;
    });
  }

  // Ночной обход: чем больше слухов, тем больше людей ходит с фонарями.
  updatePatrol(dt) {
    const { w } = this;
    this.patrolT -= dt;
    if (this.patrolT > 0 || w.alert < 40) return;
    this.patrolT = 26;
    const home = this.houses.filter((x) => x.state === 'lit' || x.state === 'dark');
    const house = home[Math.floor(w.rng.next() * home.length)];
    const h = house?.people.find((x) => x.state === 'gone');
    if (!h) return;
    this.emerge(h, house.door);
    h.home = house.door;
    h.net = true;
    const to = this.houses.filter((x) => x !== house && x.state !== 'taken')[0]?.door ?? house.door;
    goTo(w, h, to.x, to.z, () => this.sendHome(h), h.speed * 0.8);
    w.bus.emit('radio', { who: 'Сосед', text: 'Дежурю сегодня я. Фонарь есть, тапок есть.' });
  }

  update(dt) {
    const { w } = this;
    for (const house of this.houses) {
      if (house.state !== 'siege') continue;
      let near = 0;
      for (const s of w.spiders) if (dist(s.x, s.z, house.door.x, house.door.z) < 2 * w.unitK) near++;
      house.t -= dt * (1 + near * 0.3);
      if (house.t <= 0) this.takeHouse(house);
    }
    if (this.seedLater) {
      this.seedLater.t -= dt;
      if (this.seedLater.t <= 0) {
        const { z } = this.seedLater.house;
        w.seedWeb(z.x, z.z, z.r);
        this.seedLater = null;
      }
    }
    this.updateNet(dt);
    this.updateDogs(dt);
    this.updateElectric(dt);
    this.updateSpray(dt);
    this.updateLookers(dt);
    this.updatePatrol(dt);
  }
}
