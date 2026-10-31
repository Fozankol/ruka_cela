import * as THREE from 'three';
import { arrowMeshes } from './Globe.js';
import { arrowWants } from './warArrows.js';

const W = 1024;
const MOVE = 6;
const V = new THREE.Vector3();

const OVERLAY_FS = /* glsl */ `
uniform sampler2D uMap; uniform sampler2D uIds; uniform float uSel; uniform float uHover; uniform float uTime;
varying vec2 vUv;
void main(){
  vec4 m = texture2D(uMap, vUv);
  float id = texture2D(uIds, vUv).r * 255.0;
  vec3 c = vec3(0.0);
  float a = 0.0;
  // Захваченные районы затянуты паутиной.
  float web = sin((vUv.x + vUv.y) * 90.0) * sin((vUv.x - vUv.y) * 90.0);
  a = max(a, m.r * (0.14 + 0.1 * smoothstep(0.86, 1.0, abs(web))));
  c = mix(c, vec3(0.86, 0.9, 0.96), m.r);
  float picked = max(step(abs(id - uSel), 0.5) * 0.1, step(abs(id - uHover), 0.5) * 0.06);
  c = mix(c, vec3(1.0, 0.92, 0.7), step(0.01, picked));
  a = max(a, picked);
  c = mix(c, vec3(0.75, 0.8, 0.9), m.g);
  a = max(a, min(m.g * 2.0, 1.0) * 0.4);
  float beat = 0.7 + 0.3 * sin(uTime * 4.0 + vUv.y * 40.0 + vUv.x * 30.0);
  c = mix(c, vec3(3.0, 0.4, 0.2) * beat, min(m.b * 1.7, 1.0));
  a = max(a, min(m.b * 1.7, 1.0));
  gl_FragColor = vec4(c, a);
}`;

