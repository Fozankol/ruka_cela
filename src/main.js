import './style.css';
import { Bus } from './core/util.js';
import { Sound } from './core/sound.js';
import { buildHouse } from './content/levels/house.js';
import { TOWN_LEVELS, buildTown } from './content/levels/town.js';
import { HouseScript } from './content/story/house.js';
import { TownScript } from './content/story/town.js';
import { Atmosphere } from './render/Atmosphere.js';
import { Diorama } from './render/Diorama.js';
import { Stage } from './render/Stage.js';
import { Units } from './render/Units.js';
import { WarView } from './render/WarView.js';
import { War } from './sim/war.js';
import { World } from './sim/world.js';
import { CameraInput } from './ui/camera.js';
import { Crawlers } from './ui/crawlers.js';
import { Hud } from './ui/hud.js';
import { showTitle } from './ui/title.js';
import { WarHud } from './ui/warHud.js';

const params = new URLSearchParams(location.search);
const STEP = 1 / 30;
const ORDER = ['house', 'street', 'village', 'town', 'world'];
const finaleModule = import.meta.glob('./ui/finale.js');
const eventsModule = import.meta.glob('./content/war/events.js');
window.__g = {};

const stage = new Stage(document.getElementById('c'));
const bus = new Bus();
const G = { world: null, script: null, diorama: null, units: null, atmosphere: null, index: 0, presets: {} };
let hud = null;
let sound = null;
let input = null;

function setPresets(level) {
  const p = level.points;
  G.presets = {
    crawl: { dist: 1.7, pitch: 0.3, yaw: 1.12, soft: 2.6 },
    hand: { target: { x: p.hand.x + 0.07, z: p.hand.z + 0.1, y: 0.16 }, dist: 1.0, pitch: 0.15, yaw: 0.02, soft: 2.4 },
    flee: { dist: 3.4, pitch: 0.62, yaw: 1.05, soft: 2.2 },
    room: { target: { x: p.crack.x - 1.3, z: p.crack.z + 2.1 }, dist: 8.2, pitch: 1.02, yaw: 1.57, soft: 1.6 },
    house: { target: { x: level.worldW / 2, z: level.worldD / 2 + 0.4 }, dist: 18, pitch: 1.12, yaw: 1.57, soft: 1.4 },
  };
  stage.setCamera({ ...G.presets.crawl, target: { x: p.start.x - 0.3, z: p.start.z - 0.3, y: 0.15 } }, true);
  stage.rig.goal.y = 0.15;
  stage.rig.target.y = 0.15;
}

// Сборка этапа: прошлый полностью убирается со сцены.
function loadLevel(id) {
  G.diorama?.dispose(stage.scene);
  G.units?.dispose();
  G.atmosphere?.dispose();
  const level = id === 'house' ? buildHouse() : buildTown(TOWN_LEVELS[id]);
  const world = new World(level, 7, bus);
  const script = id === 'house' ? new HouseScript(world) : new TownScript(world);
  world.script = script;
  G.world = world;
  G.script = script;
  G.index = ORDER.indexOf(id);
  stage.bindMap(level.grid);
  stage.renderer.toneMappingExposure = id === 'house' ? 1.3 : 2.4;
  G.diorama = new Diorama(level, stage.scene);
  G.units = new Units(world, stage);
  G.atmosphere = new Atmosphere(world, stage);
  stage.rig.follow = null;
  if (hud) hud.world = world;
  if (sound) {
    sound.world = world;
    sound.script = script;
  }
  if (input) input.world = world;
  Object.assign(window.__g, { world, script, units: G.units });
  if (id === 'house') {
    setPresets(level);
  } else {
    stage.setCamera({ ...level.cfg.camera, target: { x: level.worldW / 2, y: 0, z: level.worldD / 2 } }, true);
    stage.rig.userPan = true;
  }
}

const wantWar = params.get('level') === 'world';
const startId = wantWar ? 'house' : params.get('level') ?? 'house';
loadLevel(startId);

hud = new Hud(document.getElementById('ui'), G.world, stage);
sound = new Sound(G.world, stage, G.script);
input = new CameraInput(G.world, stage, hud);
const crawlers = new Crawlers();
hud.handlers = {
  prompt: () => G.script.action(),
  buy: () => {
    const err = G.world.buyWorker();
    if (err) hud.notice(err);
  },
};

bus.on('camera', ({ preset, follow }) => {
  stage.setCamera(G.presets[preset]);
  stage.rig.follow = follow ? () => G.world.hero ?? stage.rig.goal : null;
  stage.rig.userPan = !follow;
});
bus.on('shake', (v) => (stage.shake = Math.max(stage.shake, v)));
bus.on('lamp', ({ id, on }) => G.diorama.setLamp(id, on));
bus.on('zone', ({ index, world }) => {
  G.diorama.setZone(index, false);
  const z = world.level.zones[index];
  world.seedWeb(z.x, z.z, z.r);
  bus.emit('ripple', { x: z.x, z: z.z, power: 1, kind: 'stomp' });
});

