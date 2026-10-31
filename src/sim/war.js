import { Bus, RNG, clamp } from '../core/util.js';
import { START_REGION, WORLD_POPULATION, buildRegions } from '../content/war/regions.js';
import { RESEARCH } from '../content/war/research.js';

export const STAGES = [
  { name: 'Неведение', at: 0 },
  { name: 'Карантин', at: 20 },
  { name: 'Мобилизация', at: 40 },
  { name: 'Коалиция', at: 60 },
  { name: 'Выжженная земля', at: 80 },
];

const T = {
  armyCost: 40,
  armyGrow: 1.1,
  nestCost: 160,
  nestGrow: 1.3,
  depotLife: 14,
  nukeWarn: 9,
  blackoutTime: 45,
  frontShare: 0.75,
  siege: 0.0105,
  casualties: 0.0035,
  garrisonBase: 150,
  garrisonHop: 1.36,
  incomeBase: 0.5,
  incomePop: 0.5,
};

// Мировая война в упрощённом виде. Логика без DOM: её прогоняет и игра, и симулятор.
export class War {
  constructor({ seed = 7, bus = new Bus(), armies = 4, biomass = 80 } = {}) {
    this.rng = new RNG(seed);
    this.bus = bus;
    this.day = 0;
    this.biomass = biomass;
    this.armies = armies;
    this.bought = 0;
    this.nests = 0;
    this.tension = 0;
    this.dawn = 0;
    this.people = WORLD_POPULATION;
    this.fronts = [];
    this.depots = [];
    this.nuke = null;
    this.blackoutCd = 0;
    this.done = {};
    this.events = [];
    this.card = null;
    this.finished = false;
    this.lastIncome = 0;
    this.mods = { atk: 1, armor: 1, siege: 1, income: 1, reserve: 1, nestCost: 1, cap: 8, tension: 1, blackoutCd: 60, dawn: 1, voice: 0, loot: 1 };
    this.timers = { depot: 12, counter: 80, nuke: 200, signal: 90, event: 70 };
    this.regions = buildRegions();
    this.byId = Object.fromEntries(this.regions.map((r) => [r.id, r]));
    for (const r of this.regions) {
      r.owner = r.id === START_REGION ? 'swarm' : 'human';
      r.gMax = T.garrisonBase * T.garrisonHop ** r.hops * (0.75 + Math.sqrt(r.pop / 2e8) * 0.45);
      r.garrison = r.gMax;
      r.people = r.pop;
      r.nest = false;
      r.blackT = 0;
      r.burnT = 0;
    }
    const home = this.byId[START_REGION];
    home.people = 0;
    this.people -= home.pop;
  }

  get stage() {
    let s = 0;
    STAGES.forEach((st, i) => {
      if (this.tension >= st.at) s = i;
    });
    return s;
  }

  get cap() {
    return this.mods.cap + this.nests * 3;
  }

  get income() {
    let v = 0;
    for (const r of this.regions) {
      if (r.owner !== 'swarm' || r.burnT > 0) continue;
      v += (T.incomeBase + (r.pop / 1e8) * T.incomePop) * (r.nest ? 1.4 : 1);
    }
    return v * this.mods.income;
  }

  armyCost() {
    // Цена зависит от текущего размера роя: после разгрома он восстанавливается дешевле.
    return Math.round(T.armyCost * T.armyGrow ** Math.max(0, this.armies - 4));
  }

  nestCost() {
    return Math.round(T.nestCost * T.nestGrow ** this.nests * this.mods.nestCost);
  }

  reserveNeed() {
    return 2 + this.stage * 1.4;
  }

  reserve() {
    const share = this.fronts.length ? 1 - T.frontShare : 1;
    return this.armies * share * this.mods.reserve;
  }

  // Сила на одном направлении: армии делятся поровну, поэтому широкий фронт слабее.
  frontPower() {
    if (!this.fronts.length) return 0;
    return ((this.armies * T.frontShare) / this.fronts.length) * this.mods.atk;
  }

  border(r) {
    return r.owner === 'human' && r.neighbors.some((n) => this.byId[n].owner === 'swarm');
  }

  // Клик по вражескому региону: включает или снимает направление удара.
  toggleFront(id) {
    const r = this.byId[id];
    if (!r || r.owner !== 'human') return null;
    const i = this.fronts.findIndex((f) => f.to === id);
    if (i >= 0) {
      this.fronts.splice(i, 1);
      return 'off';
    }
    if (!this.border(r)) return 'Сначала захвати соседний регион';
    const from = r.neighbors.map((n) => this.byId[n]).find((n) => n.owner === 'swarm');
    this.fronts.push({ to: id, from: from.id });
    this.bus.emit('front', { from: from.id, to: id });
    return 'on';
  }

  buyArmy() {
    const c = this.armyCost();
    if (this.armies >= this.cap) return 'Нет места: нужно гнездо';
    if (this.biomass < c) return 'Не хватает биомассы';
    this.biomass -= c;
    this.bought++;
    this.armies += 1;
    return null;
  }

