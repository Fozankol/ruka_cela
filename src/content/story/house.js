import { dist } from '../../core/util.js';
import { dropTorch, giveTorch, goTo, lieDown, setState, stomp, wake } from '../../sim/humans.js';

// Сценарий первого масштаба. Каждый шаг включает цель и проверяет своё условие.
export class HouseScript {
  constructor(world) {
    this.w = world;
    this.step = 'idle';
    this.t = 0;
    this.hits = 0;
    this.deaths = 0;
    this.p = world.level.points;
    this.h = Object.fromEntries(world.humans.map((h) => [h.id, h]));
    world.bus.on('heroDead', () => this.onHeroDead());
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
      w.say('Рука цела.', { big: true, ms: 2600 });
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
      const { w, p, h } = this;
      w.hero.hidden = true;
      w.markLimit = null;
      w.setBeacon(null);
      w.setObjective('Не двигайся.');
      this.cam('room');
      goTo(w, h.father, p.crack.x - 1.0, p.crack.z + 1.3, () => {
        h.father.pause = 99;
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
      w.bus.emit('fade', { hold: 2400, text: 'Третья ночь.' });
    },
    select: () => {
      this.w.setObjective('Рой родился. Зажми левую кнопку мыши и обведи паучат рамкой.');
    },
    flies: () => {
      const { w, p } = this;
      for (let i = 0; i < 8; i++) w.addFly(p.plate.x + w.rng.range(-0.3, 0.3), p.plate.z + w.rng.range(-0.3, 0.3));
      w.setBeacon(p.plate);
      w.setObjective('Рою нужны соки. Нажми правой кнопкой по мухам у тарелки: паучки будут носить их в гнездо.');
    },
    breed: () => {
      const { w } = this;
      w.setBeacon(null);
      w.flags.swarmBar = true;
      w.bus.emit('flags', w.flags);
      w.setObjective('Соки пошли. Закажи паучат: клавиша Z или кнопка внизу. Нужно 14. Пусть часть продолжает носить мух.');
      w.bus.emit('radio', { who: 'Рой', text: 'Ткач плетёт паутину там, где стоит. В ней люди вязнут.' });
    },
    wire: () => {
      const { w, p } = this;
      w.wire = { x: p.wire.x, z: p.wire.z, progress: 0, rate: 0.016, done: false, field: w.grid.flow(p.wire.x, p.wire.z, 'spider') };
      this.wireShown = -1;
      w.setBeacon(p.wire);
      w.revealRoom(4);
      w.setObjective('Люди живут светом. Выдели паучат и нажми правой кнопкой по щитку в коридоре.');
    },
    dark: () => {
      const { w, h } = this;
      w.blackout();
      w.bus.emit('flash', { dim: true });
      w.bus.emit('shake', 0.25);
      w.setBeacon(null);
      w.setObjective('');
      w.say('Щелчок. Дом ослеп.', { ms: 3000 });
      for (const id of ['father', 'mother']) {
        h[id].standX = id === 'father' ? this.p.hand.x + 0.4 : h[id].x - 0.2 + 1.6;
        h[id].standZ = this.p.hand.z + 0.7;
      }
      wake(w, h.father, () => {
        giveTorch(w, h.father);
        goTo(w, h.father, this.p.wire.x - 0.5, this.p.wire.z + 0.3, () => {
          h.father.pause = 6;
        });
      });
    },
    grandpa: () => {
      const { w, p, h } = this;
      h.grandpa.huntable = true;
      w.revealRoom(3);
      w.setBeacon(p.grandpa);
      w.setObjective('Старик в дальней комнате не слышит. Выдели группу и нажми правой кнопкой по нему.');
    },
    hunt: () => {
      const { w, h } = this;
      w.setBeacon(null);
      w.flags.evolution = true;
      w.bus.emit('flags', w.flags);
      h.father.huntable = true;
      h.mother.huntable = true;
      h.father.aggressive = true;
      h.mother.aggressive = true;
      w.setObjective('Они знают. Отправь паучков правой кнопкой к кокону за соками. Потом бери людей из темноты: фонарь видит только впереди.');
    },
    still: () => {
      const { w, h } = this;
      setState(h.lena, 'still');
      w.say('Цель потеряна.', { big: true, ms: 3000 });
      w.setObjective('Осталась одна. Нити её не слышат.');
      this.cam('house');
    },
    gone: () => {
      const { w, p, h } = this;
      setState(h.lena, 'gone');
      w.setBeacon(p.lenaWindow);
      w.setObjective('Окно открыто.');
      this.trail = 0;
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

  onCocoon(h) {
    const { w } = this;
    if (h.id === 'grandpa') {
      w.say('Он не проснулся.', { ms: 3200 });
      w.bus.emit('radio', { who: 'Мать', text: 'Папа? Папа, ты спишь?' });
      this.go('hunt');
      const m = this.h.mother;
      if (m.state === 'alert') goTo(w, m, h.x - 0.2, h.z + 1.9, () => {});
    }
    if (h.id === 'father') {
      w.bus.emit('radio', { who: 'Мать', text: 'Лена! Лежи и не шевелись! Слышишь? Не шевелись!' });
      const m = this.h.mother;
      if (m.state !== 'para' && m.state !== 'wrap' && m.state !== 'cocoon') {
        goTo(w, m, this.p.lenaBed.x - 1.2, this.p.lenaBed.z - 1.0, () => {}, 1.9);
      }
    }
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
        if (this.t > 0.7) {
          this.resetRun();
        }
        break;
      case 'hidden':
        if (this.t > 2.4 && !this.said1) {
          this.said1 = true;
          w.bus.emit('radio', { who: 'Мать', text: 'Что там?' });
        }
        if (this.t > 5 && !this.said2) {
          this.said2 = true;
          w.bus.emit('radio', { who: 'Отец', text: 'Паук. Здоровый. Убежал за шкаф.' });
        }
        if (this.t > 8 && !this.said3) {
          this.said3 = true;
          w.bus.emit('radio', { who: 'Мать', text: 'Утром разберёмся. Ложись.' });
          const f = h.father;
          goTo(w, f, p.hand.x + 0.45, p.hand.z + 0.5, () => {
            lieDown(f);
            w.setLamp('bedroom', false);
          });
        }
        if (this.t > 12.5 && h.father.state === 'sleep') this.go('egg');
        break;
      case 'hatch':
        if (this.t > 1.2 && !this.hatched) this.hatchNow();
        if (this.t > 3.6) {
          w.bus.emit('radio', { who: 'Рой', text: 'Восемь. Голодные.' });
          this.go('select');
        }
        break;
      case 'select':
        if (w.selectedCount >= 3) this.go('flies');
        break;
      case 'flies':
        if (w.stats.gathered >= 3) this.go('breed');
        break;
      case 'breed':
        if (w.swarmCount() >= 14) this.go('wire');
        break;
      case 'wire': {
        if (w.wire.done) {
          this.go('dark');
          break;
        }
        const pct = Math.floor(w.wire.progress * 20) * 5;
        if (pct > 0 && pct !== this.wireShown) {
          this.wireShown = pct;
          w.setObjective('Рой грызёт провод: ' + pct + '%');
        }
        break;
      }
      case 'dark':
        if (this.t > 2 && !this.momUp) {
          this.momUp = true;
          wake(w, h.mother, () => {
            giveTorch(w, h.mother);
            goTo(w, h.mother, p.hallMid.x + 1.6, p.hallMid.z, () => {
              h.mother.pause = 4;
            });
          });
          w.bus.emit('radio', { who: 'Лена', text: 'Мама? Ночник погас.' });
        }
        if (this.t > 5) this.go('grandpa');
        break;
      case 'hunt': {
        this.drainBatteries(dt);
        const down = (x) => x.state === 'cocoon';
        if (down(h.father) && down(h.mother)) this.go('still');
        break;
      }
      case 'still':
        if (this.t > 26) this.go('gone');
        break;
      case 'gone':
        this.trail += dt;
        if (this.trail > 0.55 && this.t < 6) {
          this.trail = 0;
          const k = this.t / 6;
          w.bus.emit('ripple', { x: p.lenaWindow.x + k * 2.2, z: p.lenaWindow.z + 0.8 + k * 3.6, power: 1, kind: 'step' });
        }
        if (this.t > 7) this.go('done');
        break;
      default:
        break;
    }
    // Мухи не кончаются, иначе рой мог бы застрять без соков.
    if (this.hatched && w.flies.length < 6) {
      this.flyT = (this.flyT ?? 0) - dt;
      if (this.flyT <= 0) {
        this.flyT = 1.6;
        w.addFly(p.plate.x + w.rng.range(-0.3, 0.3), p.plate.z + w.rng.range(-0.3, 0.3));
      }
    }
    // Отец и мать бродят, пока рой занят стариком.
    if (['grandpa', 'hunt'].includes(this.step)) this.patrol(h.father);
    if (['grandpa', 'hunt'].includes(this.step)) this.patrol(h.mother);
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

  // Свет людей конечен. Без телефонов они слепнут, и рой берёт их числом.
  drainBatteries(dt) {
    const { w, h } = this;
    this.battery = (this.battery ?? 75) - dt;
    for (const m of [h.father, h.mother]) {
      if (!m.torch) continue;
      if (this.battery < 6) m.torch.power = 1.05 * (Math.sin(w.t * 37) > 0.2 ? 1 : 0.15);
      if (this.battery <= 0) dropTorch(w, m);
    }
    if (!this.lowSaid && this.battery < 22) {
      this.lowSaid = true;
      w.bus.emit('radio', { who: 'Отец', text: 'Два процента. Телефон сейчас сядет.' });
      w.setObjective('Их свет кончается. Копи рой в темноте и жди.');
    }
    if (!this.outSaid && this.battery <= 0) {
      this.outSaid = true;
      w.say('Темнота.', { ms: 2600 });
      w.setObjective('Они ослепли. Теперь бери их.');
    }
  }

  hatchNow() {
    const { w, p } = this;
    this.hatched = true;
    if (w.hero) w.hero.hidden = false;
    w.addNest(p.crack.x, p.crack.z + 0.05);
    for (let i = 0; i < 8; i++) w.spawn('ling', p.crack.x - 0.4 + w.rng.range(-0.25, 0.25), p.crack.z + 0.5 + w.rng.range(-0.1, 0.3));
    if (w.hero) {
      w.hero.x = p.crack.x - 0.9;
      w.hero.z = p.crack.z + 0.75;
      w.hero.px = w.hero.x;
      w.hero.pz = w.hero.z;
    }
    w.res.silk = 6;
    w.res.soki = 0;
    w.flags.resources = true;
    w.bus.emit('flags', w.flags);
    // С этого момента у игрока настоящая стратегия: без приказа никто не двигается.
    w.rts = true;
    w.mark = null;
    w.markField = null;
    w.markLimit = null;
    w.food = { x: p.plate.x, z: p.plate.z, field: w.grid.flow(p.plate.x, p.plate.z, 'spider') };
    this.cam('room');
  }

  // Перенос на нужный шаг для проверок: ?skip=wire
  debugSkip(step) {
    const { w, p, h } = this;
    w.spawn('hero', p.crack.x, p.crack.z);
    this.hatchNow();
    w.res.soki = 300;
    w.flags.swarmBar = true;
    w.bus.emit('flags', w.flags);
    if (step === 'flies' || step === 'select') {
      this.go(step);
      return;
    }
    for (let i = 0; i < 8; i++) w.spawn('ling', p.crack.x - 0.8, p.crack.z + 0.9);
    w.revealRoom(4);
    w.revealRoom(3);
    if (step === 'wire') {
      this.go('wire');
      return;
    }
    w.wire = { x: p.wire.x, z: p.wire.z, progress: 1, rate: 0, done: true, field: null };
    if (step === 'dark') {
      this.go('dark');
      return;
    }
    w.blackout();
    for (const m of [h.father, h.mother]) {
      m.standX = p.hand.x + 0.4;
      m.standZ = p.hand.z + 0.7;
      wake(w, m, () => giveTorch(w, m));
    }
    this.momUp = true;
    this.go(step);
  }

  patrol(hm) {
    const { w, p } = this;
    if (hm.state !== 'alert' || hm.t < (hm.pause ?? 2)) return;
    hm.pause = 2 + w.rng.next() * 3;
    const spots = [p.hallMid, p.wire, { x: p.lenaBed.x - 1.5, z: p.lenaBed.z - 1.2 }, { x: p.plate.x + 1.6, z: p.plate.z + 1.2 }, { x: p.grandpa.x + 1, z: p.grandpa.z + 1.6 }];
    const s = w.rng.pick(spots);
    goTo(w, hm, s.x, s.z, () => {}, this.step === 'hunt' ? 0.72 : 0.6);
  }
}

export function dropAllTorches(world) {
  for (const h of world.humans) dropTorch(world, h);
}
