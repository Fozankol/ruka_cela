import * as THREE from 'three';
import { dist } from '../core/util.js';
import { SPIDERS } from '../sim/world.js';

const DRAG = 7;
const V = new THREE.Vector3();

// Управление как в племенном этапе Spore: одна кнопка, а подсказка заранее говорит, что случится.
export class Rts {
  constructor(world, stage, hud) {
    this.world = world;
    this.stage = stage;
    this.hud = hud;
    this.sel = new Set();
    this.drag = null;
    this.keys = new Set();
    this.panning = false;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.lastClick = { t: 0, kind: null };
    this.hover = null;

    const c = stage.renderer.domElement;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    world.bus.on('spiderDead', (s) => {
      this.sel.delete(s);
      this.changed();
    });
    world.bus.on('hatched', () => this.selectKind(['fighter', 'hero']));
  }

  changed() {
    this.world.selectedCount = this.sel.size;
    this.hud.setSelection(this.sel);
  }

  select(list, add) {
    if (!add) this.sel.clear();
    for (const s of list) this.sel.add(s);
    this.changed();
  }

  selectKind(kinds) {
    const list = this.world.spiders.filter((s) => kinds.includes(s.kind) && !s.hidden);
    this.select(list, false);
  }

  screen(x, y, z) {
    V.set(x, y, z).project(this.stage.camera);
    return { x: (V.x + 1) * 0.5 * innerWidth, y: (1 - V.y) * 0.5 * innerHeight };
  }

  unitAt(x, y) {
    let best = null;
    let bestD = 30;
    for (const s of this.world.spiders) {
      if (s.hidden) continue;
      const p = this.screen(s.x, s.y + 0.05, s.z);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  humanAt(x, y, ground) {
    for (const h of this.world.humans) {
      if (h.fade < 0.5 || ['cocoon', 'gone', 'still'].includes(h.state)) continue;
      const lying = h.lie > 0.5;
      const bz = lying ? h.z - h.height * 0.5 : h.z;
      const p = this.screen(h.x, lying ? 0.6 : h.height * 0.55, bz);
      if (Math.hypot(p.x - x, p.y - y) < (lying ? 66 : 46)) return h;
      if (ground && dist(ground.x, ground.z, h.x, bz) < (lying ? 0.9 : 0.5)) return h;
    }
    return null;
  }

  // Что произойдёт, если нажать сюда. Одна функция и для подсказки, и для приказа.
  intent(x, y) {
    const w = this.world;
    const ground = this.stage.pick(x, y);
    const unit = this.unitAt(x, y);
    if (unit) return { type: 'unit', s: unit, label: SPIDERS[unit.kind].name, pos: unit };
    if (!ground) return { type: 'none' };
    const list = [...this.sel];
    const fighters = list.filter((s) => SPIDERS[s.kind].bite > 0);
    const carriers = list.filter((s) => s.kind === 'carrier');
    const h = this.humanAt(x, y, ground);
    if (h && w.canBite(h) && fighters.length) return { type: 'attack', h, label: `Укусить: ${h.name}`, pos: h, danger: true };
    if (w.wire && !w.wire.done && dist(ground.x, ground.z, w.wire.x, w.wire.z) < 0.85) {
      return fighters.length ? { type: 'gnaw', label: 'Грызть провод', pos: w.wire, danger: true } : { type: 'need', label: 'Провод грызут только бойцы' };
    }
    for (const c of w.cocoons) {
      if (c.left > 0 && dist(ground.x, ground.z, c.x, c.z) < 0.75) {
        return carriers.length ? { type: 'cocoon', c, label: 'Нести соки', pos: c } : { type: 'need', label: 'Кокон разбирают носильщики' };
      }
    }
    if (w.food && dist(ground.x, ground.z, w.food.x, w.food.z) < 0.9) {
      return carriers.length ? { type: 'flies', label: 'Ловить мух', pos: w.food } : { type: 'info', label: 'Мухи. Их носят носильщики' };
    }
    if (h) return { type: 'need', label: h.huntable ? 'Людей кусают только бойцы' : 'Рано. Он проснётся и раздавит рой' };
    if (!list.length) return { type: 'none' };
    return { type: 'move', x: ground.x, z: ground.z, label: 'Идти сюда' };
  }

  order(x, y) {
    const w = this.world;
    const it = this.intent(x, y);
    const list = [...this.sel];
    if (!list.length) {
      if (it.type !== 'unit') this.hud.notice('Сначала выбери пауков');
      return;
    }
    switch (it.type) {
      case 'attack':
        w.command(list, { type: 'attack', h: it.h });
        w.bus.emit('order', { x: it.h.x, z: it.h.z, attack: true });
        break;
      case 'gnaw':
        w.command(list, { type: 'gnaw' });
        w.bus.emit('order', { x: w.wire.x, z: w.wire.z, attack: true });
        break;
      case 'cocoon':
        w.command(list, { type: 'gather', src: 'cocoon', c: it.c });
        w.bus.emit('order', { x: it.c.x, z: it.c.z });
        break;
      case 'flies':
        w.command(list, { type: 'gather', src: 'flies' });
        w.bus.emit('order', { x: w.food.x, z: w.food.z });
        break;
      case 'move':
        w.command(list, { type: 'move', x: it.x, z: it.z });
        w.bus.emit('order', { x: it.x, z: it.z });
        break;
      case 'need':
        this.hud.notice(it.label);
        break;
      default:
        break;
    }
  }

  down(e) {
    const w = this.world;
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (e.button === 1) {
      this.panning = true;
      return;
    }
    if (!w.rts) {
      const hit = this.stage.pick(e.clientX, e.clientY);
      if (hit) {
        w.setMark(hit.x, hit.z, true);
        this.holding = true;
      }
      return;
    }
    if (e.button === 2) {
      this.order(e.clientX, e.clientY);
      return;
    }
    this.drag = { x: e.clientX, y: e.clientY, active: false, add: e.shiftKey };
  }

  move(e) {
    const { x: lx, y: ly } = this.mouse;
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (this.panning && this.stage.rig.userPan) {
      const k = this.stage.rig.dist * 0.0014;
      this.stage.rig.goal.x -= (e.clientX - lx) * k;
      this.stage.rig.goal.z -= (e.clientY - ly) * k;
    }
    if (this.holding && !this.world.rts) {
      const hit = this.stage.pick(e.clientX, e.clientY);
      if (hit) this.world.setMark(hit.x, hit.z);
    }
    const d = this.drag;
    if (d) {
      if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > DRAG) d.active = true;
      if (d.active) this.hud.setBox(d.x, d.y, e.clientX, e.clientY);
    }
  }

  up(e) {
    this.panning = false;
    this.holding = false;
    const d = this.drag;
    if (!d || e.button !== 0) return;
    this.drag = null;
    this.hud.setBox(null);
    if (d.active) {
      const x0 = Math.min(d.x, e.clientX);
      const x1 = Math.max(d.x, e.clientX);
      const y0 = Math.min(d.y, e.clientY);
      const y1 = Math.max(d.y, e.clientY);
      const list = [];
      for (const s of this.world.spiders) {
        if (s.hidden) continue;
        const p = this.screen(s.x, s.y, s.z);
        if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) list.push(s);
      }
      if (list.length) this.select(list, d.add);
      return;
    }
    // Простой клик: по своему выбирает, по всему остальному отдаёт приказ.
    const s = this.unitAt(e.clientX, e.clientY);
    if (s) {
      const now = performance.now();
      if (now - this.lastClick.t < 320 && this.lastClick.kind === s.kind) this.selectKind([s.kind]);
      else this.select([s], d.add);
      this.lastClick = { t: now, kind: s.kind };
      return;
    }
    this.order(e.clientX, e.clientY);
  }