  buildNest(id) {
    const r = this.byId[id];
    if (!r || r.owner !== 'swarm') return 'Гнездо ставится на своей земле';
    if (r.nest) return 'Здесь уже есть гнездо';
    const c = this.nestCost();
    if (this.biomass < c) return 'Не хватает биомассы';
    this.biomass -= c;
    r.nest = true;
    r.hadNest = true;
    this.nests++;
    this.bus.emit('warNest', r);
    return null;
  }

  researchable(n) {
    if (this.done[n.id]) return false;
    return n.tier === 0 || this.done[`${n.branch}${n.tier - 1}`];
  }

  research(id) {
    const n = RESEARCH.find((x) => x.id === id);
    if (!n || !this.researchable(n)) return 'Сначала прошлый узел';
    if (this.biomass < n.cost) return 'Не хватает биомассы';
    this.biomass -= n.cost;
    this.done[id] = true;
    n.apply(this.mods);
    return null;
  }

  // Рубильник с первых этапов, только теперь на целый регион.
  blackout(id) {
    const r = this.byId[id];
    if (this.blackoutCd > 0) return 'Блэкаут перезаряжается';
    if (!r || r.owner !== 'human') return 'Блэкаут только по людям';
    r.blackT = T.blackoutTime;
    this.blackoutCd = this.mods.blackoutCd;
    this.tension = clamp(this.tension + 0.6 * this.mods.tension, 0, 100);
    this.bus.emit('warBlackout', r);
    return null;
  }

  takeDepot(d) {
    if (!this.depots.includes(d)) return;
    this.depots = this.depots.filter((x) => x !== d);
    if (d.kind === 'signal') {
      this.dawn = Math.max(0, this.dawn - 9);
      this.bus.emit('warToast', 'Эфир Лены заглушён');
    } else {
      this.biomass += d.value;
      this.bus.emit('warLoot', d);
    }
  }

  // Клик по красной метке выводит армии из-под удара.
  evacuate() {
    if (this.nuke) this.nuke.safe = true;
  }

  capture(r) {
    r.owner = 'swarm';
    r.garrison = 0;
    this.fronts = this.fronts.filter((f) => f.to !== r.id);
    this.biomass += (20 + r.pop / 1e7) * this.mods.loot;
    this.tension = clamp(this.tension + (1.8 + r.hops * 0.12) * this.mods.tension, 0, 100);
    if (this.mods.voice) {
      for (const n of r.neighbors) {
        const o = this.byId[n];
        if (o.owner === 'human') o.garrison *= 1 - this.mods.voice;
      }
    }
    this.bus.emit('warCapture', r);
    if (this.regions.every((x) => x.owner === 'swarm')) this.finish();
  }

  lose(r) {
    r.owner = 'human';
    r.gMax *= 1.05;
    r.garrison = r.gMax * 0.25;
    r.nest = false;
    this.nests = Math.max(0, this.nests - (r.hadNest ? 1 : 0));
    r.hadNest = false;
    this.bus.emit('warLost', r);
  }

  finish() {
    this.finished = true;
    this.people = 1;
    this.bus.emit('warEnd');
  }

  updateFronts(dt) {
    const power = this.frontPower();
    for (const f of [...this.fronts]) {
      const r = this.byId[f.to];
      const dark = r.blackT > 0 ? 1.45 : 1;
      r.garrison -= power * dark * this.mods.siege * T.siege * dt * 10;
      const hurt = (0.3 + 0.7 * (r.garrison / r.gMax)) * (1 + this.stage * 0.28);
      this.armies -= (hurt * T.casualties * dt) / this.mods.armor;
      if (r.garrison <= 0) this.capture(r);
    }
    // Армии не вымирают до нуля: разбитый фронт просто останавливается.
    if (this.armies < 1) {
      this.armies = 1;
      if (this.fronts.length) {
        this.fronts = [];
        this.bus.emit('warToast', 'Наступление захлебнулось');
      }
    }
  }

  updateRegions(dt) {
    const attacked = new Set(this.fronts.map((f) => f.to));
    const regen = 0.004 + this.stage * 0.002;
    for (const r of this.regions) {
      r.blackT = Math.max(0, r.blackT - dt);
      r.burnT = Math.max(0, r.burnT - dt);
      if (r.owner === 'human') {
        if (!attacked.has(r.id)) r.garrison = Math.min(r.gMax, r.garrison + r.gMax * regen * dt);
      } else if (r.people > 0) {
        const v = Math.min(r.people, (r.pop / 60) * dt);
        r.people -= v;
        this.people -= v;
      }
    }
  }

  spawnDepot(kind) {
    const list = this.regions.filter((r) => this.border(r) || r.owner === 'swarm');
    const r = this.rng.pick(list);
    this.depots.push({ kind, region: r.id, life: T.depotLife, value: Math.round(30 + this.income * 14) });
  }

