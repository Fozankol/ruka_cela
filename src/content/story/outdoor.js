import { dist } from '../../core/util.js';
import { dropTorch, giveTorch, goTo, setState } from '../../sim/humans.js';
import { RadioFeed } from './feed.js';

const LIT = 0.12;
const WIDOW_REST = 7;

// Общая основа этапов вне дома. Механику каждого этапа добавляет наследник.
export class OutdoorScript {
  constructor(world) {
    this.w = world;
    this.step = 'gather';
    this.refill = 6;
    this.lost = [];
    this.subs = [];
    this.paints = false;
    this.alertLabel = 'Тревога';
    this.paintNote = '';
    this.feed = new RadioFeed(world.bus, world.level.id);
    this.on('spiderDead', (s) => {
      if (s.world === world && s.kind !== 'fighter' && s.kind !== 'widow') this.lost.push(s.kind);
    });
  }

  on(name, fn) {
    this.subs.push(this.w.bus.on(name, fn));
  }

  dispose() {
    for (const off of this.subs) off();
  }

  action() {}
  begin() {}
  progress() {
    return 0;
  }

  // Кнопки внизу экрана, цели на карте, круги опасности, подписи и строка цели этапа.
  actions() {
    return [];
  }
  targets() {
    return [];
  }
  circles() {
    return [];
  }
  clouds() {
    return [];
  }
  labels() {
    return [];
  }
  meter() {
    return null;
  }

  start() {
    const { w } = this;
    const L = w.level;
    const p = L.points.nest;
    w.rts = true;
    w.grid.seen.fill(1);
    w.grid.sense.fill(0.8);
    const home = w.addNest(p.x, p.z);
    home.home = true;
    home.fieldV = -1;
    for (let i = 0; i < w.rules.startWorkers; i++) w.spawn('carrier', p.x - 0.6 + i * 0.5, p.z + 0.7);
    for (const c of L.shelters) c.field = w.grid.flow(c.x, c.z, 'spider');
    w.bus.emit('zone', { index: 0, world: w });
    for (const h of w.humans) {
      h.lie = 0;
      h.fade = 0;
      setState(h, 'gone');
    }
    w.flags.resources = true;
    w.bus.emit('flags', w.flags);
    w.setObjective(L.cfg.objective);
    this.begin();
  }