  wheel(e) {
    if (!this.stage.rig.userPan) return;
    e.preventDefault();
    const r = this.stage.rig;
    r.goalDist = Math.max(2.8, Math.min(24, r.goalDist * (1 + Math.sign(e.deltaY) * 0.12)));
  }

  action(name) {
    const w = this.world;
    if (name === 'fighters') this.selectKind(['fighter', 'hero']);
    else if (name === 'carriers') this.selectKind(['carrier']);
    else if (name === 'home') {
      const n = w.nests[0];
      if (n) w.command([...this.sel], { type: 'move', x: n.x - 0.3, z: n.z + 0.4 });
      if (n && this.sel.size) w.bus.emit('order', { x: n.x - 0.3, z: n.z + 0.4 });
    } else if (name in SPIDERS) {
      const err = w.train(name);
      if (err) this.hud.notice(err);
    }
  }

  key(e) {
    const w = this.world;
    this.keys.add(e.code);
    if (e.code === 'Space') {
      e.preventDefault();
      w.script?.action();
      return;
    }
    if (!w.rts) return;
    const map = { Digit1: 'fighters', Digit2: 'carriers', KeyH: 'home', KeyZ: 'fighter', KeyX: 'carrier' };
    if (map[e.code]) this.action(map[e.code]);
    if (e.ctrlKey && e.code === 'KeyA') {
      e.preventDefault();
      this.select(w.spiders.filter((s) => !s.hidden), false);
    }
    if (e.code === 'Escape') this.select([], false);
  }

  // Камера и подсказка у курсора.
  update(dt) {
    const r = this.stage.rig;
    if (r.userPan) {
      const v = r.dist * 0.85 * dt;
      const k = this.keys;
      const edge = 6;
      const { x, y } = this.mouse;
      const inside = x > 0 && y > 0 && x < innerWidth - 1 && y < innerHeight - 1;
      if (k.has('KeyW') || k.has('ArrowUp') || (inside && y < edge)) r.goal.z -= v;
      if (k.has('KeyS') || k.has('ArrowDown') || (inside && y > innerHeight - edge)) r.goal.z += v;
      if (k.has('KeyA') || k.has('ArrowLeft') || (inside && x < edge)) r.goal.x -= v;
      if (k.has('KeyD') || k.has('ArrowRight') || (inside && x > innerWidth - edge)) r.goal.x += v;
      const L = this.world.level;
      r.goal.x = Math.max(0, Math.min(L.worldW, r.goal.x));
      r.goal.z = Math.max(0, Math.min(L.worldD, r.goal.z));
    }
    if (!this.world.rts) {
      this.hud.setTip(null);
      return;
    }
    const overUi = document.elementFromPoint(this.mouse.x, this.mouse.y) !== this.stage.renderer.domElement;
    const it = overUi || this.drag?.active ? { type: 'none' } : this.intent(this.mouse.x, this.mouse.y);
    this.hover = it;
    this.hud.setTip(it.label ? it : null, this.mouse.x, this.mouse.y);
  }
}
