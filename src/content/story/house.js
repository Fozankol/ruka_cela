import { dist } from '../../core/util.js';
import { goTo, lieDown, setState, stomp, wake } from '../../sim/humans.js';
import { FOOD_GOAL } from '../../sim/world.js';
import { RadioFeed } from './feed.js';

const ROOM_LAMPS = ['bedroom', 'hall', 'kitchen', 'bath', 'grandpa'];

// Сценарий первого масштаба: вступление, сбор вкусняшек, изгнание жильцов.
export class HouseScript {
  constructor(world) {
    this.feed = new RadioFeed(world.bus, 'house');
    this.w = world;
    this.step = 'idle';
    this.t = 0;
    this.deaths = 0;
    this.p = world.level.points;
    this.h = Object.fromEntries(world.humans.map((h) => [h.id, h]));
    this.lost = 0;
    world.bus.on('heroDead', () => this.onHeroDead());
    world.bus.on('spiderDead', (s) => {
      if (s.kind === 'carrier' && s.world === world) this.lost++;
    });
  }

  go(step) {
    this.step = step;
    this.t = 0;
    this.enter?.[step]?.();
  }

  prompt(label) {
    this.w.bus.emit('prompt', label ? { label } : null);
  }

  cam(preset, follow = false) {
    this.w.bus.emit('camera', { preset, follow });
  }

  start() {
    const { w, p } = this;
    w.spawn('hero', p.start.x, p.start.z);
    w.setMark(p.start.x, p.start.z);
    this.cam('crawl', true);
    this.go('crawl');
  }

  action() {
    if (this.step === 'atHand') this.go('bite');
    else if (this.step === 'egg') this.go('hatch');
  }

  enter = {
    crawl: () => {
      const { w, p } = this;
      this.prompt(null);
      w.setBeacon(p.hand);
      w.setObjective('Кликай по полу, чтобы ползти. Цель: рука.');
      this.limitToHand();
    },
    atHand: () => {
      this.w.setBeacon(null);
      const hero = this.w.hero;
      this.w.setMark(hero.x, hero.z);
      this.w.setObjective('Рука совсем рядом.');
      this.prompt('УКУСИТЬ');
      this.cam('hand');
    },
    bite: () => {
      const { w, p, h } = this;
      this.prompt(null);
      w.stats.bites++;
      h.father.jerk = 1;
      w.bus.emit('ripple', { x: p.hand.x, z: p.hand.z, power: 1.4, kind: 'bite' });
      w.heroLocked = true;
      w.setObjective('');
      w.setLamp('bedroom', true);
      w.bus.emit('flash');
      w.say('Рука цела.', { big: true, ms: 2200 });
      h.father.standX = p.hand.x + 0.45;
      h.father.standZ = p.hand.z + 0.5;
      wake(w, h.father, () => {
        h.father.dir = Math.atan2(w.hero ? w.hero.z - h.father.z : 0, w.hero ? w.hero.x - h.father.x : 1);
      });
    },
    flee: () => {
      const { w, p } = this;
      w.heroLocked = false;
      this.limitToBedroom();
      w.setBeacon(p.crack);
      w.setObjective('В щель за шкафом! Быстрее!');
      this.cam('flee', true);
      this.nextStomp = 0.1;
    },
    hidden: () => {
      const { w, h, p } = this;
      w.hero.hidden = true;
      w.markLimit = null;
      w.setBeacon(null);
      w.setObjective('');
      this.cam('room');
      w.bus.emit('radio', { who: 'Папа', text: 'Паук. Здоровый. Убежал за шкаф.' });
      goTo(w, h.father, p.hand.x + 0.45, p.hand.z + 0.5, () => {
        lieDown(h.father);
        w.setLamp('bedroom', false);
      });
    },
    egg: () => {
      this.w.setObjective('В щели тепло и темно. Отложи кокон.');
      this.prompt('ОТЛОЖИТЬ ЯЙЦА');
    },
    hatch: () => {
      const { w } = this;
      this.prompt(null);
      w.setObjective('');
      w.bus.emit('fade', { hold: 1500, text: 'Третья ночь.' });
    },
    gather: () => {
      this.w.setObjective(`Кликай по вкусняшкам: за каждой идёт ближайший рабочий. Нужно ${FOOD_GOAL} еды.`);
    },
    win: () => {
      const { w, p, h } = this;
      w.alarmOn = false;
      w.goalDone = true;
      w.regroup();
      for (const id of ROOM_LAMPS) w.setLamp(id, true);
      w.say('Рой вырос. Дом больше не их.', { big: true, ms: 3000 });
      w.setObjective('');
      const n = w.nests[0];
      for (let i = 0; i < 14; i++) {
        const s = w.spawn('fighter', n.x - 0.4, n.z + 0.5);
        const spot = w.level.shelters[i % w.level.shelters.length];
        s.order = { type: 'move', x: spot.x, z: spot.z, field: spot.field };
      }
      const stand = { father: [p.plate.z + 0.85], mother: [p.plate.z + 0.85] };
      for (const hm of Object.values(h)) {
        hm.aggressive = false;
        hm.standX = hm.id === 'grandpa' ? p.grandpa.x + 0.8 : hm.id === 'lena' ? p.lenaBed.x - 1 : hm.x;
        hm.standZ = stand[hm.id]?.[0] ?? (hm.id === 'grandpa' ? p.grandpa.z + 1.4 : p.lenaBed.z);
        hm.deepSleep = false;
        const run = () => goTo(w, hm, p.exit.x, p.exit.z, () => setState(hm, 'gone'), hm.id === 'grandpa' ? 1.5 : 2.3);
        if (hm.state === 'sleep') wake(w, hm, run);
        else run();
      }
      w.bus.emit('radio', { who: 'Мама', text: 'Они повсюду! Все на улицу! Лена, не отставай!' });
    },
    done: () => {
      const { w } = this;
      w.setObjective('');
      w.bus.emit('levelComplete', { id: 'house' });
    },
  };

