import './style.css';
import { clearSave, readSave, writeSave } from './core/save.js';
import { Bus } from './core/util.js';
import { Sound } from './core/sound.js';
import { buildHouse } from './content/levels/house.js';
import { TOWN_LEVELS, buildTown } from './content/levels/town.js';
import { CityScript } from './content/story/city.js';
import { RadioFeed } from './content/story/feed.js';
import { HouseScript } from './content/story/house.js';
import { StreetScript } from './content/story/street.js';
import { VillageScript } from './content/story/village.js';
import { CITY_MAP } from './content/war/city.js';
import { Atmosphere } from './render/Atmosphere.js';
import { CityView } from './render/CityView.js';
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
import { volumeControl } from './ui/volume.js';
import { WarHud } from './ui/warHud.js';

const params = new URLSearchParams(location.search);
const STEP = 1 / 30;
const ORDER = ['house', 'street', 'village', 'town', 'world'];
const SCRIPTS = { house: HouseScript, street: StreetScript, village: VillageScript, town: CityScript };
const TITLES = { street: 'Улица', village: 'Село', town: 'Город', world: 'Мир' };
const finaleModule = import.meta.glob('./ui/finale.js');
const eventsModule = import.meta.glob('./content/war/events.js');
window.__g = {};

const stage = new Stage(document.getElementById('c'));
const bus = new Bus();
const G = { world: null, script: null, diorama: null, units: null, atmosphere: null, index: 0, presets: {} };
let hud = null;
let sound = null;
let input = null;

// Счёт для финала: копится через все этапы.
const totals = { clicks: 0, food: 0, startedAt: 0 };
window.addEventListener('pointerdown', () => totals.clicks++);
bus.on('deposit', ({ v }) => (totals.food += v));

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

// Партия хранится по этапам, а война ещё и по снимкам.
function persist(stageId) {
  writeSave({ stage: stageId, done: G.carry?.done, clicks: totals.clicks, food: totals.food, played: performance.now() - totals.startedAt, war: stageId === 'world' ? G.war.snapshot() : null });
}

// Сборка этапа: прошлый полностью убирается со сцены.
function loadLevel(id) {
  G.script?.dispose?.();
  G.diorama?.dispose(stage.scene);
  G.units?.dispose();
  G.atmosphere?.dispose();
  const level = id === 'house' ? buildHouse() : buildTown(TOWN_LEVELS[id]);
  const world = new World(level, 7, bus);
  const script = new SCRIPTS[id](world);
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
  if (id !== 'house') persist(id);
  if (sound) sound.music.play(id);
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
// Громкость стоит на всех этапах и на обложке, клавиша M выключает музыку.
const volume = volumeControl(sound);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') volume.toggleMusic();
});

