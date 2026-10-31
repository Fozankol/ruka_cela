import * as THREE from 'three';
import { dist } from '../core/util.js';
import { NEST_COST, SPIDERS } from '../sim/world.js';

const DRAG = 6;
const V = new THREE.Vector3();

// Управление как в классических стратегиях: левая кнопка выделяет, правая отдаёт приказ.
export class Rts {
  constructor(world, stage, hud) {
    this.world = world;
    this.stage = stage;
    this.hud = hud;
    this.sel = new Set();
    this.groups = {};
    this.mode = null;
    this.drag = null;
    this.keys = new Set();
    this.panning = false;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2 };
    this.lastClick = { t: 0, kind: null };

    const c = stage.renderer.domElement;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.key(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    world.bus.on('spiderDead', (s) => this.forget(s));
  }

  forget(s) {
    this.sel.delete(s);
    for (const g of Object.values(this.groups)) g.delete?.(s);
    this.changed();
  }

  changed() {
    this.world.selectedCount = this.sel.size;
    this.hud.setSelection(this.selected(), this.mode);
  }

  selected() {
    return [...this.sel].filter((s) => this.world.spiders.includes(s));
  }

  screen(x, y, z) {
    V.set(x, y, z).project(this.stage.camera);
    return { x: (V.x + 1) * 0.5 * innerWidth, y: (1 - V.y) * 0.5 * innerHeight, front: V.z < 1 };
  }

  select(list, add) {
    if (!add) this.sel.clear();
    for (const s of list) this.sel.add(s);
    this.mode = null;
    this.changed();
  }

  unitAt(x, y) {
    let best = null;
    let bestD = 22;
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
      const bx = h.x;
      const bz = lying ? h.z - h.height * 0.5 : h.z;
      const p = this.screen(bx, lying ? 0.6 : h.height * 0.55, bz);
      if (Math.hypot(p.x - x, p.y - y) < (lying ? 70 : 44)) return h;
      if (ground && dist(ground.x, ground.z, bx, bz) < (lying ? 0.9 : 0.5)) return h;
    }
    return null;
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
      if (hit && (e.button === 0 || e.button === 2)) {
        w.setMark(hit.x, hit.z, true);
        this.holding = true;
      }
      return;
    }
    if (e.button === 2) {
      if (this.mode) {
        this.mode = null;
        this.changed();
      } else {
        this.order(e.clientX, e.clientY);
      }
      return;
    }
    if (this.mode) {
      const hit = this.stage.pick(e.clientX, e.clientY);
      if (hit) this.applyMode(hit);
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
      this.select(list, d.add);
      return;
    }
    const s = this.unitAt(e.clientX, e.clientY);
    if (!s) {
      if (!d.add) this.select([], false);
      return;
    }
    const now = performance.now();
    if (now - this.lastClick.t < 320 && this.lastClick.kind === s.kind) {
      this.select(this.world.spiders.filter((o) => o.kind === s.kind && !o.hidden), d.add);
    } else {
      this.select([s], d.add);
    }
    this.lastClick = { t: now, kind: s.kind };
  }

  wheel(e) {
    if (!this.stage.rig.userPan) return;
    e.preventDefault();
    const r = this.stage.rig;
    r.goalDist = Math.max(2.5, Math.min(26, r.goalDist * (1 + Math.sign(e.deltaY) * 0.12)));
  }

  // Правая кнопка: игра сама понимает приказ по тому, что под курсором.
  order(x, y) {
    const w = this.world;
    const list = this.selected();
    if (!list.length) {
      this.hud.notice('Сначала выдели пауков рамкой');
      return;
    }
    const ground = this.stage.pick(x, y);
    const h = this.humanAt(x, y, ground);
    if (h && w.canBite(h)) {
      w.command(list, { type: 'attack', h });
      w.bus.emit('order', { x: h.x, z: h.z, attack: true });
      return;
    }
    if (!ground) return;
    if (w.wire && !w.wire.done && dist(ground.x, ground.z, w.wire.x, w.wire.z) < 0.8) {
      w.command(list, { type: 'gnaw' });
      w.bus.emit('order', { x: w.wire.x, z: w.wire.z, attack: true });
      return;
    }
    for (const c of w.cocoons) {
      if (c.left > 0 && dist(ground.x, ground.z, c.x, c.z) < 0.7) {
        w.command(list, { type: 'gather', src: 'cocoon', c });
        w.bus.emit('order', { x: c.x, z: c.z });
        return;
      }
    }
    if (w.food && dist(ground.x, ground.z, w.food.x, w.food.z) < 0.95) {
      w.command(list, { type: 'gather', src: 'flies' });
      w.bus.emit('order', { x: w.food.x, z: w.food.z });
      return;
    }
    if (h) {
      this.hud.notice('Рано. Он проснётся и раздавит рой');
      return;
    }
    w.command(list, { type: 'move', x: ground.x, z: ground.z });
    w.bus.emit('order', { x: ground.x, z: ground.z });
  }

  applyMode(hit) {
    const w = this.world;
    const list = this.selected();
    if (this.mode === 'amove') {
      w.command(list, { type: 'amove', x: hit.x, z: hit.z });
      w.bus.emit('order', { x: hit.x, z: hit.z, attack: true });
    } else if (this.mode === 'nest' && w.hero) {
      if (w.res.silk < NEST_COST) this.hud.notice('Нужно ' + NEST_COST + ' шёлка');
      else {
        w.command([w.hero], { type: 'nest', x: hit.x, z: hit.z });
        w.bus.emit('order', { x: hit.x, z: hit.z });
      }
    }
    this.mode = null;
    this.changed();
  }

  action(name) {
    const w = this.world;
    const list = this.selected();
    if (name === 'amove' && list.length) this.mode = 'amove';
    else if (name === 'stop') w.command(list, { type: 'stop' });
    else if (name === 'hide') w.command(list, { type: 'hide' });
    else if (name === 'nest' && list.includes(w.hero)) this.mode = 'nest';
    else if (name in SPIDERS) {
      const err = w.train(name);
      if (err) this.hud.notice(err);
    }
    this.changed();
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
    const digit = e.code.startsWith('Digit') ? e.code.slice(5) : null;
    if (digit && digit >= '1' && digit <= '5') {
      e.preventDefault();
      if (e.ctrlKey) {
        this.groups[digit] = new Set(this.sel);
        this.hud.notice('Группа ' + digit + ' запомнена');
      } else if (this.groups[digit]) {
        this.select([...this.groups[digit]], false);
      }
      return;
    }
    if (e.ctrlKey && e.code === 'KeyA') {
      e.preventDefault();
      this.select(w.spiders.filter((s) => !s.hidden), false);
      return;
    }
    const map = { KeyQ: 'amove', KeyE: 'stop', KeyR: 'hide', KeyB: 'nest', KeyZ: 'ling', KeyX: 'weaver' };
    if (map[e.code]) this.action(map[e.code]);
    if (e.code === 'Escape') {
      this.mode = null;
      this.select([], false);
    }
  }

  // Камера: WASD, стрелки и край экрана.
  update(dt) {
    const r = this.stage.rig;
    if (!r.userPan) return;
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
}