  onHeroDead() {
    const { w, p, h } = this;
    if (this.step === 'flee' || this.step === 'bite') {
      this.deaths++;
      w.heroLocked = false;
      w.say(this.deaths > 1 ? 'Ещё раз.' : 'Тапок оказался быстрее.', { ms: 1800 });
      w.bus.emit('fade', { hold: 1200 });
      this.step = 'reset';
      this.t = 0;
      this.resetRun = () => {
        const f = h.father;
        f.x = f.bed.x;
        f.z = f.bed.z;
        f.px = f.x;
        f.pz = f.z;
        f.lie = 1;
        f.swing = 0;
        f.then = null;
        f.dir = 0;
        setState(f, 'sleep');
        w.setLamp('bedroom', false);
        w.spawn('hero', p.hand.x + 0.9, p.hand.z + 0.7);
        w.setMark(p.hand.x + 0.9, p.hand.z + 0.7);
        this.go('crawl');
        this.cam('crawl', true);
      };
    }
  }

  // Жильцы проснулись: свет, тапки, все в укрытия.
  onAlarm() {
    const { w, h, p } = this;
    if (this.step !== 'gather') return;
    w.alarmOn = true;
    w.say('ТРЕВОГА!', { big: true, ms: 1200 });
    w.bus.emit('alarm');
    w.bus.emit('shake', 0.4);
    for (const id of ROOM_LAMPS) w.setLamp(id, true);
    w.scatter();
    const spots = w.level.treatSpots;
    for (const m of [h.father, h.mother]) {
      m.standX = m.bed.x;
      m.standZ = p.plate.z + 0.85;
      m.aggressive = true;
      m.cool = 1.6;
      // Жильцы идут прямо на рабочих, которых не успели снять.
      m.brain = (world, hm) => {
        const prey = world.spiders.filter((s) => s.exposed).sort((a, b) => dist(a.x, a.z, hm.x, hm.z) - dist(b.x, b.z, hm.x, hm.z))[0];
        const s = prey ?? world.rng.pick(spots);
        hm.pause = 0.3;
        goTo(world, hm, s.x, s.z, () => {}, 1.5);
      };
      m.pause = 0.2;
      if (m.state === 'sleep') wake(w, m);
    }
  }

  // Человек ложится только у своей кровати. Если его что-то отвлекло, он идёт снова.
  goToBed(m) {
    const { w } = this;
    goTo(w, m, m.standX, m.standZ, () => {
      if (dist(m.x, m.z, m.standX, m.standZ) < 0.6 || m.field[w.grid.at(m.x, m.z)] === 0) lieDown(m);
      else this.goToBed(m);
    }, 1.5);
  }

  onCalm() {
    const { w, h } = this;
    w.alarmOn = false;
    for (const id of ROOM_LAMPS) w.setLamp(id, false);
    for (const m of [h.father, h.mother]) {
      m.aggressive = false;
      m.brain = null;
      m.pause = undefined;
      this.goToBed(m);
    }
    w.regroup();
    w.say('Тихо. Можно выходить.', { ms: 2000 });
  }

