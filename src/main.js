import './style.css';
import { buildHouse } from './content/levels/house.js';
import { HouseScript } from './content/story/house.js';
import { Diorama } from './render/Diorama.js';
import { Stage } from './render/Stage.js';
import { Units } from './render/Units.js';
import { World } from './sim/world.js';
import { Hud, showTitle } from './ui/hud.js';

const params = new URLSearchParams(location.search);
const STEP = 1 / 30;
window.__g = {};

const stage = new Stage(document.getElementById('c'));
const level = buildHouse();
const world = new World(level);
const script = new HouseScript(world);
world.script = script;

stage.bindMap(level.grid);
const diorama = new Diorama(level, stage.scene);
const units = new Units(world, stage);
const hud = new Hud(document.getElementById('ui'), world, {
  onPrompt: () => script.action(),
  onBuy: (kind) => world.buy(kind),
});

const p = level.points;
const presets = {
  crawl: { dist: 1.7, pitch: 0.3, yaw: 1.12, soft: 2.6 },
  flee: { dist: 3.4, pitch: 0.62, yaw: 1.05, soft: 2.2 },
  room: { target: { x: p.crack.x - 2.6, z: p.crack.z + 2.1 }, dist: 8.2, pitch: 1.02, yaw: 1.57, soft: 1.6 },
  house: { target: { x: level.worldW / 2, z: level.worldD / 2 }, dist: 19, pitch: 1.08, yaw: 1.57, soft: 1.2 },
};

stage.setCamera({ ...presets.crawl, target: { x: p.start.x - 0.3, z: p.start.z - 0.3, y: 0.15 } }, true);
stage.rig.goal.y = 0.15;
stage.rig.target.y = 0.15;

world.bus.on('camera', ({ preset, follow }) => {
  stage.setCamera(presets[preset]);
  stage.rig.follow = follow ? () => world.hero ?? stage.rig.goal : null;
  stage.rig.userPan = !follow;
});
world.bus.on('shake', (v) => (stage.shake = Math.max(stage.shake, v)));
world.bus.on('lamp', ({ id, on }) => diorama.setLamp(id, on));
world.bus.on('levelComplete', () => {
  world.say('Первый дом молчит. В соседнем горит свет.', { ms: 9000 });
  stage.setCamera({ target: { x: p.outside.x, z: p.outside.z + 8 }, dist: 46, pitch: 0.95, yaw: 1.57, soft: 0.5 });
});

// Управление.
const canvas = stage.renderer.domElement;
let held = false;
let panning = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  lastX = e.clientX;
  lastY = e.clientY;
  if (e.button !== 0) {
    panning = true;
    return;
  }
  held = true;
  const hit = stage.pick(e.clientX, e.clientY);
  if (hit) world.setMark(hit.x, hit.z, true);
});
window.addEventListener('pointerup', () => {
  held = false;
  panning = false;
});
window.addEventListener('pointermove', (e) => {
  if (held && script.step !== 'idle') {
    const hit = stage.pick(e.clientX, e.clientY);
    if (hit) world.setMark(hit.x, hit.z);
  }
  if (panning && stage.rig.userPan) {
    const k = stage.rig.dist * 0.0014;
    stage.rig.goal.x -= (e.clientX - lastX) * k;
    stage.rig.goal.z -= (e.clientY - lastY) * k;
  }
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener(
  'wheel',
  (e) => {
    if (!stage.rig.userPan) return;
    e.preventDefault();
    stage.rig.goalDist = Math.max(2.5, Math.min(26, stage.rig.goalDist * (1 + Math.sign(e.deltaY) * 0.12)));
  },
  { passive: false },
);

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') {
    e.preventDefault();
    script.action();
  }
  if (e.code === 'Digit1') world.buy('ling');
  if (e.code === 'Digit2') world.buy('weaver');
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function panKeys(dt) {
  if (!stage.rig.userPan) return;
  const v = stage.rig.dist * 0.8 * dt;
  if (keys.has('KeyW') || keys.has('ArrowUp')) stage.rig.goal.z -= v;
  if (keys.has('KeyS') || keys.has('ArrowDown')) stage.rig.goal.z += v;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) stage.rig.goal.x -= v;
  if (keys.has('KeyD') || keys.has('ArrowRight')) stage.rig.goal.x += v;
}

let running = false;
const speed = Number(params.get('speed')) || 1;
let acc = 0;
let last = performance.now();
let frames = 0;
let fpsT = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running && !window.__g.paused) {
    acc += dt * speed;
    while (acc >= STEP) {
      world.tick(STEP);
      acc -= STEP;
    }
  }
  panKeys(dt);
  stage.update(dt);
  stage.updateMap(dt);
  units.update(dt, acc / STEP);
  hud.update();
  stage.render();
  frames++;
  fpsT += dt;
  if (fpsT >= 1) {
    window.__fps = Math.round(frames / fpsT);
    frames = 0;
    fpsT = 0;
  }
  requestAnimationFrame(frame);
}

const skip = params.get('skip');
showTitle(
  document.getElementById('ui'),
  () => {
    running = true;
    if (skip) script.debugSkip(skip);
    else script.start();
  },
  !!skip || params.has('notitle'),
);

requestAnimationFrame(frame);

// Перемотка для автотестов: скрытая вкладка почти не получает кадров.
function advance(seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    world.tick(STEP);
    stage.update(STEP);
    stage.updateMap(STEP);
    units.update(STEP, 1);
  }
  hud.update();
  stage.render();
}

Object.assign(window.__g, { world, stage, script, units, hud, advance, paused: params.has('paused') });
