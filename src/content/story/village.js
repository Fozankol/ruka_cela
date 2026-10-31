import { dist } from '../../core/util.js';
import { dropTorch, goTo, setState } from '../../sim/humans.js';
import { OutdoorScript } from './outdoor.js';

const NEST_COST = 45;
const NEST_STEP = 30;
const NEST_GAP = 14;
const FIGHTER_COST = 22;
const FIGHTER_STEP = 3;
const FIGHTERS_CAP = 16;
const STORM_NEED = 8;
const FOE_HP = 5;
const BURN = 3.2;
const FIRST_MARCH = 75;
const NEXT_MARCH = 62;
const WARN = 8;
const BELL_HP = 120;
const BELL_HIT = 1.4;
const FOOD_PER_HOUSE = 26;

// Село: гнёзда ускоряют сбор, бойцы их охраняют, штурм набата заканчивает этап.
export class VillageScript extends OutdoorScript {
  begin() {
    const { w } = this;
    const L = w.level;
    this.paints = true;
    this.alertLabel = 'Набат';
    w.silk = w.rules.silkStart;
    for (let i = 0; i < w.rules.treats; i++) w.addTreat();
    this.zoneNext = 1;
    this.placing = false;
    this.builtNests = 0;
    this.boughtFighters = 0;
    this.marchT = FIRST_MARCH;
    this.warned = false;
    this.wave = 0;
    this.goal = null;
    this.storming = false;
    this.burnFx = 0;
    const c = L.points.church;
    w.bell = { x: c.x, z: c.z, hp: BELL_HP, field: w.grid.flow(c.x, c.z, 'spider'), fieldV: -1 };
    this.burnWeb = 0;
    w.nests[0].hp = 100;
  }

  moodFloor() {
    return this.storming ? 1 : this.foes().length ? 0.8 : this.warned ? 0.6 : 0;
  }

  summary() {
    return `Набат молчит. Волн дружины отбито: ${this.wave}.`;
  }

  progress() {
    return this.storming ? 1 - (this.w.bell.hp / BELL_HP) * 0.17 : Math.min(0.8, this.w.stats.gathered / 360);
  }

  meter() {
    const { w } = this;
    if (this.storming) return { label: 'Набат', text: `${Math.ceil(w.bell.hp)}`, share: w.bell.hp / BELL_HP };
    const n = w.count('fighter');
    return { label: 'Бойцы', text: `${n} / ${STORM_NEED}`, share: Math.min(1, n / STORM_NEED) };
  }

  nestCost() {
    return NEST_COST + this.builtNests * NEST_STEP;
  }

  fighterCost() {
    return FIGHTER_COST + this.boughtFighters * FIGHTER_STEP;
  }

  actions() {
    const { w } = this;
    const nc = this.nestCost();
    const fc = this.fighterCost();
    return [
      {
        label: this.placing ? 'Кликни по земле' : `Гнездо: ${nc} еды`,
        disabled: !this.placing && w.food < nc,
        run: () => (this.placing = !this.placing),
      },
      {
        label: `Боец: ${fc} еды`,
        disabled: w.food < fc || w.count('fighter') >= FIGHTERS_CAP || this.storming,
        run: () => {
          if (w.food < fc) return;
          w.food -= fc;
          this.boughtFighters++;
          const n = w.nests[w.nests.length - 1];
          w.spawn('fighter', n.x, n.z + 1);
          if (w.count('fighter') >= STORM_NEED) w.setObjective('Бойцов хватает. Кликни по красному кругу у церкви: рой пойдёт на штурм.');
        },
      },
      {
        label: `Вдова: ${this.widowCost()} еды`,
        disabled: w.food < this.widowCost() || w.count('widow') >= 2,
        run: () => this.buyWidow(),
      },
    ];
  }

  place(x, z) {
    const { w } = this;
    const g = w.grid;
    if (!g.spiderOk(g.at(x, z))) return w.bus.emit('notice', 'Здесь нельзя');
    if (!w.onWeb(x, z)) return w.bus.emit('notice', 'Гнездо ставится только на паутине');
    if (w.nests.some((n) => dist(n.x, n.z, x, z) < NEST_GAP)) return w.bus.emit('notice', 'Слишком близко к другому гнезду');
    const c = this.nestCost();
    if (w.food < c) return w.bus.emit('notice', 'Не хватает еды');
    w.food -= c;
    this.builtNests++;
    this.placing = false;
    const nest = w.addNest(x, z);
    nest.hp = 100;
    nest.fieldV = -1;
    w.stats.clicks++;
    if (this.builtNests === 1) w.setObjective('Рабочие сдают еду в ближайшее гнездо. Дружина сжигает гнёзда, поэтому заведи бойцов.');
    return null;
  }

  targets() {
    const { w } = this;
    const out = [];
    if (!this.storming && w.count('fighter') >= STORM_NEED) out.push({ x: w.bell.x, z: w.bell.z, label: 'Штурм набата', hot: true, run: () => this.storm() });
    if (w.count('widow')) for (const h of this.foes()) out.push({ x: h.x, z: h.z, small: true, label: 'Укусить дружинника', run: () => this.hunt(h) });
    return out;
  }

  labels() {
    const { w } = this;
    const c = w.level.points.church;
    const march = this.foes().length ? 'Дружина вышла' : this.storming ? 'Штурм' : `Выход через ${Math.max(0, Math.ceil(this.marchT))} с`;
    const out = [{ x: c.x, y: 8, z: c.z - 4, text: 'Церковь', sub: 'Отсюда выходит дружина', note: march }];
    for (const n of w.nests) if (n.hp < 100) out.push({ x: n.x, y: 2, z: n.z, text: 'Гнездо горит', note: `${Math.ceil(n.hp)}` });
    return out;
  }