  updateTimers(dt) {
    const t = this.timers;
    this.depots = this.depots.filter((d) => (d.life -= dt) > 0);
    t.depot -= dt;
    if (t.depot <= 0) {
      t.depot = this.rng.range(20, 40);
      this.spawnDepot('depot');
    }
    t.signal -= dt;
    if (t.signal <= 0 && this.stage >= 2) {
      t.signal = this.rng.range(50, 80);
      this.spawnDepot('signal');
    }

    // Контратаки: запас роя держит границу, иначе регион уходит обратно.
    t.counter -= dt;
    if (t.counter <= 0 && this.stage >= 1) {
      t.counter = this.rng.range(70, 110) - this.stage * 6;
      const border = this.regions.filter((r) => r.owner === 'swarm' && r.id !== START_REGION && r.neighbors.some((n) => this.byId[n].owner === 'human'));
      // Сердце роя люди не трогают: контратаки идут только пока земель достаточно.
      if (border.length > 2) {
        const r = this.rng.pick(border);
        if (this.reserve() >= this.reserveNeed()) {
          this.armies = Math.max(1, this.armies - 0.3);
          this.bus.emit('warToast', `${r.name}: контратака отбита`);
        } else {
          this.lose(r);
        }
      }
    }

    this.blackoutCd = Math.max(0, this.blackoutCd - dt);

    // Ядерные удары: у игрока есть несколько секунд, чтобы вывести армии.
    if (this.nuke) {
      this.nuke.t -= dt;
      if (this.nuke.t <= 0) {
        const r = this.byId[this.nuke.region];
        r.burnT = 120;
        if (!this.nuke.safe) this.armies = Math.max(1, this.armies * 0.82);
        this.bus.emit('warNuke', { region: r, safe: this.nuke.safe });
        this.nuke = null;
      }
    } else if (this.stage >= 3) {
      t.nuke -= dt;
      if (t.nuke <= 0) {
        t.nuke = this.rng.range(110, 170) - (this.stage - 3) * 30;
        const mine = this.regions.filter((r) => r.owner === 'swarm' && r.id !== START_REGION);
        const hot = mine.filter((r) => this.fronts.some((f) => f.from === r.id));
        const pool = hot.length ? hot : mine;
        if (pool.length) {
          this.nuke = { region: this.rng.pick(pool).id, t: T.nukeWarn, safe: false };
          this.bus.emit('warNukeWarn', this.nuke);
        }
      }
    }

    // Лена ведёт проект «Рассвет»: при 100 рой теряет приграничные регионы.
    if (this.stage >= 2) this.dawn += dt * (0.035 + this.stage * 0.012) * this.mods.dawn;
    if (this.dawn >= 100) {
      this.dawn = 25;
      const border = this.regions.filter((r) => r.owner === 'swarm' && r.id !== START_REGION && r.neighbors.some((n) => this.byId[n].owner === 'human'));
      for (let i = 0; i < 3 && border.length; i++) this.lose(border.splice(Math.floor(this.rng.next() * border.length), 1)[0]);
      this.bus.emit('warDawn');
    }

    t.event -= dt;
    if (t.event <= 0 && this.events.length && !this.card) {
      t.event = this.rng.range(120, 200);
      this.card = this.events.shift();
      this.bus.emit('warCard', this.card);
    }
  }

  chooseCard(option) {
    if (!this.card) return;
    const e = option.effect ?? {};
    this.biomass = Math.max(0, this.biomass + (e.biomass ?? 0));
    this.tension = clamp(this.tension + (e.tension ?? 0), 0, 100);
    this.dawn = clamp(this.dawn + (e.dawn ?? 0), 0, 99);
    this.armies = Math.max(1, this.armies + (e.armies ?? 0));
    this.card = null;
  }

  tick(dt) {
    if (this.finished) return;
    this.day += dt;
    const income = this.income;
    this.lastIncome = income;
    this.biomass += income * dt;
    this.tension = Math.max(0, this.tension - dt * 0.004);
    this.updateFronts(dt);
    this.updateRegions(dt);
    this.updateTimers(dt);
  }

  // Инстинкт: рой играет сам. Этим же ботом считается баланс.
  autoplay() {
    if (this.nuke && !this.nuke.safe) this.evacuate();
    for (const d of [...this.depots]) this.takeDepot(d);
    if (this.card) this.chooseCard(this.card.options[0]);
    const open = RESEARCH.filter((n) => this.researchable(n)).sort((a, b) => a.cost - b.cost);
    if (open[0] && this.biomass >= open[0].cost * 1.4) this.research(open[0].id);
    if (this.armies >= this.cap && this.biomass >= this.nestCost()) {
      const spot = this.regions.filter((r) => r.owner === 'swarm' && !r.nest).sort((a, b) => b.pop - a.pop)[0];
      if (spot) this.buildNest(spot.id);
    }
    while (this.biomass >= this.armyCost() && this.armies < this.cap) this.buyArmy();
    const want = clamp(Math.floor(this.armies / 7), 1, 4);
    if (this.fronts.length < want) {
      const target = this.regions.filter((r) => this.border(r) && !this.fronts.some((f) => f.to === r.id)).sort((a, b) => a.garrison - b.garrison)[0];
      if (target) this.toggleFront(target.id);
    }
    if (this.fronts[0] && !this.blackoutCd) this.blackout(this.fronts[0].to);
  }
}
