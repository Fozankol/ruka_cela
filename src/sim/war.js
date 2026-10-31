import { Bus, RNG, clamp } from '../core/util.js';
import { FACTIONS, LABS, REGION_RES, REGION_TERRAIN, TERRAIN } from '../content/war/factions.js';
import { FIGURES } from '../content/war/figures.js';
import { FOCUS, focusOpen } from '../content/war/focus.js';
import { START_REGION, WORLD_POPULATION, buildRegions, hopDays } from '../content/war/regions.js';
import { RESEARCH } from '../content/war/research.js';
import { TALES } from '../content/war/tales.js';
import { HUMAN_ARMY, LEGIONS, LEGION_TITLES, legionName } from '../content/war/units.js';

export const STAGES = [
  { name: 'Неведение', at: 0 },
  { name: 'Карантин', at: 20 },
  { name: 'Мобилизация', at: 40 },
  { name: 'Коалиция', at: 60 },
  { name: 'Выжженная земля', at: 80 },
];

// Числа боя, общие для всех карт.
const K = {
  hit: 0.065,
  back: 0.285,
  garrisonDef: 0.06,
  strShare: 0.22,
  orgRegen: 2,
  strRegen: 1.2,
  refillCost: 0.5,
  retreatDays: 8,
  upkeep: 0.25,
  legionGrow: 0.09,
  stageForce: 0.3,
  unsupplied: 0.7,
  flank: 0.1,
  aiEvery: 4,
  autoEvery: 3,
  supplyEvery: 3,
};

// Приказ легиону меняет цену боя: быстрее и дороже или медленнее и дешевле.
export const STANCES = {
  normal: { atk: 1, back: 1 },
  storm: { atk: 1.4, back: 1.7 },
  care: { atk: 0.65, back: 0.5 },
};

const T = {
  nestCost: 240,
  nestGrow: 1.3,
  depotLife: 14,
  nukeWarn: 9,
  blackoutTime: 45,
  garrisonBase: 90,
  garrisonHop: 0.6,
  incomeBase: 0.4,
  incomePop: 0.38,
  legionBase: 5,
  supplyRange: 2,
  swarmGarrison: 25,
  foeCost: 100,
  foeProd: 0.7,
  influenceBase: 0.16,
  pactCost: 40,
  pactDays: 400,
  sabotageCost: 25,
};

const WORLD_MAP = {
  build: buildRegions,
  hop: hopDays,
  factions: FACTIONS,
  terrain: REGION_TERRAIN,
  labs: LABS,
  resources: REGION_RES,
  plans: true,
  goals: true,
  start: START_REGION,
  population: WORLD_POPULATION,
  peopleK: 1,
  peopleLabel: 'Людей на Земле',
  nukes: true,
  dawn: true,
  politics: true,
  legions: 3,
  biomass: 120,
  T: {},
};

const blankMods = () => ({
  atk: 1,
  def: 1,
  armor: 1,
  siege: 1,
  garrison: 1,
  income: 1,
  supply: 0,
  sea: false,
  cap: 0,
  nestCost: 1,
  refill: 1,
  legionCost: 1,
  buildTime: 1,
  speed: 1,
  tension: 1,
  blackoutCd: 60,
  blackoutK: 1,
  dawn: 1,
  voice: 0,
  loot: 1,
  research: 1,
  focus: 1,
  influence: 0,
  slots: 0,
  orgRegen: 1,
  orgMax: 1,
  nukeArmor: 1,
  home: 1,
  pactCost: 1,
  pactDays: 1,
  allies: 0,
  foeK: 1,
  surrender: 0.7,
  keepPacts: false,
  diplomacy: false,
  intel: false,
});

// Война без DOM: её считает и игра, и симулятор.
export class War {
  constructor({ seed = 7, bus = new Bus(), map = WORLD_MAP, done = {}, biomass = map.biomass, legions = map.legions } = {}) {
    this.rng = new RNG(seed);
    this.bus = bus;
    this.map = map;
    this.T = { ...T, ...map.T };
    this.day = 0;
    this.biomass = biomass;
    this.earned = 0;
    this.influencePts = 10;
    this.tension = 0;
    this.dawn = 0;
    this.people = map.population;
    this.lastIncome = 0;
    this.units = [];
    this.nextUnit = 1;
    this.legionNo = 0;
    this.queue = [];
    this.nests = 0;
    this.rally = null;
    this.depots = [];
    this.nuke = null;
    this.blackoutCd = 0;
    this.done = { ...done };
    this.active = [];
    this.focusDone = {};
    this.focusNow = null;
    this.allies = [];
    this.met = {};
    this.figureT = 120;
    this.taleT = 200;
    this.talesDone = {};
    this.events = [];
    this.eventsUsed = 0;
    this.card = null;
    this.cards = [];
    this.finished = false;
    this.quarantined = false;
    this.instinct = false;
    this.lena = map.dawn ? 'central_europe' : null;
    this.timers = { depot: 12, nuke: 200, signal: 90, event: 70, ai: 0, supply: 0, auto: 0 };
    this.supplied = new Set();
    this.res = { food: 0, venom: 0, chitin: 0, lab: 0 };
    this.goals = [];
    this.goalT = 30;
    this.tally = { taken: 0, lost: 0, broken: 0 };
    this.recompute();

    this.regions = map.build();
    this.byId = Object.fromEntries(this.regions.map((r) => [r.id, r]));
    this.factions = map.factions.map((f) => ({ ...f, war: false, pactT: 0, surrendered: false, pool: 0, disarray: 0, tribute: false, plan: null, planT: 90 }));
    this.factionById = Object.fromEntries(this.factions.map((f) => [f.id, f]));
    for (const f of this.factions) {
      const list = f.regions === 'all' ? this.regions.filter((r) => r.id !== map.start).map((r) => r.id) : f.regions;
      f.regions = list;
      for (const id of list) this.byId[id].faction = f.id;
    }
    for (const r of this.regions) {
      r.owner = r.id === map.start ? 'swarm' : r.faction;
      r.terrain = map.terrain?.[r.id] ?? 'plain';
      r.lab = !!map.labs?.includes(r.id);
      r.res = r.lab ? 'lab' : (map.resources?.[r.id] ?? null);
      r.sealed = false;
      r.pocket = false;
      r.vassal = false;
      r.gMax = this.T.garrisonBase * (1 + r.hops * this.T.garrisonHop) * (0.75 + Math.sqrt(r.pop / 2e8) * 0.45);
      r.garrison = r.owner === 'swarm' ? this.T.swarmGarrison : r.gMax;
      r.people = r.pop;
      r.nest = false;
      r.hadNest = false;
      r.blackT = 0;
      r.burnT = 0;
    }
    const home = this.byId[map.start];
    home.people = 0;
    home.nest = true;
    this.people -= home.pop * map.peopleK;
    for (let i = 0; i < legions; i++) this.spawnLegion('swarm', map.start);
    this.updateSupply();
  }

  // Все бонусы считаются заново из того, что открыто. Поэтому союзника можно потерять.
  recompute() {
    const m = blankMods();
    for (const id of Object.keys(this.done)) RESEARCH.find((n) => n.id === id)?.apply(m);
    for (const id of Object.keys(this.focusDone)) FOCUS.find((n) => n.id === id)?.apply(m);
    for (const id of this.allies) FIGURES.find((f) => f.id === id)?.apply(m);
    this.mods = m;
  }

  get stage() {
    let s = 0;
    STAGES.forEach((st, i) => {
      if (this.tension >= st.at) s = i;
    });
    return s;
  }

  legions() {
    return this.units.filter((u) => u.side === 'swarm');
  }

