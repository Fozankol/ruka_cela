import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { T } from '../sim/grid.js';
import { worldMaterial } from './worldMaterial.js';

const WALL = 0x9c9484;
const CAP = 0xcfc8b8;

function paint(geo, color, emis = 0) {
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  const emits = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    emits[i] = emis;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aEmis', new THREE.BufferAttribute(emits, 1));
  return geo;
}

function box(x, z, w, d, y, h, color, emis) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x + w / 2, y + h / 2, z + d / 2);
  return paint(g, color, emis);
}

function propGeo(p) {
  if (p.s === 'box') return box(p.x, p.z, p.w, p.d, p.y, p.h, p.c, p.emis);
  if (p.s === 'floor') return box(p.x, p.z, p.w, p.d, -0.02, 0.02, p.c);
  if (p.s === 'sph') {
    const g = new THREE.SphereGeometry(1, 14, 10);
    g.scale(p.sx, p.sy, p.sz);
    g.translate(p.x, p.y, p.z);
    return paint(g, p.c);
  }
  const g = new THREE.CylinderGeometry(p.r, p.r * 1.05, p.h, 12);
  g.translate(p.x, p.y + p.h / 2, p.z);
  return paint(g, p.c);
}

// Стены собираются из клеток сетки, поэтому всегда совпадают с логикой.
function wallGeos(level) {
  const g = level.grid;
  const geos = [];
  const H = level.wallHeight;
  const inWindow = (cx, cz) => {
    const x = g.wx(cx);
    const z = g.wz(cz);
    return level.windows.some((w) => x >= w.x && x <= w.x + w.w && z >= w.z && z <= w.z + w.d);
  };
  for (let cz = 0; cz < g.h; cz++) {
    let cx = 0;
    while (cx < g.w) {
      const i = g.idx(cx, cz);
      if (g.type[i] !== T.WALL) {
        cx++;
        continue;
      }
      const win = inWindow(cx, cz);
      let end = cx;
      while (end + 1 < g.w && g.type[g.idx(end + 1, cz)] === T.WALL && inWindow(end + 1, cz) === win) end++;
      const x = cx * g.cell;
      const z = cz * g.cell;
      const w = (end - cx + 1) * g.cell;
      if (win) {
        geos.push(box(x, z, w, g.cell, 0, 0.52, WALL));
        geos.push(box(x, z, w, g.cell, 1.04, H - 1.04, WALL));
      } else {
        geos.push(box(x, z, w, g.cell, 0, H, WALL));
        geos.push(box(x, z, w, g.cell, H, 0.012, CAP, 0.05));
      }
      cx = end + 1;
    }
  }
  return geos;
}

export class Diorama {
  constructor(level, scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const geos = [...level.props.map(propGeo), ...wallGeos(level)];
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    this.mesh = new THREE.Mesh(merged, worldMaterial({ vertexColors: true, emissive: true }));
    this.group.add(this.mesh);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), worldMaterial({ color: 0x2a3a2c }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(level.worldW / 2, -0.04, level.worldD / 2);
    this.group.add(ground);

    const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.3, 0.55), transparent: true, opacity: 0.32, depthWrite: false });
    for (const w of level.windows) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(w.w, 0.52, w.d * 0.2), glass);
      pane.position.set(w.x + w.w / 2, 0.78, w.z + w.d / 2);
      this.group.add(pane);
      if (w.tag) this[w.tag] = pane;
    }

    this.bulbs = new Map();
    for (const l of level.lights) {
      if (!l.bulb) continue;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 4.4, 2) }));
      bulb.position.set(...l.bulb);
      bulb.visible = l.on;
      this.group.add(bulb);
      this.bulbs.set(l.id, bulb);
    }
  }

  setLamp(id, on) {
    const b = this.bulbs.get(id);
    if (b) b.visible = on;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}