hud.handlers = {
  prompt: () => G.script.action(),
  buy: () => {
    if (G.city || G.war) return;
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
bus.on('zone', ({ index, world, noWeb }) => {
  G.diorama.setZone(index, false);
  const z = world.level.zones[index];
  if (!noWeb) world.seedWeb(z.x, z.z, z.r);
  bus.emit('ripple', { x: z.x, z: z.z, power: 1, kind: 'stomp' });
});

// Мировая война: глобус вместо диорамы.
function startWar(save = null) {
  G.diorama?.dispose(stage.scene);
  G.units?.dispose();
  G.atmosphere?.dispose();
  G.diorama = null;
  G.units = null;
  G.atmosphere = null;
  stage.warMode = true;
  sound.music.play('world');
  stage.renderer.toneMappingExposure = 1.3;
  hud.setFlags({ resources: false });
  hud.setObjective('');
  hud.setTip(null);
  const war = new War({ bus, done: G.carry?.done });
  if (save) war.restore(save);
  G.war = war;
  G.feed = new RadioFeed(bus, 'planet');
  G.view = new WarView(stage, war, bus);
  G.warHud = new WarHud(document.getElementById('ui'), war, G.view, bus, hud);
  Object.assign(window.__g, { war, warHud: G.warHud, view: G.view });
  eventsModule['./content/war/events.js']?.().then((m) => (war.events = m.EVENTS.slice(war.eventsUsed)));
  if (save) return;
  persist('world');
}

// Город: та же война на карте районов поверх диорамы.
function startCity() {
  const level = G.world.level;
  hud.setFlags({ resources: false });
  const war = new War({ bus, map: CITY_MAP });
  const view = new CityView(stage, war, level, bus);
  const warHud = new WarHud(document.getElementById('ui'), war, view, bus, hud);
  const paint = (r) => {
    for (const index of view.zonesOf(r)) bus.emit('zone', { index, world: G.world });
  };
  G.city = { war, view, hud: warHud, feed: new RadioFeed(bus, 'town'), off: bus.on('warCapture', paint) };
  paint(war.byId[CITY_MAP.start]);
  Object.assign(window.__g, { war, warHud, view });
}

bus.on('cityStart', startCity);

bus.on('cityEnd', (war) => {
  const c = G.city;
  c.off();
  c.hud.dispose();
  c.view.dispose();
  G.city = null;
  G.carry = { done: war.done };
  totals.food += Math.round(war.earned);
  bus.emit('levelComplete', { id: 'town' });
});

// Финал открывается после войны, а для проверки сразу с обложки.
function openFinale({ from, keepSave = false } = {}) {
  finaleModule['./ui/finale.js']?.().then(({ showFinale }) => {
    G.ended = true;
    crawlers.destroy();
    sound.music.stop();
    sound.audio.setMaster(0);
    const minutes = Math.round((performance.now() - totals.startedAt) / 60000);
    showFinale({
      from,
      stats: { minutes, clicks: totals.clicks, food: totals.food + Math.round(G.war?.earned ?? 0) },
      audioContext: sound.audio.ctx,
      volume: sound.finaleVolume,
      onEnd: (result) => result === 'won' && !keepSave && clearSave(),
      // Всё сначала: адрес без параметров открывает обложку.
      onRestart: () => location.assign(location.pathname),
    });
  });
}

bus.on('warEnd', () => {
  G.warHud.setSpeed(0);
  hud.fade({ hold: 1800, text: 'Население Земли: 1' });
  setTimeout(openFinale, 1500);
});

// Камера поднимается, прошлый этап уходит в темноту, появляется следующий.
bus.on('levelComplete', ({ note } = {}) => {
  const next = ORDER[G.index + 1];
  G.world.say(note ?? (next ? 'В соседнем горит свет.' : 'Огни кончились.'), { ms: 3500 });
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
  if (G.ended) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (G.war) {
    if (!window.__g.paused) G.war.tick(dt * G.warHud.speed * G.warHud.pace);
    const fights = G.war.units.filter((u) => u.attacking).length;
    sound.music.setMood(Math.min(1, fights * 0.1 + G.war.stage * 0.1 + (G.war.nuke ? 0.3 : 0)));
    G.saveT = (G.saveT ?? 15) - dt;
    if (G.saveT <= 0) {
      G.saveT = 15;
      persist('world');
    }
    G.feed.update(G.war.regions.filter((r) => r.owner === 'swarm').length / G.war.regions.length);
    stage.update(dt);
    G.view.update(dt, G.warHud.selected);
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
  if (G.city && !window.__g.paused) G.city.war.tick(dt * G.city.hud.speed);
  if (G.city) {
    const c = G.city;
    c.feed.update(c.war.regions.filter((r) => r.owner === 'swarm').length / c.war.regions.length);
    c.view.update(dt, c.hud.selected);
    c.hud.update();
  }
  input.update(dt);
  if (running) sound.music.setMood(G.city ? Math.min(1, G.city.war.units.filter((u) => u.attacking).length * 0.14) : Math.max(G.world.alert / 110, G.world.alarmOn ? 0.9 : 0, G.script?.moodFloor?.() ?? 0));
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
  sound.music.play(G.index ? ORDER[G.index] : 'house');
  totals.startedAt = performance.now();
  if (params.has('skip') && startId === 'house') G.script.debugSkip(params.get('skip'));
  else G.script.start();
}

// Продолжение партии со сохранённого этапа.
function resume(save) {
  running = true;
  G.carry = { done: save.done };
  totals.clicks = save.clicks;
  totals.food = save.food;
  totals.startedAt = performance.now() - save.played;
  if (save.stage === 'world') startWar(save.war ?? null);
  else {
    loadLevel(save.stage);
    G.script.start();
  }
}

// Вкладка замечает, что игрока нет.
document.addEventListener('visibilitychange', () => {
  document.title = document.hidden ? 'ты где?' : 'Рука цела';
  if (document.hidden && G.war && !G.ended) persist('world');
  if (!document.hidden && running) hud.say({ text: 'мы ждали', ms: 2000 });
});

if (wantWar) startWar();
else if (params.has('skip') || params.has('notitle') || startId !== 'house') begin();
else {
  const save = readSave();
  showTitle({
    stages: Object.entries(TITLES).map(([id, label]) => ({ id, label })),
    // Кнопка проверки: есть в npm run dev и по адресу с ?finale, жюри её не видит.
    onFinale: import.meta.env.DEV || params.has('finale') ? () => openFinale({ from: 'radio', keepSave: true }) : null,
    onStage: (id, { lessFlicker }) => {
      clearSave();
      hud.lessFlicker = lessFlicker;
      resume({ stage: id, clicks: 0, food: 0, played: 0 });
    },
    onWar: ({ lessFlicker }) => {
      clearSave();
      hud.lessFlicker = lessFlicker;
      hud.fade({ hold: 2600, text: 'Прошли годы. Рой научился думать.' });
      setTimeout(() => resume({ stage: 'world', clicks: 0, food: 0, played: 0 }), 900);
    },
    resumeLabel: save && `Продолжить: ${TITLES[save.stage]}`,
    onResume: ({ lessFlicker }) => {
      hud.lessFlicker = lessFlicker;
      resume(save);
    },
    onStart: ({ lessFlicker }) => {
      clearSave();
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

Object.assign(window.__g, { stage, hud, advance, sound, G, loadLevel, startWar, totals, paused: params.has('paused') });