  get cap() {
    return this.T.legionBase + Math.floor(this.nests * 0.8) + this.mods.cap;
  }

  get slots() {
    return (this.map.slots ?? 2) + this.mods.slots;
  }

  get income() {
    let v = 0;
    for (const r of this.regions) {
      if (r.owner !== 'swarm' || r.burnT > 0) continue;
      const metro = r.terrain === 'metro' ? 1.3 : 1;
      const food = r.res === 'food' ? 1.6 : 1;
      v += (this.T.incomeBase + (r.pop / 1e8) * this.T.incomePop) * (r.nest ? 1.4 : 1) * metro * food;
    }
    for (const f of this.factions) if (f.tribute && f.pactT > 0) v += f.regions.length * 0.5;
    return v * this.mods.income - this.legions().length * K.upkeep;
  }

  get influenceRate() {
    return this.map.politics ? this.T.influenceBase + this.mods.influence : 0;
  }

  get allySlots() {
    return 3 + this.mods.allies;
  }

  border(r) {
    return r.owner !== 'swarm' && r.neighbors.some((n) => this.byId[n].owner === 'swarm');
  }

  unitsAt(id) {
    return this.units.filter((u) => u.region === id && u.moveT <= 0);
  }

  garrisonOf(r) {
    return r.owner === 'swarm' ? r.garrison : r.garrison * this.mods.garrison;
  }

  // Сколько сил в регионе, если смотреть со стороны.
  strength(r) {
    let v = this.garrisonOf(r);
    for (const u of this.unitsAt(r.id)) v += u.str * (u.side === 'swarm' ? 1 : 1 + this.stage * K.stageForce);
    return v;
  }

  isPact(r) {
    const f = this.factionById[r.owner];
    return !!f && f.pactT > 0;
  }

  // С кем рой уже воюет: сдавшийся блок считается врагом, пока не добит.
  atWar(r) {
    const f = this.factionById[r.owner];
    return !!f && (f.war || f.surrendered);
  }

  // Морские связи открываются наукой.
  canCross(from, to) {
    return this.mods.sea || !from.sea?.includes(to);
  }

  armyInfo(u) {
    return u.side === 'swarm' ? LEGIONS[u.type] : HUMAN_ARMY;
  }

  isSupplied(id) {
    return this.supplied.has(id);
  }

  // Снабжение идёт от гнёзд по своей земле. Чем больше наука, тем дальше.
  updateSupply() {
    const range = this.T.supplyRange + this.mods.supply;
    const out = new Set();
    let wave = this.regions.filter((r) => r.owner === 'swarm' && r.nest).map((r) => r.id);
    for (const id of wave) out.add(id);
    for (let step = 0; step < range; step++) {
      const next = [];
      for (const id of wave) {
        for (const n of this.byId[id].neighbors) {
          if (out.has(n) || this.byId[n].owner !== 'swarm' || !this.canCross(this.byId[id], n)) continue;
          out.add(n);
          next.push(n);
        }
      }
      wave = next;
    }
    this.supplied = out;
    this.res = { food: 0, venom: 0, chitin: 0, lab: 0 };
    for (const r of this.regions) if (r.owner === 'swarm' && r.res) this.res[r.res]++;
  }

  rank(u) {
    return Math.min(3, Math.floor((u.xp ?? 0) / 3));
  }

  power(u, kind) {
    const base = this.armyInfo(u);
    let v = base[kind] * (u.str / 100) * (0.35 + (0.65 * u.org) / 100);
    if (kind === 'def') v *= 1 + 0.6 * (u.dig ?? 0);
    if (u.side === 'swarm') {
      v *= kind === 'atk' ? this.mods.atk * (1 + 0.04 * this.res.venom) : this.mods.def * (1 + 0.04 * this.res.chitin);
      v *= 1 + 0.07 * this.rank(u);
      if (!this.isSupplied(u.region)) v *= K.unsupplied;
    } else {
      v *= (1 + this.stage * K.stageForce) * this.mods.foeK;
      if (this.factionById[u.side].disarray > 0) v *= 0.7;
      if (this.byId[u.region].pocket) v *= 0.6;
    }
    return v;
  }

  spawnLegion(type, region) {
    this.legionNo++;
    const u = this.makeUnit('swarm', type, region);
    u.no = this.legionNo;
    u.name = `${legionName(u.no)} ${LEGIONS[type].name}`;
    this.units.push(u);
    return u;
  }

  makeUnit(side, type, region) {
    return { id: this.nextUnit++, side, type, region, str: 100, org: 100, path: [], attacking: null, moveTo: null, moveT: 0, moveFull: 0, routed: false, auto: false, fight: false, name: '', stance: 'normal', dig: 0, xp: 0, title: '' };
  }

  legionCost(type) {
    const over = Math.max(0, this.legions().length + this.queue.length - 3);
    return Math.round(LEGIONS[type].cost * this.mods.legionCost * (1 + K.legionGrow * over));
  }

  legionOpen(type) {
    const t = LEGIONS[type];
    return !t.hidden && !this.legionLock(type);
  }

  // Почему легион пока нельзя вывести.
  legionLock(type) {
    const t = LEGIONS[type];
    if (t.need && !this.done[t.need]) return 'наука';
    if (t.res && this.map.resources && !this.res[t.res]) return t.res === 'venom' ? 'нужен яд' : 'нужна руда';
    return '';
  }

  buildLegion(type) {
    const lock = this.legionLock(type);
    if (lock) return `Пока закрыто: ${lock}`;
    if (this.legions().length + this.queue.length >= this.cap) return 'Лимит легионов: нужны гнёзда';
    const c = this.legionCost(type);
    if (this.biomass < c) return 'Не хватает биомассы';
    this.biomass -= c;
    const days = LEGIONS[type].days * this.mods.buildTime;
    this.queue.push({ type, left: days, full: days });
    return null;
  }

  get lines() {
    return Math.min(4, 1 + Math.floor(this.nests / 2));
  }

  // Новый легион выходит из гнезда ближе всего к фронту, если игрок не выбрал другое.
  spawnRegion() {
    const nests = this.regions.filter((r) => r.owner === 'swarm' && r.nest);
    if (this.rally && this.byId[this.rally].owner === 'swarm' && this.byId[this.rally].nest) return this.rally;
    const front = nests.filter((r) => r.neighbors.some((n) => this.byId[n].owner !== 'swarm'));
    return (front[0] ?? nests[0] ?? this.byId[this.map.start]).id;
  }

  nestCost() {
    return Math.round(this.T.nestCost * this.T.nestGrow ** this.nests * this.mods.nestCost);
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
    this.updateSupply();
    this.bus.emit('warNest', r);
    return null;
  }

  // Путь до цели: по своей земле и дальше через врага шаг за шагом.
  findPath(from, to) {
    if (from === to) return [];
    const prev = new Map([[from, null]]);
    const q = [from];
    for (let head = 0; head < q.length; head++) {
      const id = q[head];
      if (id === to) break;
      const r = this.byId[id];
      for (const n of r.neighbors) {
        if (prev.has(n) || !this.canCross(r, n)) continue;
        const o = this.byId[n];
        if (o.owner !== 'swarm' && (this.isPact(o) || o.sealed)) continue;
        prev.set(n, id);
        q.push(n);
      }
    }
    if (!prev.has(to)) return null;
    const path = [];
    for (let id = to; id !== from; id = prev.get(id)) path.unshift(id);
    return path;
  }

