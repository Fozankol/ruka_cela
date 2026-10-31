import * as THREE from 'three';
import { Globe, latLonToVec3 } from './Globe.js';
import { arrowWants } from './warArrows.js';

const V = new THREE.Vector3();
const N = new THREE.Vector3();
const MOVE = 6;

export function capital(r) {
  return r.cities?.length ? r.cities.reduce((a, b) => (b.population > a.population ? b : a)) : r;
}

// Карта войны на глобусе: территории, линия фронта, стрелки ударов.
export class WarView {
  constructor(stage, war, bus) {
    this.stage = stage;
    this.war = war;
    this.globe = new Globe(stage.scene);
    this.globe.spin = 0;
    this.press = null;
    this.subs = [];
    this.arrows = new Map();
    this.sparkT = 0;
    this.hover = -1;
    this.onRegion = null;
    this.onHover = null;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();

    const tints = war.regions.map((r, i) => {
      const k = 0.82 + ((i * 37) % 10) * 0.05;
      const color = war.factionById[r.faction]?.color ?? [70, 70, 80];
      return color.map((c) => Math.min(255, c * k * 0.62));
    });
    this.globe.initMap(war.regions, tints);

    const home = this.point(war.regions[0]);
    const r = stage.rig;
    r.follow = null;
    r.userPan = false;
    stage.setCamera({ target: { x: 0, y: 0, z: 0 }, dist: 2.75, pitch: Math.asin(home.y / home.length()), yaw: Math.atan2(home.z, home.x), soft: 6 }, true);

    const c = stage.renderer.domElement;
    this.onDown = (e) => {
      this.press = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    };
    this.onMove = (e) => {
      const p = this.press;
      if (p) {
        if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > MOVE) p.moved = true;
        r.goalYaw += (e.clientX - p.x) * 0.0042 * (r.dist / 2.75);
        r.goalPitch = Math.max(-1.35, Math.min(1.35, r.goalPitch + (e.clientY - p.y) * 0.0042 * (r.dist / 2.75)));
        p.x = e.clientX;
        p.y = e.clientY;
        return;
      }
      if (e.target !== c) {
        this.setHover(-1, e);
        return;
      }
      this.setHover(this.pickAt(e.clientX, e.clientY), e);
    };
    this.onUp = (e) => {
      const p = this.press;
      this.press = null;
      if (!p || p.moved) return;
      if (e.button === 2) {
        this.onRight?.();
        return;
      }
      const i = this.pickAt(e.clientX, e.clientY);
      if (i >= 0) this.onRegion?.(this.war.regions[i]);
    };
    this.onWheel = (e) => {
      e.preventDefault();
      r.goalDist = Math.max(1.4, Math.min(3.6, r.goalDist * (1 + Math.sign(e.deltaY) * 0.09)));
    };
    c.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });

    this.subs.push(bus.on('warCapture', (r) => {
      this.repaint();
      for (let i = 0; i < 9; i++) this.globe.spark(r.lat + (Math.random() - 0.5) * 9, r.lon + (Math.random() - 0.5) * 11);
    }));
    this.subs.push(bus.on('warLost', () => this.repaint()));
    this.repaint();
    this.globe.snapLights();
  }

  pickAt(x, y) {
    this.ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.stage.camera);
    return this.globe.pickRegion(this.ray.ray);
  }

  setHover(i, e) {
    if (i === this.hover && i < 0) return;
    this.hover = i;
    this.onHover?.(i >= 0 ? this.war.regions[i] : null, e);
  }

  showAll() {
    return this.stage.rig.dist < 3;
  }

  // Светятся только столицы регионов: каждый огонь на карте что-то значит.
  repaint() {
    const { war, globe } = this;
    for (const r of war.regions) {
      const main = capital(r);
      for (const c of r.cities) globe.setCityLight(c.id, r.owner === 'human' && c === main ? 0.75 : 0);
    }
    globe.repaintMap(war.regions.map((r) => r.owner === 'swarm'));
    globe.setSilk(0);
  }

  point(r, out = new THREE.Vector3()) {
    this.globe.group.updateMatrixWorld(true);
    latLonToVec3(r.lat, r.lon, 1.01, out);
    return this.globe.planet.localToWorld(out);
  }

  // Экранные координаты столицы региона. Обратная сторона планеты скрыта.
  screen(r) {
    const cam = this.stage.camera;
    this.point(capital(r), V);
    N.copy(V).normalize();
    const facing = N.dot(cam.position.clone().sub(V).normalize());
    V.project(cam);
    return { x: (V.x + 1) * 0.5 * innerWidth, y: (1 - V.y) * 0.5 * innerHeight, visible: facing > 0.12 };
  }

  // Красные стрелки: удары роя. Синие: контратаки людей.
  syncArrows() {
    const { war, globe, arrows } = this;
    const want = arrowWants(war, capital);
    for (const [k, a] of arrows) {
      if (want.has(k)) continue;
      globe.removeArrow(a);
      arrows.delete(k);
    }
    for (const [k, [a, b, color]] of want) {
      if (!arrows.has(k)) arrows.set(k, globe.addArrow(a, b, color));
    }
  }

  update(dt, selected) {
    const { war, globe } = this;
    globe.update(dt);
    this.syncArrows();
    globe.setPicked(selected ? war.regions.indexOf(selected) : -1, this.hover);
    this.stage.eyes.scale.setScalar(2.4 + war.tension * 0.05);
    this.sparkT -= dt;
    const fights = war.units.filter((u) => u.attacking);
    if (this.sparkT <= 0 && fights.length) {
      this.sparkT = 0.11;
      const f = fights[Math.floor(Math.random() * fights.length)];
      const a = war.byId[f.region];
      const b = war.byId[f.attacking];
      const k = 0.4 + Math.random() * 0.35;
      globe.spark(a.lat + (b.lat - a.lat) * k + (Math.random() - 0.5) * 5, a.lon + (b.lon - a.lon) * k + (Math.random() - 0.5) * 6);
    }
  }

  dispose() {
    const c = this.stage.renderer.domElement;
    c.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('wheel', this.onWheel);
    for (const off of this.subs) off();
    this.globe.dispose();
  }
}
