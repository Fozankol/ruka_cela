import * as THREE from 'three';

const DRAG = 7;
const V = new THREE.Vector3();

// Мышь: клик по вкусняшке посылает рабочего, перетаскивание двигает камеру.
export class CameraInput {
  constructor(world, stage, hud) {
    this.world = world;
    this.stage = stage;
    this.hud = hud;
    this.keys = new Set();
    this.press = null;
    this.holding = false;
    this.mx = 0;
    this.my = 0;

    const c = stage.renderer.domElement;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.mx = e.clientX;
      this.my = e.clientY;
      if (this.world.rts) {
        this.press = { x: e.clientX, y: e.clientY, moved: false };
        return;
      }
      const hit = stage.pick(e.clientX, e.clientY);
      if (hit) {
        this.world.setMark(hit.x, hit.z, true);
        this.holding = true;
      }
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.press;
      if (p) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > DRAG) p.moved = true;
        if (p.moved && stage.rig.userPan) {
          const k = stage.rig.dist * 0.0014;
          stage.rig.goal.x -= (e.clientX - this.mx) * k;
          stage.rig.goal.z -= (e.clientY - this.my) * k;
        }
      }
      if (this.holding && !this.world.rts) {
        const hit = stage.pick(e.clientX, e.clientY);
        if (hit) this.world.setMark(hit.x, hit.z);
      }
      this.mx = e.clientX;
      this.my = e.clientY;
    });
    window.addEventListener('pointerup', () => {
      const p = this.press;
      this.press = null;
      this.holding = false;
      if (p && !p.moved) this.click(this.mx, this.my);
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (!stage.rig.userPan) return;
        e.preventDefault();
        const r = stage.rig;
        const far = this.world.level.cfg?.camera.dist * 1.2 || 24;
        r.goalDist = Math.max(far * 0.17, Math.min(far, r.goalDist * (1 + Math.sign(e.deltaY) * 0.12)));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        this.world.script?.action();
      }
      if (e.code === 'KeyZ' && this.world.rts) this.hud.handlers.buy?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  treatAt(x, y) {
    let best = null;
    let bestD = 34;
    for (const t of this.world.treats) {
      V.set(t.x, 0.08, t.z).project(this.stage.camera);
      const d = Math.hypot((V.x + 1) * 0.5 * innerWidth - x, (1 - V.y) * 0.5 * innerHeight - y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  // Красная метка под курсором, по ней игрок снимает рабочего во время тревоги.
  markAt(x, y) {
    let best = null;
    let bestD = 46;
    for (const m of this.world.exposedMarks()) {
      V.set(m.x, 0.08, m.z).project(this.stage.camera);
      const d = Math.hypot((V.x + 1) * 0.5 * innerWidth - x, (1 - V.y) * 0.5 * innerHeight - y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  click(x, y) {
    const w = this.world;
    if (!w.rts) return;
    if (w.alarmOn) {
      const m = this.markAt(x, y);
      if (m) w.recall(m.s);
      return;
    }
    const t = this.treatAt(x, y);
    if (!t) return;
    if (w.dispatch(t)) {
      w.stats.clicks++;
      w.bus.emit('order', { x: t.x, z: t.z });
    }
  }

  update(dt) {
    if (this.stage.warMode) {
      this.hud.setTip(null);
      return;
    }
    const r = this.stage.rig;
    if (r.userPan) {
      const v = r.dist * 0.85 * dt;
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) r.goal.z -= v;
      if (k.has('KeyS') || k.has('ArrowDown')) r.goal.z += v;
      if (k.has('KeyA') || k.has('ArrowLeft')) r.goal.x -= v;
      if (k.has('KeyD') || k.has('ArrowRight')) r.goal.x += v;
      const L = this.world.level;
      r.goal.x = Math.max(0, Math.min(L.worldW, r.goal.x));
      r.goal.z = Math.max(0, Math.min(L.worldD, r.goal.z));
    }
    const over = document.elementFromPoint(this.mx, this.my) === this.stage.renderer.domElement;
    const alarm = this.world.alarmOn;
    const m = this.world.rts && over && alarm ? this.markAt(this.mx, this.my) : null;
    const t = this.world.rts && over && !alarm ? this.treatAt(this.mx, this.my) : null;
    document.body.classList.toggle('aiming', !!(t || m));
    this.hud.setTip(m ? { label: 'Снять рабочего' } : t && { label: `${t.name} +${t.value}` }, this.mx, this.my);
  }
}