// Карта районов поверх диорамы. Отдаёт те же методы, что и глобус.
export class CityView {
  constructor(stage, war, level, bus) {
    this.stage = stage;
    this.war = war;
    this.level = level;
    this.subs = [];
    this.arrows = new Map();
    this.hover = -1;
    this.onRegion = null;
    this.onHover = null;
    this.press = null;
    this.time = 0;
    this.h = Math.round((W * level.worldD) / level.worldW);
    this.makeTextures();
    const geo = new THREE.PlaneGeometry(level.worldW, level.worldD);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: { uMap: { value: this.mapTex }, uIds: { value: this.idTex }, uSel: { value: -1 }, uHover: { value: -1 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = vec2(uv.x, 1.0 - uv.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: OVERLAY_FS,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(level.worldW / 2, 0.2, level.worldD / 2);
    this.mesh.renderOrder = 7;
    stage.scene.add(this.mesh);

    const c = stage.renderer.domElement;
    this.onDown = (e) => {
      this.press = { x: e.clientX, y: e.clientY, moved: false };
    };
    this.onMove = (e) => {
      if (this.press) {
        if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > MOVE) this.press.moved = true;
        return;
      }
      this.setHover(e.target === c ? this.pickAt(e.clientX, e.clientY) : -1, e);
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
    c.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    this.subs.push(bus.on('warCapture', () => this.repaint()));
    this.subs.push(bus.on('warLost', () => this.repaint()));
    this.repaint();
  }

  makeTextures() {
    const { h, war, level } = this;
    const tex = (data, nearest) => {
      const t = new THREE.DataTexture(data, W, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      t.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      t.needsUpdate = true;
      return t;
    };
    this.ids = new Uint8Array(W * h);
    this.data = new Uint8Array(W * h * 4);
    const idData = new Uint8Array(W * h * 4);
    for (let y = 0; y < h; y++) {
      const z = ((y + 0.5) / h) * level.worldD;
      for (let x = 0; x < W; x++) {
        const px = ((x + 0.5) / W) * level.worldW;
        let best = 0;
        let bestD = Infinity;
        war.regions.forEach((r, i) => {
          const d = (r.x - px) ** 2 + (r.z - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        this.ids[y * W + x] = best;
        idData[(y * W + x) * 4] = best;
        idData[(y * W + x) * 4 + 3] = 255;
      }
    }
    this.mapTex = tex(this.data);
    this.idTex = tex(idData, true);
  }

  // Захват гасит окна района и затягивает его паутиной.
  zonesOf(r) {
    const { level } = this;
    const i = this.war.regions.indexOf(r);
    const out = [];
    level.zones.forEach((z, k) => {
      const x = Math.min(W - 1, Math.floor((z.x / level.worldW) * W));
      const y = Math.min(this.h - 1, Math.floor((z.z / level.worldD) * this.h));
      if (this.ids[y * W + x] === i) out.push(k);
    });
    return out;
  }

  repaint() {
    const { ids, data: d, h, war } = this;
    d.fill(0);
    const owned = war.regions.map((r) => r.owner === 'swarm');
    const front = [];
    for (let y = 0; y < h; y++) {
      const y2 = Math.min(h - 1, y + 1);
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const a = ids[i];
        const right = ids[y * W + Math.min(W - 1, x + 1)];
        const down = ids[y2 * W + x];
        d[i * 4] = owned[a] ? 255 : 0;
        d[i * 4 + 3] = 255;
        if (a !== right || a !== down) d[i * 4 + 1] = 255;
        if (owned[a] !== owned[right] || owned[a] !== owned[down]) front.push(x, y);
      }
    }
    for (let k = 0; k < front.length; k += 2) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = front[k + 1] + dy;
          const x = front[k] + dx;
          if (y >= 0 && y < h && x >= 0 && x < W) d[(y * W + x) * 4 + 2] = 255;
        }
      }
    }
    this.mapTex.needsUpdate = true;
  }

  pickAt(x, y) {
    const hit = this.stage.pick(x, y);
    if (!hit) return -1;
    const { level } = this;
    const px = Math.floor((hit.x / level.worldW) * W);
    const py = Math.floor((hit.z / level.worldD) * this.h);
    if (px < 0 || py < 0 || px >= W || py >= this.h) return -1;
    return this.ids[py * W + px];
  }

  setHover(i, e) {
    if (i === this.hover && i < 0) return;
    this.hover = i;
    this.onHover?.(i >= 0 ? this.war.regions[i] : null, e);
  }

  showAll() {
    return true;
  }

  screen(r) {
    V.set(r.x, 6, r.z).project(this.stage.camera);
    return { x: (V.x + 1) * 0.5 * innerWidth, y: (1 - V.y) * 0.5 * innerHeight, visible: V.z < 1 };
  }

  arrow(a, b, color) {
    const A = new THREE.Vector3(a.x, 7, a.z);
    const B = new THREE.Vector3(b.x, 7, b.z);
    const mid = A.clone().lerp(B, 0.5);
    mid.y = 7 + A.distanceTo(B) * 0.22;
    const pts = [A, mid, B];
    const arrow = arrowMeshes(pts, color, 0.55, 1.9);
    for (const m of [arrow.mesh, arrow.head]) {
      m.material.depthTest = false;
      m.renderOrder = 8;
      this.stage.scene.add(m);
    }
    return arrow;
  }

  removeArrow(a) {
    for (const m of [a.mesh, a.head]) {
      this.stage.scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }

  syncArrows() {
    const { war, arrows } = this;
    const want = arrowWants(war);
    for (const [k, a] of arrows) {
      if (want.has(k)) continue;
      this.removeArrow(a);
      arrows.delete(k);
    }
    for (const [k, [a, b, color]] of want) if (!arrows.has(k)) arrows.set(k, this.arrow(a, b, color));
  }

  update(dt, selected) {
    this.time += dt;
    this.syncArrows();
    const u = this.mat.uniforms;
    u.uTime.value = this.time;
    u.uSel.value = selected ? this.war.regions.indexOf(selected) : -1;
    u.uHover.value = this.hover;
    for (const a of this.arrows.values()) a.mesh.material.uniforms.uTime.value = this.time;
  }

  dispose() {
    const c = this.stage.renderer.domElement;
    c.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    for (const off of this.subs) off();
    for (const a of this.arrows.values()) this.removeArrow(a);
    this.stage.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.mapTex.dispose();
    this.idTex.dispose();
  }
}
