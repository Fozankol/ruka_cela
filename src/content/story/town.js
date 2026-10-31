import { dist } from '../../core/util.js';
import { dropTorch, giveTorch, goTo, setState } from '../../sim/humans.js';

const LINES = {
  street: [['Лена', 'Мама сказала не шевелиться. Я не шевелилась.'], ['Сосед', 'Опять свет мигает. Третий дом уже стоит тёмный.']],
  village: [['Лена', 'Мне никто не верит. Они слышат шаги, а я слышу, как они затихают.'], ['Староста', 'Завтра всем селом проверим подвалы.']],
  town: [['Лена', 'Говорит Лена. Кто не шевелится, тот живой.'], ['Диспетчер', 'Снова район без света. Бригада не отвечает.']],
};

// Этапы вне дома: тот же сбор вкусняшек, но жильцы выходят на улицу с фонарями.
export class TownScript {
  constructor(world) {
    this.w = world;
    this.step = 'gather';
    this.zoneNext = 1;
    this.lineT = 8;
    this.lineN = 0;
    this.refill = 6;
    this.lost = 0;
    world.bus.on('spiderDead', (s) => {
      if (s.kind === 'carrier' && s.world === world) this.lost++;
    });
  }

  action() {}

  start() {
    const { w } = this;
    const L = w.level;
    const p = L.points.nest;
    w.rts = true;
    w.grid.seen.fill(1);
    w.grid.sense.fill(0.8);
    w.addNest(p.x, p.z);
    for (let i = 0; i < w.rules.startWorkers; i++) w.spawn('carrier', p.x - 0.6 + i * 0.5, p.z + 0.7);
    for (const c of L.shelters) c.field = w.grid.flow(c.x, c.z, 'spider');
    for (let i = 0; i < w.rules.treats; i++) w.addTreat();
    w.bus.emit('zone', { index: 0, world: w });
    for (const h of w.humans) {
      h.lie = 0;
      h.fade = 0;
      setState(h, 'gone');
    }
    w.flags.resources = true;
    w.bus.emit('flags', w.flags);
    w.setObjective(L.cfg.objective);
    this.say();
  }

  say() {
    const lines = LINES[this.w.level.id] ?? [];
    const line = lines[this.lineN++];
    if (line) this.w.bus.emit('radio', { who: line[0], text: line[1] });
  }

  onAlarm() {
    const { w } = this;
    w.alarmOn = true;
    w.say('ТРЕВОГА!', { big: true, ms: 1200 });
    w.bus.emit('alarm');
    w.bus.emit('shake', 0.3);
    w.scatter();
    const doors = w.level.doors;
    for (const h of w.humans) {
      const d = w.rng.pick(doors);
      h.x = d.x;
      h.z = d.z;
      h.px = d.x;
      h.pz = d.z;
      h.home = d;
      h.aggressive = true;
      h.cool = 1;
      h.speed = 1.5 * w.level.speedK * 0.55;
      setState(h, 'alert');
      giveTorch(w, h);
      h.torch.radius = 4.6 * w.level.unitK;
      h.pause = 0.1;
      h.brain = (world, hm) => {
        const prey = world.spiders.filter((s) => s.exposed).sort((a, b) => dist(a.x, a.z, hm.x, hm.z) - dist(b.x, b.z, hm.x, hm.z))[0];
        const s = prey ?? world.rng.pick(world.level.treatSpots);
        hm.pause = 0.3;
        goTo(world, hm, s.x, s.z, () => {}, hm.speed);
      };
    }
  }

  onCalm() {
    const { w } = this;
    w.alarmOn = false;
    for (const h of w.humans) {
      h.aggressive = false;
      h.brain = null;
      goTo(w, h, h.home.x, h.home.z, () => {
        dropTorch(w, h);
        setState(h, 'gone');
      }, h.speed);
    }
    w.regroup();
    w.say('Тихо. Можно выходить.', { ms: 1800 });
  }

  tick(dt) {
    const { w } = this;
    if (this.step === 'done') return;
    const L = w.level;
    // Доля еды гасит дома один за другим: захват виден на карте.
    const want = Math.floor((w.food / w.rules.goal) * L.zones.length);
    while (this.zoneNext < L.zones.length && this.zoneNext <= want) {
      w.bus.emit('zone', { index: this.zoneNext, world: w });
      this.zoneNext++;
      L.population = Math.max(0, L.population - 4);
    }
    this.lineT -= dt;
    if (this.lineT <= 0) {
      this.lineT = 22;
      this.say();
    }
    if (this.lost > 0 && !w.alarmOn) {
      this.refill -= dt;
      if (this.refill <= 0) {
        this.refill = 6;
        this.lost--;
        const n = w.nests[0];
        w.spawn('carrier', n.x, n.z + 0.6);
      }
    }
    if (w.food >= w.rules.goal) {
      this.step = 'done';
      w.alarmOn = false;
      w.say(`${L.title}: тихо.`, { big: true, ms: 2600 });
      w.setObjective('');
      w.bus.emit('levelComplete', { id: L.id });
    }
  }
}
