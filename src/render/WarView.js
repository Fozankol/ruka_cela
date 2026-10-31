import * as THREE from 'three';
import { Globe, latLonToVec3 } from './Globe.js';

const V = new THREE.Vector3();
const N = new THREE.Vector3();

// Глобус войны: вращение мышью, захваченная земля, нити между регионами.
export class WarView {
  constructor(stage, war, bus) {
    this.stage = stage;
    this.war = war;
    this.globe = new Globe(stage.scene);
    this.globe.spin = 0;
    this.drag = null;
    this.subs = [];

    const home = this.point(war.regions[0]);
    const r = stage.rig;
    r.follow = null;
    r.userPan = false;
    stage.setCamera({ target: { x: 0, y: 0, z: 0 }, dist: 2.75, pitch: Math.asin(home.y / home.length()), yaw: Math.atan2(home.z, home.x), soft: 6 }, true);

    const c = stage.renderer.domElement;
    this.onDown = (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
    };
    this.onMove = (e) => {
      if (!this.drag) return;
      r.goalYaw += (e.clientX - this.drag.x) * 0.0042 * (r.dist / 2.75);
      r.goalPitch = Math.max(-1.35, Math.min(1.35, r.goalPitch + (e.clientY - this.drag.y) * 0.0042 * (r.dist / 2.75)));
      this.drag = { x: e.clientX, y: e.clientY };
    };
    this.onUp = () => {
      this.drag = null;
    };
    this.onWheel = (e) => {
      e.preventDefault();
      r.goalDist = Math.max(1.45, Math.min(4.2, r.goalDist * (1 + Math.sign(e.deltaY) * 0.09)));
    };
    c.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    c.addEventListener('wheel', this.onWheel, { passive: false });

    this.subs.push(bus.on('warCapture', (reg) => this.onCapture(reg)));
    this.subs.push(bus.on('warLost', () => this.repaint()));
    this.subs.push(bus.on('front', ({ from, to }) => this.thread(from, to)));
    this.subs.push(bus.on('warNuke', () => stage.bump?.()));
    this.repaint();
  }

  capital(r) {
    return r.cities[0]?.id ?? null;
  }

  thread(from, to) {
    const a = this.capital(this.war.byId[from]);
    const b = this.capital(this.war.byId[to]);
    if (a && b) this.globe.addThread(a, b);
  }

  onCapture(r) {
    for (const c of r.cities) this.globe.setCityLight(c.id, 0.04);
    this.repaint();
  }

  // Захваченные регионы покрываются шёлком прямо на поверхности планеты.
  repaint() {
    const owned = this.war.regions.filter((r) => r.owner === 'swarm');
    for (const r of this.war.regions) {
      if (r.owner === 'human') for (const c of r.cities) this.globe.setCityLight(c.id, 1);
      else for (const c of r.cities) this.globe.setCityLight(c.id, 0.04);
    }
    this.globe.paintTerritory(owned);
    this.globe.setSilk(0);
  }

  point(r, out = new THREE.Vector3()) {
    this.globe.group.updateMatrixWorld(true);
    latLonToVec3(r.lat, r.lon, 1.01, out);
    return this.globe.planet.localToWorld(out);
  }

  // Экранные координаты региона. Обратная сторона планеты скрыта.
  screen(r) {
    const cam = this.stage.camera;
    this.point(r, V);
    N.copy(V).normalize();
    const facing = N.dot(cam.position.clone().sub(V).normalize());
    V.project(cam);
    return { x: (V.x + 1) * 0.5 * innerWidth, y: (1 - V.y) * 0.5 * innerHeight, visible: facing > 0.12 };
  }

  update(dt) {
    this.globe.update(dt);
    const eyes = this.stage.eyes;
    const k = 2.4 + this.war.tension * 0.05;
    eyes.scale.setScalar(k);
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
