// Мир трогать не нужно: мышь и клавиши только двигают камеру. Клик по полу нужен лишь во вступлении.
export class CameraInput {
  constructor(world, stage) {
    this.world = world;
    this.stage = stage;
    this.keys = new Set();
    this.drag = false;
    this.holding = false;
    this.lx = 0;
    this.ly = 0;

    const c = stage.renderer.domElement;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.lx = e.clientX;
      this.ly = e.clientY;
      if (world.rts) {
        this.drag = true;
        return;
      }
      const hit = stage.pick(e.clientX, e.clientY);
      if (hit) {
        world.setMark(hit.x, hit.z, true);
        this.holding = true;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (this.drag && stage.rig.userPan) {
        const k = stage.rig.dist * 0.0014;
        stage.rig.goal.x -= (e.clientX - this.lx) * k;
        stage.rig.goal.z -= (e.clientY - this.ly) * k;
      }
      if (this.holding && !world.rts) {
        const hit = stage.pick(e.clientX, e.clientY);
        if (hit) world.setMark(hit.x, hit.z);
      }
      this.lx = e.clientX;
      this.ly = e.clientY;
    });
    window.addEventListener('pointerup', () => {
      this.drag = false;
      this.holding = false;
    });
    c.addEventListener(
      'wheel',
      (e) => {
        if (!stage.rig.userPan) return;
        e.preventDefault();
        const r = stage.rig;
        r.goalDist = Math.max(2.8, Math.min(24, r.goalDist * (1 + Math.sign(e.deltaY) * 0.12)));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        world.script?.action();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  update(dt) {
    const r = this.stage.rig;
    if (!r.userPan) return;
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
}