  // Приказ легиону: идти или атаковать. Ошибка возвращается строкой.
  order(u, to) {
    const r = this.byId[to];
    if (!r) return 'Нет такого региона';
    if (u.routed) return 'Легион разбит и отступает';
    if (r.sealed) return 'Кордон. Сними его блэкаутом';
    if (this.isPact(r)) return `Пакт: ${this.factionById[r.owner].name}`;
    const path = this.findPath(u.moveT > 0 ? u.moveTo : u.region, to);
    if (!path) return 'Нет пути: нужны морские нити';
    u.attacking = null;
    u.path = path;
    return null;
  }

  stop(u) {
    u.attacking = null;
    u.path = [];
  }

  setAuto(u, on) {
    u.auto = on;
    if (on) u.path = [];
  }

  friendly(u, r) {
    return u.side === 'swarm' ? r.owner === 'swarm' : r.owner !== 'swarm';
  }

  stepUnit(u, dt) {
    if (u.moveT > 0) {
      const speed = this.armyInfo(u).speed * (u.side === 'swarm' ? this.mods.speed : 1);
      u.moveT -= dt * speed;
      if (u.moveT > 0) return;
      u.moveT = 0;
      const to = this.byId[u.moveTo];
      u.moveTo = null;
      u.routed = false;
      if (this.friendly(u, to)) u.region = to.id;
      else u.path.unshift(to.id);
    }
    if (u.attacking || u.routed || !u.path.length) return;
    const next = this.byId[u.path[0]];
    if (this.friendly(u, next)) {
      this.startMove(u, u.path.shift());
      return;
    }
    if (u.side === 'swarm') {
      if (next.sealed || this.isPact(next)) {
        u.path = [];
        return;
      }
      const f = this.factionById[next.owner];
      if (f && !f.war) this.declare(f);
    }
    u.attacking = next.id;
    u.dig = 0;
    u.path.shift();
    if (u.side === 'swarm') this.bus.emit('front', { from: u.region, to: next.id });
    else this.bus.emit('warCounter', next);
  }

  startMove(u, to) {
    u.moveTo = to;
    u.moveFull = this.map.hop(this.byId[u.region], this.byId[to]);
    u.moveT = u.moveFull;
    u.attacking = null;
    u.dig = 0;
  }

  hurt(u, d) {
    const armor = u.side === 'swarm' ? this.mods.armor * this.mods.orgMax : 1;
    u.org -= d / armor;
    u.str -= (d * K.strShare) / armor;
    if (u.str <= 0) {
      this.removeUnit(u, true);
      return;
    }
    if (u.org <= 0) this.rout(u);
  }

  removeUnit(u, killed) {
    this.units = this.units.filter((x) => x !== u);
    if (killed && u.side === 'swarm') this.bus.emit('warToast', `${u.name} уничтожен`);
  }

  // Разбитый отряд уходит на ближайшую свою землю и там приходит в себя.
  rout(u) {
    u.org = 0;
    u.attacking = null;
    u.path = [];
    const here = this.byId[u.region];
    if (this.friendly(u, here) && !this.units.some((o) => o.attacking === here.id)) return;
    const back = here.neighbors.map((n) => this.byId[n]).find((r) => this.friendly(u, r) && this.canCross(here, r.id));
    if (!back) {
      this.removeUnit(u, true);
      return;
    }
    u.routed = true;
    u.moveTo = back.id;
    u.moveFull = K.retreatDays;
    u.moveT = K.retreatDays;
    if (u.side === 'swarm') this.bus.emit('warToast', `${u.name} разбит и отступает`);
  }

  updateBattles(dt) {
    for (const u of this.units) u.fight = false;
    const groups = new Map();
    for (const u of this.units) {
      if (!u.attacking) continue;
      const r = this.byId[u.attacking];
      if (this.friendly(u, r) || (u.side === 'swarm' && (r.sealed || this.isPact(r)))) {
        u.attacking = null;
        continue;
      }
      const key = `${u.side === 'swarm' ? 's' : 'h'}:${r.id}`;
      if (!groups.has(key)) groups.set(key, { r, list: [] });
      groups.get(key).list.push(u);
    }
    for (const { r, list } of groups.values()) this.fight(r, list, dt);
  }

  fight(r, attackers, dt) {
    const swarmAttacks = attackers[0].side === 'swarm';
    const defenders = this.unitsAt(r.id).filter((u) => (u.side === 'swarm') !== swarmAttacks);
    const sources = new Set(attackers.map((u) => u.region));
    let A = attackers.reduce((v, u) => v + this.power(u, 'atk') * STANCES[u.stance].atk, 0) * (1 + K.flank * (sources.size - 1));
    const terrain = swarmAttacks ? (TERRAIN[r.terrain]?.def ?? 1) : 1;
    const dark = r.blackT > 0 ? 0.7 / this.mods.blackoutK : 1;
    const garrison = this.garrisonOf(r);
    const D = (defenders.reduce((v, u) => v + this.power(u, 'def'), 0) + garrison * K.garrisonDef) * terrain * dark;
    for (const u of attackers) u.fight = true;
    for (const u of defenders) u.fight = true;

    const siege = swarmAttacks ? this.mods.siege * (1 + attackers.reduce((v, u) => v + (LEGIONS[u.type]?.siege ?? 1) - 1, 0) / attackers.length) : 1;
    A *= K.hit * dt;
    const onUnits = defenders.length ? 0.72 : 0;
    const inPocket = swarmAttacks && r.pocket ? 1.5 : 1;
    r.garrison -= (A * (1 - onUnits) * siege * inPocket) / (swarmAttacks ? this.mods.garrison : 1);
    if (defenders.length) {
      const each = (A * onUnits) / defenders.length;
      for (const u of [...defenders]) this.hurt(u, each);
      const broken = defenders.filter((u) => !this.units.includes(u) || u.routed).length;
      if (broken && swarmAttacks) {
        this.tally.broken += broken;
        for (const u of attackers) this.gainXp(u, broken);
      }
    }
    const back = (D * K.back * dt) / attackers.length;
    for (const u of [...attackers]) this.hurt(u, back * STANCES[u.stance].back);

    const stillThere = this.unitsAt(r.id).some((u) => (u.side === 'swarm') !== swarmAttacks && !u.routed);
    if (r.garrison <= 0 && !stillThere) {
      r.garrison = 0;
      const alive = attackers.filter((u) => this.units.includes(u));
      if (swarmAttacks) this.capture(r, alive);
      else this.lose(r, alive);
    }
  }

  gainXp(u, n) {
    if (u.side !== 'swarm') return;
    const was = this.rank(u);
    u.xp += n;
    if (this.rank(u) <= was) return;
    if (!u.title && this.rank(u) >= 2) {
      u.title = LEGION_TITLES[(u.no - 1) % LEGION_TITLES.length];
      u.name = `${u.name} «${u.title}»`;
      this.bus.emit('warToast', `Легион заслужил имя: ${u.title}`);
    }
  }