  circles() {
    const out = [];
    if (this.goal) out.push({ x: this.goal.x, z: this.goal.z, r: 7, hot: true });
    return out;
  }

  foes() {
    return this.w.humans.filter((h) => h.foe);
  }

  // Набат собирает дружину: чем больше еды носит рой, тем раньше она выходит.
  onAlarm() {
    const { w } = this;
    w.alert = 45;
    if (!this.foes().length) this.marchT = Math.min(this.marchT, WARN);
  }

  nearestNest() {
    const { w } = this;
    const c = w.level.points.church;
    return [...w.nests].sort((a, b) => dist(a.x, a.z, c.x, c.z) - dist(b.x, b.z, c.x, c.z))[0];
  }

  march(n) {
    const { w } = this;
    const L = w.level;
    const free = w.humans.filter((h) => h.state === 'gone');
    const d = L.points.churchDoor;
    this.goal = this.nearestNest();
    free.slice(0, n).forEach((h, i) => {
      this.emerge(h, { x: d.x + i * 1.2, z: d.z });
      h.home = d;
      h.foe = true;
      h.hp = FOE_HP;
      h.brain = (world, hm) => {
        hm.pause = 0.4;
        if (this.goal) goTo(world, hm, this.goal.x, this.goal.z, () => {}, hm.speed);
      };
    });
    w.say('Дружина идёт к гнезду!', { big: true, ms: 1800 });
    w.bus.emit('shake', 0.3);
  }

  onFoeDown(h) {
    const { w } = this;
    this.wrap(h);
    w.bus.emit('ripple', { x: h.x, z: h.z, power: 1, kind: 'bite' });
    if (!this.foes().length && !this.storming && this.goal) {
      this.goal = null;
      w.food += 20;
      w.say('Дружина разбита.', { ms: 2200 });
    }
  }

  onBite(h) {
    this.onFoeDown(h);
  }

  onCocoon() {
    const { w } = this;
    w.food += 6;
    w.bus.emit('deposit', { x: w.nests[0].x, z: w.nests[0].z, v: 6 });
  }

  // Факелы выжигают нити там, где идёт дружина.
  burnPath(dt) {
    const { w } = this;
    this.burnWeb -= dt;
    if (this.burnWeb > 0) return;
    this.burnWeb = 0.35;
    const r = Math.round((0.7 * w.unitK) / w.grid.cell);
    for (const h of this.foes()) w.eraseWeb(h.x, h.z, r);
  }

  burn(dt) {
    const { w } = this;
    const n = this.goal;
    if (!n) return;
    const near = this.foes().filter((h) => dist(h.x, h.z, n.x, n.z) < 2.2 * w.unitK).length;
    if (!near) return;
    n.hp -= BURN * near * dt;
    this.burnFx -= dt;
    if (this.burnFx <= 0) {
      this.burnFx = 0.45;
      w.bus.emit('ripple', { x: n.x, z: n.z, power: 1, kind: 'death' });
    }
    if (n.hp > 0) return;
    if (n.home) {
      n.hp = 45;
      w.food *= 0.6;
      this.goal = null;
      w.say('Гнездо горит. Рой потерял часть запасов.', { ms: 3000 });
      for (const h of this.foes()) {
        h.foe = false;
        this.sendHome(h);
      }
      return;
    }
    w.removeNest(n);
    w.say('Гнездо сгорело.', { ms: 2200 });
    this.goal = this.nearestNest();
  }

  storm() {
    const { w } = this;
    this.storming = true;
    w.stats.clicks++;
    w.setObjective('Рой идёт на церковь. Покупать бойцов поздно, смотри.');
    w.bus.emit('radio', { who: 'Староста', text: 'Бейте в набат! Все к церкви!' });
    for (const s of w.spiders) if (s.kind === 'fighter') s.order = { type: 'storm' };
    this.marchT = Infinity;
    this.march(w.humans.length);
  }

  hitBell(dt) {
    const { w } = this;
    const b = w.bell;
    b.hp -= BELL_HIT * dt;
    this.burnFx -= dt;
    if (this.burnFx <= 0) {
      this.burnFx = 0.5;
      w.bus.emit('ripple', { x: b.x, z: b.z, power: 1, kind: 'bite' });
      w.bus.emit('shake', 0.12);
    }
    if (b.hp <= 0 && this.step !== 'done') {
      w.bus.emit('shake', 0.6);
      for (const h of this.foes()) this.sendHome(h);
      for (let i = 0; i < w.level.zones.length; i++) w.bus.emit('zone', { index: i, world: w });
      this.complete();
    }
  }

  update(dt) {
    const { w } = this;
    const L = w.level;
    const want = Math.floor(w.stats.gathered / FOOD_PER_HOUSE);
    while (this.zoneNext < L.zones.length - 1 && this.zoneNext <= want) {
      w.bus.emit('zone', { index: this.zoneNext, world: w });
      this.zoneNext++;
      L.population = Math.max(0, L.population - 4);
    }
    this.burn(dt);
    this.burnPath(dt);
    if (this.storming && !w.count('fighter')) {
      this.storming = false;
      this.marchT = NEXT_MARCH;
      for (const h of this.foes()) {
        h.foe = false;
        this.sendHome(h);
      }
      w.setObjective('Штурм захлебнулся. Собери новых бойцов.');
      return;
    }
    if (this.foes().length) return;
    this.marchT -= dt;
    if (this.marchT <= WARN && !this.warned) {
      this.warned = true;
      w.say('Звонит набат', { ms: 2600 });
      w.bus.emit('alarm');
    }
    if (this.marchT <= 0) {
      this.warned = false;
      this.marchT = NEXT_MARCH;
      this.wave++;
      this.march(Math.min(2 + this.wave, 6));
    }
  }
}