// Мировая война: глобус вместо диорамы.
function startWar() {
  G.diorama?.dispose(stage.scene);
  G.units?.dispose();
  G.atmosphere?.dispose();
  G.diorama = null;
  G.units = null;
  G.atmosphere = null;
  stage.warMode = true;
  stage.renderer.toneMappingExposure = 1.3;
  hud.setFlags({ resources: false });
  hud.setObjective('');
  hud.setTip(null);
  const war = new War({ bus });
  G.war = war;
  G.view = new WarView(stage, war, bus);
  G.warHud = new WarHud(document.getElementById('ui'), war, G.view, bus, hud);
  Object.assign(window.__g, { war, warHud: G.warHud, view: G.view });
  eventsModule['./content/war/events.js']?.().then((m) => (war.events = [...m.EVENTS]));
  hud.addRadio({ who: 'Лена', text: 'Говорит Лена. Они вышли за города. Кто слышит, не шевелитесь.' });
}

bus.on('warEnd', () => {
  G.warHud.setSpeed(0);
  hud.fade({ hold: 1800, text: 'Население Земли: 1' });
  const load = finaleModule['./ui/finale.js'];
  if (!load) return;
  setTimeout(() => {
    load().then(({ showFinale }) => showFinale({ stats: { minutes: Math.round(performance.now() / 60000), clicks: G.world?.stats.clicks ?? 0, food: 0 }, onEnd: () => {} }));
  }, 1500);
});

// Камера поднимается, прошлый этап уходит в темноту, появляется следующий.
bus.on('levelComplete', () => {
  const next = ORDER[G.index + 1];
  G.world.say(next ? 'В соседнем горит свет.' : 'Огни кончились.', { ms: 3500 });
  stage.setCamera({ dist: stage.rig.goalDist * 1.8, soft: 0.5 });
  if (!next) return;
  setTimeout(() => {
    hud.fade({ hold: 2200, text: next === 'world' ? 'Прошли годы.' : TOWN_LEVELS[next].intro });
    setTimeout(() => {
      if (next === 'world') {
        startWar();
        return;
      }
      loadLevel(next);
      G.script.start();
    }, 900);
  }, 3500);
});

let running = false;
const speed = Number(params.get('speed')) || 1;
let acc = 0;
let last = performance.now();
let frames = 0;
let fpsT = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (G.war) {
    if (!window.__g.paused) G.war.tick(dt * G.warHud.speed);
    stage.update(dt);
    G.view.update(dt);
    G.warHud.update();
    crawlers.setInfection(Math.min(1, 0.7 + G.war.tension / 330));
    crawlers.update(dt);
    stage.render(G.world);
    requestAnimationFrame(frame);
    return;
  }
  if (running && !window.__g.paused) {
    acc += dt * speed;
    while (acc >= STEP) {
      G.world.tick(STEP);
      acc -= STEP;
    }
  }
  input.update(dt);
  if (running && !window.__g.paused) sound.update(dt * speed);
  crawlers.setInfection(Math.min(1, G.index * 0.22 + G.world.alert / 400));
  crawlers.update(dt);
  stage.update(dt);
  stage.updateMap(dt);
  G.units.update(dt, acc / STEP);
  G.atmosphere.update();
  hud.update();
  stage.render(G.world);
  frames++;
  fpsT += dt;
  if (fpsT >= 1) {
    window.__fps = Math.round(frames / fpsT);
    frames = 0;
    fpsT = 0;
  }
  requestAnimationFrame(frame);
}

function begin() {
  running = true;
  if (params.has('skip') && startId === 'house') G.script.debugSkip(params.get('skip'));
  else G.script.start();
}

if (wantWar) startWar();
else if (params.has('skip') || params.has('notitle') || startId !== 'house') begin();
else {
  showTitle({
    onStart: ({ lessFlicker }) => {
      hud.lessFlicker = lessFlicker;
      hud.fade({ hold: 3000, text: 'Ташкент, 02:14. Ночью каракурт чуть не укусил человека за руку.' });
      setTimeout(begin, 2600);
    },
  });
}

requestAnimationFrame(frame);

// Перемотка для автотестов: скрытая вкладка почти не получает кадров.
function advance(seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    G.world.tick(STEP);
    stage.update(STEP);
    stage.updateMap(STEP);
    G.units.update(STEP, 1);
  }
  G.atmosphere.update();
  hud.update();
  stage.render(G.world);
}

Object.assign(window.__g, { stage, hud, advance, sound, G, loadLevel, startWar, paused: params.has('paused') });