  // Что будет, если эти легионы ударят по региону. Это оценка, а не обещание.
  forecast(list, r) {
    const sources = new Set(list.map((u) => u.region));
    const A = list.reduce((v, u) => v + this.power(u, 'atk') * STANCES[u.stance].atk, 0) * (1 + K.flank * (sources.size - 1)) * K.hit;
    const siege = this.mods.siege * (1 + list.reduce((v, u) => v + (LEGIONS[u.type]?.siege ?? 1) - 1, 0) / list.length) * (r.pocket ? 1.5 : 1);
    const foes = this.unitsAt(r.id).filter((u) => u.side !== 'swarm');
    const terrain = TERRAIN[r.terrain]?.def ?? 1;
    const dark = r.blackT > 0 ? 0.7 / this.mods.blackoutK : 1;
    const D = (foes.reduce((v, u) => v + this.power(u, 'def'), 0) + this.garrisonOf(r) * K.garrisonDef) * terrain * dark;
    const G = this.garrisonOf(r);
    const O = foes.reduce((v, u) => v + u.org, 0);
    let days = G / (A * siege);
    if (foes.length) {
      const first = O / (A * 0.72);
      days = first + Math.max(0, G - A * 0.28 * siege * first) / (A * siege);
    }
    const stance = list.reduce((v, u) => v + STANCES[u.stance].back, 0) / list.length;
    const armor = this.mods.armor * this.mods.orgMax;
    const loss = ((D * K.back * stance) / list.length / armor) * days * 0.58;
    const org = list.reduce((v, u) => v + u.org, 0) / list.length;
    const cls = loss < org * 0.4 ? 'good' : loss < org * 0.8 ? 'hard' : 'bad';
    const text = { good: 'лёгкая победа', hard: 'тяжёлый бой', bad: 'легионы сломаются' }[cls];
    return { days: Math.ceil(days), loss: Math.round(Math.min(100, loss)), cls, text };
  }

  // Первый вошедший занимает регион, остальные идут следом.
  advance(r, attackers) {
    const lead = [...attackers].sort((a, b) => b.org - a.org)[0];
    for (const u of attackers) {
      u.attacking = null;
      if (u === lead) u.region = r.id;
      else if (!u.path.length && !u.routed) u.path = [r.id];
    }
  }

  capture(r, attackers = []) {
    const was = this.factionById[r.owner];
    r.owner = 'swarm';
    r.garrison = 0;
    r.sealed = false;
    for (const u of [...this.units]) if (u.side !== 'swarm' && u.region === r.id) this.rout(u);
    this.advance(r, attackers);
    // Мир пугается один раз: отбитый и снова взятый регион не поднимает тревогу.
    this.tally.taken++;
    for (const u of attackers) this.gainXp(u, 1);
    if (!r.taken) {
      r.taken = true;
      r.spoil = (20 + r.pop / 1e7) * this.mods.loot;
      this.biomass += r.spoil;
      this.tension = clamp(this.tension + (1.4 + r.hops * 0.09) * this.mods.tension, 0, 100);
    }
    if (this.mods.voice) {
      for (const n of r.neighbors) {
        const o = this.byId[n];
        if (o.owner !== 'swarm') o.garrison *= 1 - this.mods.voice;
      }
    }
    this.updateSupply();
    this.bus.emit('warCapture', r);
    if (r.id === this.lena) this.moveLena();
    this.checkQuarantine();
    if (was) this.checkSurrender(was);
    if (this.regions.every((x) => x.owner === 'swarm')) this.finish();
  }

  // Захват штаба сбивает проект «Рассвет», а Лена уезжает дальше.
  moveLena() {
    this.dawn = Math.max(0, this.dawn - 30);
    const left = (this.map.labs ?? []).map((id) => this.byId[id]).filter((r) => r.owner !== 'swarm');
    this.lena = left.length ? left[0].id : null;
    this.bus.emit('radio', { who: 'Лена', text: left.length ? `Мы ушли. Новый штаб: ${left[0].name}. Эфир продолжается.` : 'Лабораторий больше нет. Осталось только радио.' });
  }

  // Города закрывают мосты: дальний берег за кордоном.
  checkQuarantine() {
    const at = this.map.quarantine;
    if (!at || this.quarantined) return;
    if (this.regions.filter((r) => r.owner === 'swarm').length < this.regions.length * at) return;
    this.quarantined = true;
    for (const r of this.regions) {
      if (!r.far || r.owner === 'swarm' || !this.border(r)) continue;
      r.sealed = true;
      for (const u of this.legions()) {
        if (u.attacking === r.id) u.attacking = null;
        u.path = u.path.filter((id) => id !== r.id);
      }
    }
    this.bus.emit('warQuarantine');
  }

  // Блок сдаётся, когда потерял слишком много: остальные регионы падают без боя.
  checkSurrender(f) {
    if (this.map.noSurrender || f.surrendered) return;
    const left = f.regions.filter((id) => this.byId[id].owner === f.id).length;
    if (!left) {
      f.surrendered = true;
      f.plan = null;
      return;
    }
    const lost = 1 - left / f.regions.length;
    const capitalLost = this.byId[f.capital].owner === 'swarm';
    if (lost < this.mods.surrender && !(capitalLost && lost >= this.mods.surrender - 0.2)) return;
    f.surrendered = true;
    f.war = false;
    f.plan = null;
    this.units = this.units.filter((u) => u.side !== f.id);
    for (const id of f.regions) {
      const r = this.byId[id];
      if (r.owner !== f.id) continue;
      r.owner = 'swarm';
      r.garrison = 0;
      r.vassal = true;
      this.bus.emit('warCapture', r);
    }
    this.tension = clamp(this.tension + 3 * this.mods.tension, 0, 100);
    this.biomass += 60 * f.regions.length * this.mods.loot;
    this.updateSupply();
    this.bus.emit('warSurrender', f);
    if (this.regions.every((x) => x.owner === 'swarm')) this.finish();
  }

  lose(r, attackers = []) {
    if (r.id === this.map.start) {
      r.garrison = this.T.swarmGarrison;
      for (const u of attackers) u.attacking = null;
      return;
    }
    this.tally.lost++;
    r.owner = r.faction ?? attackers[0]?.side ?? r.owner;
    r.gMax *= 1.05;
    r.garrison = r.gMax * 0.25;
    if (r.nest) {
      r.nest = false;
      this.nests = Math.max(0, this.nests - (r.hadNest ? 1 : 0));
      r.hadNest = false;
    }
    for (const u of [...this.units]) if (u.side === 'swarm' && u.region === r.id && u.moveT <= 0) this.rout(u);
    this.advance(r, attackers);
    this.updateSupply();
    this.bus.emit('warLost', r);
  }

  declare(f) {
    if (f.war || f.surrendered) return;
    f.war = true;
    this.tension = clamp(this.tension + 1.5 * this.mods.tension, 0, 100);
    this.bus.emit('warDeclared', f);
  }

  finish() {
    this.finished = true;
    if (this.map.end) {
      this.bus.emit(this.map.end, this);
      return;
    }
    this.people = 1;
    this.bus.emit('warEnd');
  }

  // Дипломатия. Все ошибки возвращаются строкой.
  pactCost() {
    return Math.round(this.T.pactCost * (1 + this.stage * 0.25) * this.mods.pactCost);
  }

  pact(id) {
    const f = this.factionById[id];
    if (!this.mods.diplomacy) return 'Сначала Язык нитей';
    if (this.stage >= 3 && !this.mods.keepPacts) return 'Коалиция не говорит с роем';
    const c = this.pactCost();
    if (this.influencePts < c) return 'Не хватает влияния';
    this.influencePts -= c;
    f.pactT = this.T.pactDays * this.mods.pactDays;
    f.war = false;
    f.plan = null;
    for (const u of this.units) {
      if (u.side === f.id) this.stop(u);
      if (u.side === 'swarm' && u.attacking && this.byId[u.attacking].owner === f.id) this.stop(u);
    }
    this.tension = Math.max(0, this.tension - 1);
    this.bus.emit('warToast', `Пакт: ${f.name}`);
    return null;
  }

  breakPact(id) {
    const f = this.factionById[id];
    f.pactT = 0;
    f.tribute = false;
    this.tension = clamp(this.tension + 4 * this.mods.tension, 0, 100);
    this.declare(f);
    this.bus.emit('warToast', `Пакт разорван: ${f.name}`);
  }