  // Паутина тянется только от своей же нити, а свет сжигает её.
  paintAt(x, z) {
    const { w } = this;
    const g = w.grid;
    const rules = w.rules;
    const r = Math.max(2, Math.round((rules.brush * w.unitK) / g.cell));
    const cx = g.cx(x);
    const cz = g.cz(z);
    const reach = r + 3;
    let touching = false;
    for (let dz = -reach; dz <= reach && !touching; dz++) {
      for (let dx = -reach; dx <= reach; dx++) {
        if (!g.inb(cx + dx, cz + dz) || dx * dx + dz * dz > reach * reach) continue;
        if (g.web[g.idx(cx + dx, cz + dz)] > 0.3) {
          touching = true;
          break;
        }
      }
    }
    if (!touching) {
      this.paintNote = 'Нить тянется только от паутины';
      return false;
    }
    const perCell = (g.cell * g.cell) / (rules.silkArea * w.unitK * w.unitK);
    let added = 0;
    let burned = false;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!g.inb(cx + dx, cz + dz) || dx * dx + dz * dz > r * r) continue;
        const i = g.idx(cx + dx, cz + dz);
        if (!g.spiderOk(i) || g.web[i] > 0) continue;
        if (g.lightW[i] > LIT) {
          burned = true;
          continue;
        }
        if (w.silk < perCell) {
          this.paintNote = 'Шёлк кончился';
          if (added) w.touchWeb();
          return added > 0;
        }
        w.silk -= perCell;
        g.web[i] = 0.85;
        w.webList.push(i);
        added++;
      }
    }
    this.paintNote = burned ? 'Свет сжигает нить. Погаси столб' : '';
    if (burned) this.onLightBlock?.();
    if (added) {
      w.touchWeb();
      this.onPaint?.(added);
    }
    return added > 0;
  }

  updateSilk(dt) {
    const { w } = this;
    w.silk = Math.min(w.rules.silkMax, w.silk + w.rules.silkRate * dt);
  }

  // Вдова кусает того, на кого укажет игрок.
  widowCost() {
    return this.w.rules.widowCost + (this.boughtWidows ?? 0) * this.w.rules.widowStep;
  }

  buyWidow() {
    const { w } = this;
    const cost = this.widowCost();
    if (w.food < cost) return;
    w.food -= cost;
    this.boughtWidows = (this.boughtWidows ?? 0) + 1;
    const n = w.nests[0];
    w.spawn('widow', n.x + 0.8, n.z + 1.2);
    w.bus.emit('notice', 'Вдова готова. Кликни по человеку или собаке');
  }

  freeWidow(p) {
    let best = null;
    let bestD = Infinity;
    for (const s of this.w.spiders) {
      if (s.kind !== 'widow' || s.order || (s.rest ?? 0) > 0) continue;
      const d = dist(s.x, s.z, p.x, p.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  hunt(prey) {
    const { w } = this;
    const s = this.freeWidow(prey);
    if (!s) {
      w.bus.emit('notice', w.count('widow') ? 'Вдова отдыхает' : 'Нужна Вдова');
      return;
    }
    w.sendWidow(s, prey);
    w.stats.clicks++;
    w.bus.emit('order', { x: prey.x, z: prey.z, attack: true });
  }

  // Укус парализует, рой заворачивает человека в кокон.
  onBite(h) {
    this.wrap(h);
  }

  wrap(h) {
    const { w } = this;
    if (h.state === 'para' || h.state === 'cocoon') return;
    h.flee = false;
    h.foe = false;
    h.net = false;
    h.aggressive = false;
    h.brain = null;
    h.then = null;
    dropTorch(w, h);
    h.attached = 8;
    h.wrap = 0;
    setState(h, 'para');
    w.bus.emit('human', { h, event: 'para' });
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
      if (h.crew) continue;
      const d = w.rng.pick(doors);
      this.emerge(h, d);
      h.home = d;
      h.brain = (world, hm) => {
        const prey = world.spiders.filter((s) => s.exposed).sort((a, b) => dist(a.x, a.z, hm.x, hm.z) - dist(b.x, b.z, hm.x, hm.z))[0];
        const s = prey ?? world.rng.pick(world.level.treatSpots);
        hm.pause = 0.3;
        goTo(world, hm, s.x, s.z, () => {}, hm.speed);
      };
    }
  }

  // Человек выходит из двери без света.
  appear(h, d) {
    const { w } = this;
    h.x = d.x;
    h.z = d.z;
    h.px = d.x;
    h.pz = d.z;
    h.speed = 1.5 * w.level.speedK * 0.55;
    h.cool = 1;
    h.pause = 0.1;
    h.stuck = 0;
    setState(h, 'alert');
  }

  // Человек с фонарём выходит из двери.
  emerge(h, d) {
    const { w } = this;
    this.appear(h, d);
    h.aggressive = true;
    giveTorch(w, h);
    h.torch.radius = 4.6 * w.level.unitK;
  }

  sendHome(h) {
    const { w } = this;
    h.aggressive = false;
    h.brain = null;
    goTo(w, h, h.home.x, h.home.z, () => {
      dropTorch(w, h);
      setState(h, 'gone');
    }, h.speed);
  }

  onCalm() {
    const { w } = this;
    w.alarmOn = false;
    for (const h of w.humans) if (!h.crew) this.sendHome(h);
    w.regroup();
    w.say('Тихо. Можно выходить.', { ms: 1800 });
  }

  // Вместо раздавленных вылупляются новые: погибшими этап не блокируется.
  keepSwarm(dt) {
    const { w } = this;
    if (!this.lost.length || w.alarmOn) return;
    this.refill -= dt;
    if (this.refill > 0) return;
    this.refill = 6;
    const n = w.nests[0];
    w.spawn(this.lost.shift(), n.x, n.z + 0.6);
  }

  complete() {
    const { w } = this;
    const L = w.level;
    this.step = 'done';
    w.alarmOn = false;
    w.say(`${L.title}: тихо.`, { big: true, ms: 2600 });
    w.setObjective('');
    w.bus.emit('levelComplete', { id: L.id, note: this.summary?.() });
  }

  tick(dt) {
    if (this.step === 'done') return;
    this.feed.update(this.progress());
    this.keepSwarm(dt);
    if (this.paints) this.updateSilk(dt);
    for (const s of this.w.spiders) if (s.kind === 'widow' && s.rest > 0) s.rest = Math.max(0, s.rest - dt);
    this.update(dt);
  }

  update() {}
}

export { LIT, WIDOW_REST };