  tick(dt) {
    this.t += dt;
    const { w, p, h } = this;
    const hero = w.hero;
    switch (this.step) {
      case 'crawl':
        if (hero && dist(hero.x, hero.z, p.hand.x, p.hand.z) < 0.4) this.go('atHand');
        break;
      case 'atHand':
        if (hero && dist(hero.x, hero.z, p.hand.x, p.hand.z) > 0.62) {
          this.cam('crawl', true);
          this.go('crawl');
        }
        break;
      case 'bite':
        if (this.t > 1.25) this.go('flee');
        break;
      case 'flee': {
        const f = h.father;
        this.nextStomp -= dt;
        if (hero && this.nextStomp <= 0 && (f.state === 'alert' || f.state === 'walk')) {
          this.nextStomp = this.deaths > 1 ? 2.6 : 2.0;
          const lead = this.deaths > 1 ? 0.25 : 0.42;
          const px = hero.x + Math.cos(hero.dir) * (hero.moving ? lead : 0);
          const pz = hero.z + Math.sin(hero.dir) * (hero.moving ? lead : 0);
          f.x += (px - f.x) * 0.5;
          f.z += (pz - f.z) * 0.5;
          const g = w.grid;
          if (!g.humanOk(g.at(f.x, f.z))) {
            f.x = f.px;
            f.z = f.pz;
          }
          stomp(w, f, px, pz);
        }
        if (hero && dist(hero.x, hero.z, p.crack.x, p.crack.z) < 0.4) this.go('hidden');
        break;
      }
      case 'reset':
        if (this.t > 0.7) this.resetRun();
        break;
      case 'hidden':
        if (h.father.state === 'sleep') this.go('egg');
        break;
      case 'hatch':
        if (this.t > 0.8 && !this.hatched) this.hatchNow();
        if (this.t > 1.6) this.go('gather');
        break;
      case 'gather':
        this.keepSwarm(dt);
        this.feed.update((w.food / FOOD_GOAL) * 0.66);
        if (w.food >= FOOD_GOAL) this.go('win');
        break;
      case 'win':
        if (this.t > 3) this.feed.update(0.67);
        if (this.t > 5.5) this.feed.update(0.84);
        if (this.t > 8 || Object.values(h).every((m) => m.state === 'gone')) this.go('done');
        break;
      default:
        break;
    }
  }

  // Вместо раздавленных вылупляются новые, рост роя покупает игрок.
  keepSwarm(dt) {
    const { w } = this;
    if (this.lost > 0 && !w.alarmOn) {
      this.refill = (this.refill ?? 6) - dt;
      if (this.refill <= 0) {
        this.refill = 6;
        this.lost--;
        this.spawnWorker();
      }
    }
  }

  spawnWorker() {
    const { w } = this;
    const n = w.nests[0];
    const s = w.spawn('carrier', n.x - 0.5, n.z + 0.6);
    w.bus.emit('ripple', { x: s.x, z: s.z, power: 0.5, kind: 'hatch' });
  }

  // Вступление короткое: паук ползёт только по дорожке от старта к руке.
  limitToHand() {
    const { w, p } = this;
    const cx = (p.start.x + p.hand.x) / 2;
    const cz = (p.start.z + p.hand.z) / 2;
    const r = dist(p.start.x, p.start.z, p.hand.x, p.hand.z) / 2 + 0.3;
    w.markLimit = (x, z) => {
      const d = dist(x, z, cx, cz);
      return d <= r ? { x, z } : { x: cx + ((x - cx) * r) / d, z: cz + ((z - cz) * r) / d };
    };
  }

  // Во время побега дверь закрыта для игрока: путь только к щели.
  limitToBedroom() {
    const { w, p } = this;
    const x0 = p.start.x - 3.6;
    const x1 = p.crack.x + 0.1;
    const z0 = p.crack.z - 0.1;
    const z1 = p.start.z + 1.45;
    w.markLimit = (x, z) => ({ x: Math.max(x0, Math.min(x1, x)), z: Math.max(z0, Math.min(z1, z)) });
  }

  hatchNow() {
    const { w, p } = this;
    this.hatched = true;
    if (w.hero) w.hero.hidden = true;
    w.addNest(p.crack.x, p.crack.z + 0.05);
    for (let i = 0; i < w.rules.startWorkers; i++) w.spawn('carrier', p.crack.x - 0.7 + i * 0.22, p.crack.z + 0.55);
    for (let r = 1; r <= 6; r++) w.revealRoom(r);
    for (const c of w.level.shelters) c.field = w.grid.flow(c.x, c.z, 'spider');
    for (let i = 0; i < w.rules.treats; i++) w.addTreat();
    w.flags.resources = true;
    w.bus.emit('flags', w.flags);
    // С этого момента игрок только выбирает, за какой вкусняшкой идти.
    w.rts = true;
    w.mark = null;
    w.markField = null;
    w.markLimit = null;
    this.cam('house');
  }

  // Перенос на нужный шаг для проверок: ?skip=gather
  debugSkip() {
    const { w, p } = this;
    w.spawn('hero', p.crack.x, p.crack.z);
    this.hatchNow();
    this.go('gather');
  }
}