  // Дань: блок с пактом кормит рой, чтобы рой не пришёл к нему первым.
  tribute(id) {
    const f = this.factionById[id];
    if (f.pactT <= 0) return 'Дань требуют только по пакту';
    if (f.tribute) return 'Дань уже идёт';
    const c = 25;
    if (this.influencePts < c) return 'Не хватает влияния';
    this.influencePts -= c;
    f.tribute = true;
    this.tension = clamp(this.tension + 2 * this.mods.tension, 0, 100);
    return null;
  }

  // Подполье сеет раздор: армии блока на время теряют согласие.
  sabotage(id) {
    const f = this.factionById[id];
    if (!this.mods.diplomacy) return 'Сначала Язык нитей';
    if (this.influencePts < this.T.sabotageCost) return 'Не хватает влияния';
    this.influencePts -= this.T.sabotageCost;
    f.disarray = 180;
    this.bus.emit('warToast', `Раздор: ${f.name}`);
    return null;
  }

  // Подмена забирает регион без боя, пока в нём нет армий.
  replace(id) {
    const r = this.byId[id];
    if (!this.focusDone.mimic) return 'Нужна доктрина подмены';
    if (!this.border(r) || r.sealed) return 'Только регион на границе';
    if (this.unitsAt(id).some((u) => u.side !== 'swarm')) return 'Там стоит армия';
    const c = 45;
    if (this.influencePts < c) return 'Не хватает влияния';
    this.influencePts -= c;
    r.garrison = 0;
    this.capture(r);
    return null;
  }

  ally(id) {
    const f = FIGURES.find((x) => x.id === id);
    if (this.allies.includes(id)) return null;
    if (this.allies.length >= this.allySlots) return 'Союзников слишком много';
    if (this.influencePts < f.cost) return 'Не хватает влияния';
    this.influencePts -= f.cost;
    this.allies.push(id);
    this.recompute();
    this.updateSupply();
    if (f.gift) this.spawnLegion(f.gift, this.spawnRegion());
    this.bus.emit('warToast', `Союзник: ${f.name}`);
    return null;
  }

  // Союзника можно съесть. Рой поумнел, но остался пауком.
  feast(id) {
    const f = FIGURES.find((x) => x.id === id);
    if (!this.allies.includes(id)) return;
    this.allies = this.allies.filter((x) => x !== id);
    this.biomass += f.feast;
    this.tension = Math.max(0, this.tension - 2);
    this.recompute();
    this.updateSupply();
    this.bus.emit('warToast', `${f.name}: кокон. +${f.feast} биомассы`);
  }

  researchable(n) {
    if (this.done[n.id] || this.active.some((a) => a.id === n.id)) return false;
    return n.tier === 0 || !!this.done[`${n.branch}${n.tier - 1}`];
  }

  research(id) {
    const n = RESEARCH.find((x) => x.id === id);
    if (!n || !this.researchable(n)) return 'Сначала прошлый узел';
    if (this.active.length >= this.slots) return 'Все темы заняты';
    this.active.push({ id, left: n.days, full: n.days });
    return null;
  }

  focus(id) {
    const n = FOCUS.find((x) => x.id === id);
    if (!n || !focusOpen(n, this.focusDone)) return 'Этот путь закрыт';
    if (this.focusNow) return 'Рой уже думает над другим';
    this.focusNow = { id, left: n.days, full: n.days };
    return null;
  }

  updateScience(dt) {
    const labs = this.regions.filter((r) => r.lab && r.owner === 'swarm').length;
    const speed = this.mods.research * (1 + labs * 0.07);
    for (const a of [...this.active]) {
      a.left -= dt * speed;
      if (a.left > 0) continue;
      this.active = this.active.filter((x) => x !== a);
      this.done[a.id] = true;
      this.recompute();
      this.updateSupply();
      this.bus.emit('warResearch', RESEARCH.find((n) => n.id === a.id));
    }
    const f = this.focusNow;
    if (!f) return;
    f.left -= dt * this.mods.focus;
    if (f.left > 0) return;
    this.focusNow = null;
    this.focusDone[f.id] = true;
    this.recompute();
    this.updateSupply();
    const n = FOCUS.find((x) => x.id === f.id);
    this.bus.emit('warFocus', n);
    if (n.story) this.pushCard({ kind: 'story', title: n.story.title, text: n.story.text, options: [{ label: 'Дальше', effect: {} }] });
  }

  updateProduction(dt) {
    const n = Math.min(this.lines, this.queue.length);
    for (let i = n - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.left -= dt;
      if (q.left > 0) continue;
      this.queue.splice(i, 1);
      const u = this.spawnLegion(q.type, this.spawnRegion());
      if (this.instinct) u.auto = true;
      this.bus.emit('warLegion', u);
    }
  }

  // Отдых: дух и сила возвращаются на своей земле, а сила стоит биомассы.
  updateUnits(dt) {
    for (const u of [...this.units]) {
      this.stepUnit(u, dt);
      if (u.moveT > 0) continue;
      if (!u.attacking) u.dig = Math.min(1, (u.dig ?? 0) + dt / 40);
      if (u.side !== 'swarm' && this.byId[u.region].pocket) {
        u.org -= 1.6 * dt;
        if (u.org <= 0) {
          this.removeUnit(u, false);
          this.tally.broken++;
          this.biomass += 50;
          this.bus.emit('warToast', `Котёл: сдалась армия, ${this.byId[u.region].name}`);
        }
        continue;
      }
      if (u.fight) continue;
      if (u.side === 'swarm') {
        const fed = this.isSupplied(u.region);
        u.org = Math.min(100, u.org + (fed ? K.orgRegen : 0.4) * this.mods.orgRegen * dt);
        if (fed && u.str < 100 && this.biomass > 0) {
          const add = Math.min(100 - u.str, K.strRegen * this.mods.refill * dt);
          u.str += add;
          this.biomass -= add * K.refillCost;
        }
        if (!fed && u.str > 40) u.str -= 0.06 * dt;
      } else {
        u.org = Math.min(100, u.org + K.orgRegen * dt);
        u.str = Math.min(100, u.str + 0.9 * dt);
      }
    }
  }

  updateRegions(dt) {
    const hit = new Set();
    for (const u of this.units) if (u.attacking) hit.add(u.attacking);
    const regen = 0.004 + this.stage * 0.002;
    for (const r of this.regions) {
      r.blackT = Math.max(0, r.blackT - dt);
      r.burnT = Math.max(0, r.burnT - dt);
      if (r.owner !== 'swarm') {
        if (r.pocket) r.garrison *= 1 - 0.012 * dt;
        else if (!hit.has(r.id)) r.garrison = Math.min(r.gMax * (1 + this.stage * 0.2), r.garrison + r.gMax * regen * dt);
      } else {
        const top = this.T.swarmGarrison * this.mods.home * (r.nest ? 2.5 : 1);
        if (!hit.has(r.id)) r.garrison = Math.min(top, r.garrison + 0.5 * dt);
        if (r.people > 0) {
          const v = Math.min(r.people, (r.pop / (r.vassal ? 200 : 60)) * dt);
          r.people -= v;
          this.people -= v * this.map.peopleK;
        }
      }
    }
  }

