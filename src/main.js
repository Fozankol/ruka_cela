import './style.css';
import { Sound } from './core/sound.js';
import { buildHouse } from './content/levels/house.js';
import { HouseScript } from './content/story/house.js';
import { Atmosphere } from './render/Atmosphere.js';
import { Diorama } from './render/Diorama.js';
import { Stage } from './render/Stage.js';
import { Units } from './render/Units.js';
import { World } from './sim/world.js';
import { Hud, showTitle } from './ui/hud.js';
import { CameraInput } from './ui/camera.js';

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
const atmosphere = new Atmosphere(world, stage);
const hud = new Hud(document.getElementById('ui'), world, stage);
const input = new CameraInput(world, stage);
hud.handlers = {
  train: (kind) => hud.showError(world.train(kind)),
  upgrade: (id) => hud.showError(world.buyUpgrade(id)),
  attack: () => script.launch(),
  prompt: () => script.action(),
};

const p = level.points;
const presets = {
  crawl: { dist: 1.7, pitch: 0.3, yaw: 1.12, soft: 2.6 },
  hand: { target: { x: p.hand.x + 0.07, z: p.hand.z + 0.1, y: 0.16 }, dist: 1.0, pitch: 0.15, yaw: 0.02, soft: 2.4 },
  flee: { dist: 3.4, pitch: 0.62, yaw: 1.05, soft: 2.2 },
  room: { target: { x: p.crack.x - 1.3, z: p.crack.z + 2.1 }, dist: 8.2, pitch: 1.02, yaw: 1.57, soft: 1.6 },
  hall: { target: { x: p.wire.x - 0.4, z: p.wire.z - 0.2 }, dist: 9, pitch: 1.02, yaw: 1.57, soft: 1.4 },
  old: { target: { x: p.grandpa.x - 1.2, z: p.grandpa.z + 1.8 }, dist: 10, pitch: 1.02, yaw: 1.57, soft: 1.4 },
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
world.bus.on('blackout', () => diorama.powerOff());
world.bus.on('levelComplete', () => {
  world.say('Первый дом молчит. В соседнем горит свет.', { ms: 9000 });
  stage.setCamera({ target: { x: p.outside.x, z: p.outside.z + 8 }, dist: 46, pitch: 0.95, yaw: 1.57, soft: 0.5 });
});

const sound = new Sound(world, stage, script);

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
  input.update(dt);
  if (running && !window.__g.paused) sound.update(dt * speed);
  stage.update(dt);
  stage.updateMap(dt);
  units.update(dt, acc / STEP);
  atmosphere.update();
  hud.update();
  stage.render(world);
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
  atmosphere.update();
  hud.update();
  stage.render(world);
}

Object.assign(window.__g, { world, stage, script, units, hud, advance, sound, paused: params.has('paused') });
