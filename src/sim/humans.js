import { clamp, dist } from '../core/util.js';

const STEP = { x: 0, z: 0 };

export function makeHuman(def) {
  return {
    ...def,
    px: def.x,
    pz: def.z,
    dir: 0,
    state: 'sleep',
    t: 0,
    cool: 0,
    venom: 0,
    venomMax: def.deepSleep ? 1.3 : 2.2,
    wrap: 0,
    attached: 0,
    lie: 1,
    speed: 1.15,
    moving: false,
    stepT: 0,
    field: null,
    then: null,
    brain: null,
    torch: null,
    huntable: false,
    aggressive: false,
    swatT: 0,
    jerk: 0,
    fade: 0,
    swing: 0,
    bed: { x: def.x, z: def.z },
  };
}

export const isAwake = (h) => !['sleep', 'para', 'wrap', 'cocoon', 'gone', 'still'].includes(h.state);
export const isDown = (h) => ['para', 'wrap', 'cocoon', 'gone'].includes(h.state);

export function setState(h, state) {
  h.state = state;
  h.t = 0;
}

export function wake(world, h, then) {
  if (h.state !== 'sleep') return;
  setState(h, 'rise');
  h.then = then || null;
}

export function lieDown(h) {
  h.downX = h.x;
  h.downZ = h.z;
  h.dir = 0;
  setState(h, 'lie-down');
}

export function goTo(world, h, x, z, then, speed) {
  h.field = world.grid.flow(x, z, 'human');
  h.goalX = x;
  h.goalZ = z;
  h.then = then || null;
  if (speed) h.speed = speed;
  setState(h, 'walk');
}

export function giveTorch(world, h) {
  if (h.torch) return;
  h.torch = { id: `torch-${h.id}`, x: h.x, z: h.z, dir: h.dir, cone: 0.62, radius: 4.6, power: 1.05, warm: false, on: true, dynamic: true };
  world.lights.push(h.torch);
}

export function dropTorch(world, h) {
  if (!h.torch) return;
  world.lights = world.lights.filter((l) => l !== h.torch);
  h.torch = null;
}

function step(world, h, dt) {
  h.moving = true;
  if (!world.grid.nextStep(h.field, h.x, h.z, STEP)) return true;
  const dx = STEP.x - h.x;
  const dz = STEP.z - h.z;
  const d = Math.hypot(dx, dz);
  const web = world.grid.web[world.grid.at(h.x, h.z)];
  const speed = h.speed * (1 - web * 0.55);
  if (d > 1e-4) {
    const v = Math.min(speed * dt, d);
    h.x += (dx / d) * v;
    h.z += (dz / d) * v;
    h.dir = Math.atan2(dz, dx);
  }
  h.stepT -= dt;
  if (h.stepT <= 0) {
    h.stepT = 0.42;
    world.bus.emit('ripple', { x: h.x, z: h.z, power: 0.8, kind: 'step' });
  }
  return dist(h.x, h.z, h.goalX, h.goalZ) < 0.28;
}

function nearestVisibleSpider(world, h, range) {
  let best = null;
  let bestD = range;
  for (const s of world.spiders) {
    if (s.hidden || s.on) continue;
    const d = dist(h.x, h.z, s.x, s.z);
    if (d >= bestD) continue;
    if (world.grid.litAt(s.x, s.z) < 0.28) continue;
    best = s;
    bestD = d;
  }
  return best;
}

export function stomp(world, h, x, z) {
  setState(h, 'stomp');
  h.sx = x;
  h.sz = z;
  h.dir = Math.atan2(z - h.z, x - h.x);
  world.bus.emit('slipper', { x, z, phase: 'warn', life: 0.85 });
}

function awakeUpkeep(world, h, dt) {
  // В темноте человек слепнет: яд копится, а пауков он стряхивает вдвое реже.
  h.venom = Math.max(0, h.venom - (h.torch ? 0.02 : 0.004) * dt);
  h.cool -= dt;
  if (h.torch) {
    h.torch.x = h.x;
    h.torch.z = h.z;
    h.torch.dir = h.dir + Math.sin(world.t * 1.7 + h.x) * 0.5;
  }
  if (h.attached > 0) {
    h.swatT -= dt;
    if (h.swatT <= 0) {
      h.swatT = h.torch ? 0.8 : 1.7;
      world.swat(h);
    }
  }
}

function look(world, h) {
  if (!h.aggressive || h.cool > 0) return false;
  const s = nearestVisibleSpider(world, h, 3.4);
  if (!s) return false;
  const d = dist(h.x, h.z, s.x, s.z);
  if (d < 1.0) {
    stomp(world, h, s.x, s.z);
    return true;
  }
  goTo(world, h, s.x, s.z, null, h.speed);
  h.cool = 0.5;
  return true;
}

export function tickHuman(world, h, dt) {
  h.px = h.x;
  h.pz = h.z;
  h.t += dt;
  h.moving = false;
  h.jerk = Math.max(0, h.jerk - dt * 3.5);

  const venomGain = h.attached * world.biteRate * dt;
  if (venomGain > 0) h.venom += venomGain;
  if (h.venom >= h.venomMax && !isDown(h)) {
    dropTorch(world, h);
    setState(h, 'para');
    world.onParalyzed(h);
  }

  switch (h.state) {
    case 'sleep':
      if (h.venom > 0.02 && !h.deepSleep) wake(world, h);
      break;
    case 'rise':
      h.lie = clamp(1 - h.t / 1.1);
      h.x = h.bed.x + ((h.standX ?? h.bed.x) - h.bed.x) * (1 - h.lie);
      h.z = h.bed.z + ((h.standZ ?? h.bed.z) - h.bed.z) * (1 - h.lie);
      if (h.lie === 0) {
        const next = h.then;
        h.then = null;
        setState(h, 'alert');
        if (next) next();
      }
      break;
    case 'lie-down':
      h.lie = clamp(h.t / 1.1);
      h.x = h.downX + (h.bed.x - h.downX) * h.lie;
      h.z = h.downZ + (h.bed.z - h.downZ) * h.lie;
      if (h.lie === 1) setState(h, 'sleep');
      break;
    case 'walk': {
      awakeUpkeep(world, h, dt);
      if (look(world, h)) break;
      if (step(world, h, dt)) {
        const next = h.then;
        h.then = null;
        setState(h, 'alert');
        if (next) next();
      }
      break;
    }
    case 'alert':
      awakeUpkeep(world, h, dt);
      h.dir += Math.sin(h.t * 1.3) * dt * 1.4;
      if (look(world, h)) break;
      if (h.t > (h.pause ?? 1.6) && h.brain) h.brain(world, h);
      break;
    case 'stomp':
      awakeUpkeep(world, h, dt);
      h.swing = clamp(h.t / 0.85);
      if (h.t >= 0.85) {
        world.slipperHit(h, h.sx, h.sz);
        setState(h, 'recover');
      }
      break;
    case 'recover':
      awakeUpkeep(world, h, dt);
      h.swing = clamp(1 - h.t / 0.45);
      if (h.t > 0.45) {
        h.cool = 1.4;
        setState(h, 'alert');
      }
      break;
    case 'para':
      if (h.attached > 0) h.wrap += dt * (0.1 + h.attached * 0.018);
      if (h.wrap >= 1) {
        setState(h, 'cocoon');
        world.onCocoon(h);
      }
      break;
    default:
      break;
  }
}