  // Блоки решают раз в несколько дней: выпускать армии, идти к границе, бить слабое место.
  updateAI() {
    this.updatePockets();
    const swarmDist = this.foeDistance();
    for (const f of this.factions) {
      if (!f.war || f.surrendered) continue;
      const owned = this.regions.filter((r) => r.owner === f.id);
      if (!owned.length) continue;
      const pop = owned.reduce((v, r) => v + r.pop, 0);
      const gain = (0.5 + (pop / 1e9) * 1.4) * this.T.foeProd * (0.45 + this.stage * 0.5) * K.aiEvery;
      if (f.disarray <= 0) f.pool += gain;
      const armies = this.units.filter((u) => u.side === f.id);
      const max = 1 + Math.floor(owned.length / (this.stage ? 3 : 4)) + this.stage;
      if (f.pool >= this.T.foeCost && armies.length < max) {
        f.pool -= this.T.foeCost;
        const spot = [...owned].sort((a, b) => (swarmDist.get(a.id) ?? 99) - (swarmDist.get(b.id) ?? 99))[0];
        const u = this.makeUnit(f.id, 'human', spot.id);
        u.name = `Армия: ${f.name}`;
        this.units.push(u);
        armies.push(u);
      }
      this.updatePlan(f, armies);
      for (const u of armies) this.thinkArmy(u, swarmDist);
    }
  }

  // Котёл: земля людей, отрезанная от всех их столиц. Там армии теряют дух и сдаются.
  updatePockets() {
    const seen = new Set();
    const q = [];
    for (const f of this.factions) {
      if (this.byId[f.capital].owner !== 'swarm' && !f.surrendered) {
        seen.add(f.capital);
        q.push(f.capital);
      }
    }
    for (let head = 0; head < q.length; head++) {
      for (const n of this.byId[q[head]].neighbors) {
        if (seen.has(n) || this.byId[n].owner === 'swarm') continue;
        seen.add(n);
        q.push(n);
      }
    }
    for (const r of this.regions) {
      const pocket = r.owner !== 'swarm' && !seen.has(r.id);
      if (pocket && !r.pocket && this.units.some((u) => u.region === r.id && u.side !== 'swarm')) this.bus.emit('warPocket', r);
      r.pocket = pocket;
    }
  }

  // Блок готовит удар заранее: игрок видит цель и успевает ответить.
  updatePlan(f, armies) {
    if (!this.map.plans) return;
    const p = f.plan;
    if (p) {
      p.t -= K.aiEvery;
      if (this.byId[p.target].owner !== 'swarm' || this.byId[p.stage].owner === 'swarm' || p.t < -40) {
        f.plan = null;
        f.planT = Math.max(70, 150 - this.stage * 18);
      }
      return;
    }
    f.planT -= K.aiEvery;
    if (f.planT > 0 || armies.length < 2) return;
    let best = null;
    for (const r of this.regions) {
      if (r.owner !== f.id) continue;
      for (const n of r.neighbors) {
        const o = this.byId[n];
        if (o.owner !== 'swarm' || o.id === this.map.start || r.sea?.includes(n)) continue;
        const value = (o.nest ? 120 : 0) + (o.res ? 40 : 0) - this.strength(o) + this.rng.next() * 40;
        if (!best || value > best.value) best = { value, stage: r.id, target: n };
      }
    }
    if (!best) return;
    f.plan = { target: best.target, stage: best.stage, t: this.rng.range(36, 52) };
    this.bus.emit('warPlan', { faction: f, target: this.byId[best.target] });
  }

  humanStep(from, to) {
    const prev = new Map([[from, null]]);
    const q = [from];
    for (let head = 0; head < q.length; head++) {
      const id = q[head];
      if (id === to) {
        let cur = id;
        while (prev.get(cur) !== from && prev.get(cur) !== null) cur = prev.get(cur);
        return cur === from ? null : cur;
      }
      const r = this.byId[id];
      for (const n of r.neighbors) {
        if (prev.has(n) || this.byId[n].owner === 'swarm' || r.sea?.includes(n)) continue;
        prev.set(n, id);
        q.push(n);
      }
    }
    return null;
  }

  // Цели кампании: всегда есть ближайшая задача и награда за неё.
  updateGoals(dt) {
    if (!this.map.goals) return;
    const t = this.tally;
    for (const g of [...this.goals]) {
      g.left -= dt;
      let done = false;
      let failed = g.left <= 0;
      if (g.kind === 'take') done = this.byId[g.target].owner === 'swarm';
      if (g.kind === 'count') done = t.taken - g.from >= g.need;
      if (g.kind === 'break') done = t.broken - g.from >= g.need;
      if (g.kind === 'hold') {
        failed = t.lost > g.from;
        done = !failed && g.left <= 0;
      }
      if (!done && !failed) continue;
      this.goals = this.goals.filter((x) => x !== g);
      if (done) {
        this.biomass += g.biomass;
        this.influencePts += g.influence;
        this.bus.emit('warGoal', g);
      }
    }
    this.goalT -= dt;
    if (this.goalT > 0 || this.goals.length >= 3) return;
    this.goalT = 28;
    const g = this.newGoal();
    if (g) this.goals.push(g);
  }

  newGoal() {
    const used = new Set(this.goals.map((g) => g.kind));
    const kinds = ['take', 'count', 'hold', 'break'].filter((k) => !used.has(k));
    if (!kinds.length) return null;
    const kind = this.rng.pick(kinds);
    const pay = { biomass: Math.round(110 + 45 * this.stage + this.tally.taken * 6), influence: 6 + this.stage * 2 };
    const t = this.tally;
    if (kind === 'take') {
      const near = this.regions.filter((r) => this.border(r) && !r.sealed && !this.isPact(r));
      const rich = near.filter((r) => r.res || this.factionById[r.owner]?.capital === r.id);
      const r = this.rng.pick(rich.length ? rich : near);
      if (!r) return null;
      return { kind, target: r.id, text: `Возьми: ${r.name}`, left: 240, full: 240, ...pay };
    }
    if (kind === 'count') {
      const need = 2 + this.stage;
      return { kind, need, from: t.taken, text: `Захвати регионов: ${need}`, left: 260, full: 260, ...pay };
    }
    if (kind === 'break') {
      if (!this.units.some((u) => u.side !== 'swarm')) return null;
      const need = 2 + this.stage;
      return { kind, need, from: t.broken, text: `Разбей армий людей: ${need}`, left: 280, full: 280, ...pay };
    }
    return { kind, from: t.lost, text: 'Не потеряй ни одного региона', left: 150, full: 150, ...pay };
  }

  foeDistance() {
    const dist = new Map();
    const q = [];
    for (const r of this.regions) {
      if (r.owner === 'swarm') {
        dist.set(r.id, 0);
        q.push(r.id);
      }
    }
    for (let head = 0; head < q.length; head++) {
      const r = this.byId[q[head]];
      for (const n of r.neighbors) {
        if (dist.has(n) || r.sea?.includes(n)) continue;
        dist.set(n, dist.get(r.id) + 1);
        q.push(n);
      }
    }
    return dist;
  }

  thinkArmy(u, dist) {
    if (u.routed || u.moveT > 0) return;
    if (u.attacking) {
      if (u.org < 22) this.stop(u);
      return;
    }
    if (u.org < 45) return;
    const here = this.byId[u.region];
    if (this.units.some((o) => o.side === 'swarm' && o.attacking === here.id)) return;
    const plan = this.factionById[u.side].plan;
    if (plan) {
      if (u.region === plan.stage) {
        if (plan.t <= 0) u.path = [plan.target];
        return;
      }
      const step = this.humanStep(u.region, plan.stage);
      if (step) {
        u.path = [step];
        return;
      }
    }
    const near = here.neighbors.filter((n) => !here.sea?.includes(n)).map((n) => this.byId[n]);
    // Удар по слабому месту: стадии делают людей смелее.
    const prey = near.filter((r) => r.owner === 'swarm' && r.id !== this.map.start);
    if (prey.length && this.stage >= 1) {
      const pick = prey.sort((a, b) => this.strength(a) - this.strength(b))[0];
      const mine = this.power(u, 'atk') * 12;
      if (this.strength(pick) < mine * (0.5 + this.stage * 0.2) && this.rng.next() < 0.5) {
        u.path = [pick.id];
        return;
      }
    }
    const help = near.find((r) => r.owner !== 'swarm' && this.units.some((o) => o.side === 'swarm' && o.attacking === r.id) && !this.unitsAt(r.id).some((o) => o.side !== 'swarm'));
    if (help) {
      u.path = [help.id];
      return;
    }
    if ((dist.get(here.id) ?? 99) <= 1) return;
    const step = near.filter((r) => r.owner !== 'swarm').sort((a, b) => (dist.get(a.id) ?? 99) - (dist.get(b.id) ?? 99))[0];
    if (step && (dist.get(step.id) ?? 99) < (dist.get(here.id) ?? 99)) u.path = [step.id];
  }

