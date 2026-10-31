import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { T } from '../sim/grid.js';
import { CAST_LAYER } from './KeyShadow.js';
import { MAT } from './textures.js';
import { worldMaterial } from './worldMaterial.js';

const WALL = 0x8f8778;
const CAP = 0xcfc8b8;
const SKIRT = 0x4a3a2c;

function paint(raw, color, mat = MAT.PLAIN, emis = 0) {
  const geo = raw.index ? raw.toNonIndexed() : raw;
  if (raw !== geo) raw.dispose();
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aEmis', new THREE.BufferAttribute(new Float32Array(n).fill(emis), 1));
  geo.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
  return geo;
}

function box(x, z, w, d, y, h, color, mat, emis) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x + w / 2, y + h / 2, z + d / 2);
  return paint(g, color, mat, emis);
}

function rbox(p) {
  const r = Math.min(p.r ?? 0.03, p.w / 2.01, p.h / 2.01, p.d / 2.01);
  const g = new RoundedBoxGeometry(p.w, p.h, p.d, 3, r);
  if (p.rot) g.rotateY(p.rot);
  g.translate(p.x + p.w / 2, p.y + p.h / 2, p.z + p.d / 2);
  return paint(g, p.c, p.m);
}

// Одеяло: сетка с буграми от тел и складками, край свисает с матраса.
function blanket(p) {
  const nx = 34;
  const nz = 38;
  const over = 0.2;
  const W = p.w + over * 2;
  const D = p.d + over;
  const g = new THREE.PlaneGeometry(W, D, nx, nz);
  g.rotateX(-Math.PI / 2);
  g.translate(p.x + p.w / 2, 0, p.z + p.d / 2 + over / 2);
  const pos = g.attributes.position;
  const fold = (x, z) => Math.sin(x * 9 + Math.sin(z * 3) * 1.6) * 0.012 + Math.sin(z * 7 + x * 3) * 0.012 + Math.sin(x * 21 + z * 13) * 0.004;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const ex = Math.max(p.x - x, x - (p.x + p.w), 0);
    const ez = Math.max(z - (p.z + p.d), 0);
    const edge = Math.max(ex, ez);
    let y = p.y + fold(x, z);
    for (const b of p.bodies ?? []) {
      const along = Math.min(1, Math.max(0, (z - b.z0) / 0.25)) * Math.min(1, Math.max(0, (b.z1 - z) / 0.3));
      const across = Math.exp(-(((x - b.x) / 0.21) ** 2));
      y += b.h * across * along;
    }
    y -= edge * 1.9;
    pos.setY(i, y);
  }
  g.computeVertexNormals();
  return paint(g, p.c, MAT.FABRIC);
}

// Занавеска со складками.
function curtain(p) {
  const g = new THREE.PlaneGeometry(p.w, p.h, 26, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 34) * 0.022);
  g.computeVertexNormals();
  if (p.flip) g.rotateY(Math.PI);
  g.translate(p.x + p.w / 2, p.y + p.h / 2, p.z);
  return paint(g, p.c, MAT.FABRIC);
}

function propGeo(p) {
  switch (p.s) {
    case 'box':
      return box(p.x, p.z, p.w, p.d, p.y, p.h, p.c, p.m, p.emis);
    case 'rbox':
      return rbox(p);
    case 'floor':
      return box(p.x, p.z, p.w, p.d, -0.02, 0.02, p.c, p.m);
    case 'blanket':
      return blanket(p);
    case 'curtain':
      return curtain(p);
    case 'sph': {
      const g = new THREE.SphereGeometry(1, 18, 12);
      g.scale(p.sx, p.sy, p.sz);
      g.translate(p.x, p.y, p.z);
      return paint(g, p.c, p.m);
    }
    default: {
      const g = new THREE.CylinderGeometry(p.r, p.r1 ?? p.r * 1.05, p.h, 16);
      g.translate(p.x, p.y + p.h / 2, p.z);
      return paint(g, p.c, p.m);
    }
  }
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
        geos.push(box(x, z, w, g.cell, 0, 0.52, WALL, MAT.PLASTER));
        geos.push(box(x, z, w, g.cell, 0.52, 0.03, 0xb8b0a0, MAT.WOOD));
        geos.push(box(x, z, w, g.cell, 1.04, H - 1.04, WALL, MAT.PLASTER));
      } else {
        geos.push(box(x, z, w, g.cell, 0, H, WALL, MAT.PLASTER));
        geos.push(box(x, z, w, g.cell, H, 0.012, CAP, MAT.PLAIN, 0.04));
      }
      geos.push(box(x - 0.012, z - 0.012, w + 0.024, g.cell + 0.024, 0, 0.085, SKIRT, MAT.WOOD));
      cx = end + 1;
    }
  }
  return geos;
}

function clockTexture(text) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 56;
  const x = c.getContext('2d');
  x.fillStyle = '#050102';
  x.fillRect(0, 0, 128, 56);
  x.font = 'bold 42px Consolas, monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#ff3a22';
  x.fillText(text, 64, 30);
  return new THREE.CanvasTexture(c);
}

export class Diorama {
  constructor(level, scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    const geos = [...level.props.map(propGeo), ...wallGeos(level)];
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    this.mesh = new THREE.Mesh(merged, worldMaterial({ vertexColors: true, emissive: true }));
    this.mesh.layers.enable(CAST_LAYER);
    this.group.add(this.mesh);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), worldMaterial({ color: 0x4c5a44, mat: MAT.GRASS }));
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
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(l.bulbR ?? 0.05, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(5.2, 3.2, 1.4) }));
      bulb.position.set(...l.bulb);
      bulb.visible = l.on;
      this.group.add(bulb);
      this.bulbs.set(l.id, bulb);
    }

    for (const c of level.clocks ?? []) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.085, 0.037), new THREE.MeshBasicMaterial({ map: clockTexture(c.text), color: new THREE.Color(2.4, 2.4, 2.4) }));
      m.position.set(c.x, c.y, c.z);
      m.rotation.y = c.rot ?? 0;
      this.group.add(m);
      this.clock = m;
    }
  }

  setLamp(id, on) {
    const b = this.bulbs.get(id);
    if (b) b.visible = on;
  }

  // После обрыва провода гаснут и электронные часы.
  powerOff() {
    if (this.clock) this.clock.visible = false;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
  }
}