  // Легион на самостоятельном наступлении: бьёт самого слабого соседа, устав, отдыхает.
  thinkLegion(u) {
    if (u.routed || u.moveT > 0) return;
    if (u.org < 30 || u.str < 30) {
      if (u.attacking) this.stop(u);
      return;
    }
    if (u.attacking || u.path.length) return;
    if (u.org < 65) return;
    const here = this.byId[u.region];
    const near = here.neighbors
      .filter((n) => this.canCross(here, n))
      .map((n) => this.byId[n])
      .filter((r) => r.owner !== 'swarm' && !r.sealed && !this.isPact(r) && (this.instinct || this.atWar(r)));
    if (near.length) {
      u.path = [near.sort((a, b) => this.strength(a) - this.strength(b))[0].id];
      return;
    }
    const front = this.frontStep(here);
    if (front) u.path = [front];
  }

  // Шаг к ближайшему фронту по своей земле.
  frontStep(from) {
    const prev = new Map([[from.id, null]]);
    const q = [from.id];
    for (let head = 0; head < q.length; head++) {
      const r = this.byId[q[head]];
      const edge = r.neighbors.some((n) => {
        const o = this.byId[n];
        return o.owner !== 'swarm' && !o.sealed && !this.isPact(o) && this.canCross(r, n) && (this.instinct || this.atWar(o));
      });
      if (edge && r.id !== from.id) {
        let id = r.id;
        while (prev.get(id) !== from.id) id = prev.get(id);
        return id;
      }
      for (const n of r.neighbors) {
        if (prev.has(n) || this.byId[n].owner !== 'swarm' || !this.canCross(r, n)) continue;
        prev.set(n, r.id);
        q.push(n);
      }
    }
    return null;
  }

  updateFactions(dt) {
    const stage = this.stage;
    for (const f of this.factions) {
      if (f.surrendered) continue;
      f.disarray = Math.max(0, f.disarray - dt);
      if (f.pactT > 0) {
        f.pactT -= dt;
        if (stage >= 3 && !this.mods.keepPacts) {
          f.pactT = 0;
          f.tribute = false;
          this.bus.emit('warToast', `Коалиция сорвала пакт: ${f.name}`);
        }
        if (f.pactT <= 0) f.tribute = false;
      }
      if (f.war || f.pactT > 0) continue;
      const near = this.regions.some((r) => r.owner === f.id && this.border(r));
      if ((stage >= 2 && near) || stage >= 3) this.declare(f);
    }
    if (!this.coalition && stage >= 3) {
      this.coalition = true;
      this.bus.emit('radio', { who: 'Лена', text: 'Все блоки подписали. Теперь у людей одна армия.' });
    }
  }

  blackout(id) {
    const r = this.byId[id];
    if (this.blackoutCd > 0) return 'Блэкаут перезаряжается';
    if (!r || r.owner === 'swarm') return 'Блэкаут только по людям';
    r.blackT = this.T.blackoutTime;
    if (r.sealed) {
      r.sealed = false;
      this.bus.emit('warToast', `${r.name}: кордон снят`);
    }
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

  // Клик по красной метке выводит легионы из-под удара.
  evacuate() {
    const n = this.nuke;
    if (!n) return;
    n.safe = true;
    const r = this.byId[n.region];
    const out = r.neighbors.map((x) => this.byId[x]).find((o) => o.owner === 'swarm' && this.canCross(r, o.id));
    for (const u of this.legions()) {
      if (u.region !== r.id || u.moveT > 0) continue;
      this.stop(u);
      if (out) this.startMove(u, out.id);
    }
  }

  spawnDepot(kind) {
    const list = this.regions.filter((r) => this.border(r) || r.owner === 'swarm');
    const r = this.rng.pick(list);
    this.depots.push({ kind, region: r.id, life: this.T.depotLife, value: Math.round(30 + Math.max(0, this.income) * 14) });
  }

  pushCard(card) {
    if (this.card) this.cards.push(card);
    else this.showCard(card);
  }

  showCard(card) {
    this.card = card;
    this.bus.emit('warCard', card);
  }

  // Новые союзники сами выходят на связь, когда рой становится достаточно страшен.
  checkFigures(dt) {
    if (!this.map.politics) return;
    this.figureT -= dt;
    if (this.figureT > 0 || this.card) return;
    const f = FIGURES.find((x) => !this.met[x.id] && x.when(this));
    if (!f) return;
    this.met[f.id] = true;
    this.figureT = 150;
    this.pushCard({
      kind: 'figure',
      figure: f.id,
      title: f.name,
      role: f.role,
      text: `«${f.quote}»`,
      perk: f.perk,
      options: [
        { label: `Принять союз: ${f.cost} влияния`, effect: { ally: f.id } },
        { label: 'Промолчать', effect: {} },
        { label: `Заманить и съесть: +${Math.round(f.feast / 2)} биомассы`, effect: { biomass: Math.round(f.feast / 2), tension: 1 } },
      ],
    });
  }

  // Истории приходят к тем, кто уже с роем.
  checkTales(dt) {
    this.taleT -= dt;
    if (this.taleT > 0 || this.card) return;
    const tale = TALES.find((x) => this.allies.includes(x.figure) && !this.talesDone[x.title]);
    if (!tale) return;
    this.talesDone[tale.title] = true;
    this.taleT = 240;
    const f = FIGURES.find((x) => x.id === tale.figure);
    this.pushCard({ kind: 'tale', figure: f.id, role: f.name, title: tale.title, text: tale.text, options: tale.options });
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
    if (t.signal <= 0 && this.stage >= 2 && this.map.dawn) {
      t.signal = this.rng.range(50, 80);
      this.spawnDepot('signal');
    }
    this.blackoutCd = Math.max(0, this.blackoutCd - dt);

    // Ядерные удары: у игрока есть несколько секунд, чтобы вывести легионы.
    if (this.nuke) {
      this.nuke.t -= dt;
      if (this.nuke.t <= 0) {
        const r = this.byId[this.nuke.region];
        r.burnT = 120;
        r.garrison = 0;
        for (const u of this.legions()) {
          if (u.region === r.id && u.moveT <= 0) {
            u.str *= 1 - 0.6 * this.mods.nukeArmor;
            u.org *= 0.4;
          }
        }
        this.tension = clamp(this.tension + 0.5, 0, 100);
        this.bus.emit('warNuke', { region: r, safe: this.nuke.safe });
        this.nuke = null;
      }
    } else if (this.stage >= 3 && this.map.nukes) {
      t.nuke -= dt;
      if (t.nuke <= 0) {
        t.nuke = this.rng.range(110, 170) - (this.stage - 3) * 30;
        const mine = this.regions.filter((r) => r.owner === 'swarm' && r.id !== this.map.start);
        const hot = mine.filter((r) => this.legions().some((u) => u.region === r.id));
        const pool = hot.length ? hot : mine;
        if (pool.length) {
          this.nuke = { region: this.rng.pick(pool).id, t: this.T.nukeWarn, safe: false };
          this.bus.emit('warNukeWarn', this.nuke);
        }
      }
    }

    // Лена ведёт проект «Рассвет»: при 100 рой теряет дух и приграничные регионы.
    if (this.stage >= 2 && this.map.dawn && this.lena) this.dawn += dt * (0.035 + this.stage * 0.012) * this.mods.dawn;
    if (this.dawn >= 100) {
      this.dawn = 25;
      const border = this.regions.filter((r) => r.owner === 'swarm' && r.id !== this.map.start && r.neighbors.some((n) => this.byId[n].owner !== 'swarm'));
      for (let i = 0; i < 3 && border.length; i++) this.lose(border.splice(Math.floor(this.rng.next() * border.length), 1)[0]);
      for (const u of this.legions()) u.org *= 0.5;
      this.bus.emit('warDawn');
    }

    t.event -= dt;
    if (t.event <= 0 && this.events.length && !this.card) {
      t.event = this.rng.range(120, 200);
      this.eventsUsed++;
      const e = this.events.shift();
      this.showCard({ kind: 'event', title: e.title, text: e.text, options: e.options });
    }
    this.checkFigures(dt);
    this.checkTales(dt);
  }

  chooseCard(option) {
    if (!this.card) return;
    const e = option.effect ?? {};
    this.biomass = Math.max(0, this.biomass + (e.biomass ?? 0));
    this.tension = clamp(this.tension + (e.tension ?? 0), 0, 100);
    this.dawn = clamp(this.dawn + (e.dawn ?? 0), 0, 99);
    this.influencePts = Math.max(0, this.influencePts + (e.influence ?? 0));
    if (e.armies > 0) for (let i = 0; i < e.armies; i++) this.spawnLegion('swarm', this.spawnRegion());
    if (e.armies < 0) {
      const list = this.legions();
      for (let i = 0; i < -e.armies && list.length; i++) {
        const u = list[Math.floor(this.rng.next() * list.length)];
        u.str = Math.max(20, u.str - 40);
      }
    }
    if (e.ally) {
      const err = this.ally(e.ally);
      if (err) this.bus.emit('warToast', err);
    }
    if (e.leave) {
      this.allies = this.allies.filter((x) => x !== e.leave);
      this.recompute();
      this.updateSupply();
      this.bus.emit('warToast', `${FIGURES.find((x) => x.id === e.leave).name} больше не с роем`);
    }
    this.card = null;
    if (this.cards.length) this.showCard(this.cards.shift());
  }

  tick(dt) {
    if (this.finished) return;
    this.day += dt;
    const income = this.income;
    this.lastIncome = income;
    this.biomass = Math.max(0, this.biomass + income * dt);
    this.earned += Math.max(0, income) * dt;
    this.influencePts += this.influenceRate * dt;
    this.tension = Math.max(0, this.tension - dt * 0.004);
    const t = this.timers;
    t.supply -= dt;
    if (t.supply <= 0) {
      t.supply = K.supplyEvery;
      this.updateSupply();
    }
    this.updateUnits(dt);
    this.updateBattles(dt);
    if (this.finished) return;
    t.ai -= dt;
    if (t.ai <= 0) {
      t.ai = K.aiEvery;
      this.updateAI();
    }
    t.auto -= dt;
    if (t.auto <= 0) {
      t.auto = K.autoEvery;
      for (const u of this.legions()) if (u.auto) this.thinkLegion(u);
    }
    this.updateRegions(dt);
    this.updateGoals(dt);
    this.updateProduction(dt);
    this.updateScience(dt);
    this.updateFactions(dt);
    this.updateTimers(dt);
  }

  // Инстинкт: рой играет сам. Этим же ботом считается баланс.
  autoplay() {
    this.instinct = true;
    for (const u of this.legions()) u.auto = true;
    if (this.nuke && !this.nuke.safe) this.evacuate();
    for (const d of [...this.depots]) this.takeDepot(d);
    if (this.card) this.chooseCard(this.card.options[0]);

    while (this.active.length < this.slots) {
      const open = RESEARCH.filter((n) => this.researchable(n)).sort((a, b) => a.days - b.days);
      if (!open[0] || this.research(open[0].id)) break;
    }
    if (!this.focusNow && this.map.politics) {
      const next = FOCUS.filter((n) => focusOpen(n, this.focusDone)).sort((a, b) => a.row - b.row)[0];
      if (next) this.focus(next.id);
    }
    if (this.mods.diplomacy && this.stage < 3) {
      const far = this.factions.find((f) => !f.war && !f.surrendered && f.pactT <= 0 && !this.regions.some((r) => r.owner === f.id && this.border(r)));
      if (far && this.influencePts >= this.pactCost() + 20) this.pact(far.id);
    }
    const best = ['widow', 'chitin', 'swarm'].find((t) => this.legionOpen(t)) ?? 'swarm';
    const full = this.legions().length + this.queue.length >= this.cap;
    if (!full && this.biomass >= this.legionCost(best) + 30) this.buildLegion(best);
    if (full && this.biomass >= this.nestCost()) {
      const spot = this.regions.filter((r) => r.owner === 'swarm' && !r.nest).sort((a, b) => b.pop - a.pop)[0];
      if (spot) this.buildNest(spot.id);
    }
    const sealed = this.regions.find((r) => r.sealed && this.border(r));
    if (sealed && !this.blackoutCd) this.blackout(sealed.id);
    const hit = this.legions().find((u) => u.attacking)?.attacking;
    if (hit && !this.blackoutCd) this.blackout(hit);
  }

  // Снимок для сохранения: только данные.
  snapshot() {
    return {
      day: this.day,
      biomass: this.biomass,
      earned: this.earned,
      influencePts: this.influencePts,
      tension: this.tension,
      dawn: this.dawn,
      people: this.people,
      units: this.units,
      nextUnit: this.nextUnit,
      legionNo: this.legionNo,
      queue: this.queue,
      nests: this.nests,
      blackoutCd: this.blackoutCd,
      done: this.done,
      active: this.active,
      focusDone: this.focusDone,
      focusNow: this.focusNow,
      allies: this.allies,
      met: this.met,
      figureT: this.figureT,
      taleT: this.taleT,
      talesDone: this.talesDone,
      goals: this.goals,
      goalT: this.goalT,
      tally: this.tally,
      eventsUsed: this.eventsUsed,
      lena: this.lena,
      coalition: this.coalition,
      timers: this.timers,
      factions: this.factions.map((f) => [f.id, f.war, f.pactT, f.surrendered, f.pool, f.disarray, f.tribute, f.plan, f.planT]),
      regions: this.regions.map((r) => [r.id, r.owner, r.garrison, r.gMax, r.people, r.nest, r.hadNest, r.burnT, r.vassal, r.taken]),
    };
  }

  restore(s) {
    const { regions, factions, ...rest } = s;
    Object.assign(this, rest);
    for (const u of this.units) Object.assign(u, { stance: u.stance ?? 'normal', dig: u.dig ?? 0, xp: u.xp ?? 0, title: u.title ?? '' });
    for (const [id, war, pactT, surrendered, pool, disarray, tribute, plan, planT] of factions) {
      Object.assign(this.factionById[id], { war, pactT, surrendered, pool, disarray, tribute, plan: plan ?? null, planT: planT ?? 90 });
    }
    for (const [id, owner, garrison, gMax, people, nest, hadNest, burnT, vassal, taken] of regions) {
      Object.assign(this.byId[id], { owner, garrison, gMax, people, nest, hadNest, burnT, vassal, taken });
    }
    this.recompute();
    this.updateSupply();
  }
}
