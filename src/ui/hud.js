import * as THREE from 'three';
import { UPGRADES, upgradeCost } from '../content/upgrades.js';
import { SPIDERS } from '../sim/world.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const fmt = (v) => Math.floor(v).toLocaleString('ru-RU');
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const V = new THREE.Vector3();

const legs = [[-8, -6], [-9, -1], [-9, 3], [-7, 8], [8, -6], [9, -1], [9, 3], [7, 8]]
  .map(([x, y]) => `<path d="M0 0 L${x * 0.62} ${y * 0.5 - 3} L${x} ${y}"/>`)
  .join('');

const icon = (kind) => `
  <svg viewBox="-11 -11 22 22" class="ico ${kind}">
    <g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">${legs}</g>
    <ellipse cx="0" cy="3.4" rx="3.8" ry="4.6" fill="currentColor"/>
    <circle cx="0" cy="-3.2" r="2.4" fill="currentColor"/>
    ${kind === 'fighter' ? '<circle cx="0" cy="3.4" r="1.5" fill="#e0342a"/>' : ''}
  </svg>`;

export class Hud {
  constructor(root, world, stage) {
    this.world = world;
    this.stage = stage;
    this.root = root;
    this.handlers = {};

    this.objective = el('div', 'objective panel', root);
    this.resBar = el('div', 'res panel', root);
    this.soki = this.stat('soki', 'Соки');
    this.swarm = this.stat('swarm', 'Рой');
    this.pop = this.stat('pop', 'Люди');

    this.watch = el('div', 'watch panel', root);
    const row = el('div', '', this.watch);
    el('span', '', row, 'Подозрение');
    this.timer = el('b', '', row);
    this.meter = el('i', '', el('section', 'meter', this.watch));

    this.nestPanel = el('div', 'nestp panel', root);
    el('h3', '', this.nestPanel, 'ГНЕЗДО');
    this.ups = UPGRADES.map((u) => {
      const b = el('button', 'up', this.nestPanel);
      b.innerHTML = `<s></s><b>${u.name}</b><em>${u.desc}</em>`;
      b.addEventListener('click', () => this.handlers.upgrade?.(u.id));
      return { u, b, price: b.querySelector('s'), title: b.querySelector('b') };
    });

    this.dock = el('div', 'dock', root);
    this.units = ['carrier', 'fighter'].map((kind) => {
      const def = SPIDERS[kind];
      const b = el('button', 'unit', this.dock);
      b.title = def.desc;
      b.innerHTML = `${icon(kind)}<span><b>${def.name} <span></span></b><em></em></span><u></u>`;
      b.addEventListener('click', () => this.handlers.train?.(kind));
      return { b, kind, def, cost: b.querySelector('em'), have: b.querySelector('b span'), bar: b.querySelector('u') };
    });
    this.attackBtn = el('button', 'attack', this.dock);
    this.attackBtn.addEventListener('click', () => this.handlers.attack?.());

    this.radio = el('div', 'radio', root);
    this.sayEl = el('div', 'say', root);
    this.bigEl = el('div', 'big', root);
    this.noticeEl = el('div', 'notice', root);
    this.promptEl = el('button', 'prompt', root);
    this.promptEl.addEventListener('click', () => this.handlers.prompt?.());
    this.bars = world.humans.map((h) => {
      const bar = el('div', 'hbar', root);
      el('span', '', bar, h.name);
      return { h, bar, fill: el('i', '', bar) };
    });
    this.flashEl = el('div', 'flash', root);
    this.fadeEl = el('div', 'fade', root);

    const bus = world.bus;
    bus.on('objective', (t) => this.setObjective(t));
    bus.on('say', (e) => this.say(e));
    bus.on('prompt', (p) => this.setPrompt(p));
    bus.on('flags', (f) => this.setFlags(f));
    bus.on('radio', (m) => this.addRadio(m));
    bus.on('flash', (o) => this.flash(o));
    bus.on('fade', (f) => this.fade(f));
    bus.on('notice', (t) => this.notice(t));
    bus.on('deposit', (d) => this.float(d));
  }

  stat(cls, label) {
    const box = el('div', cls, this.resBar);
    el('span', '', box, label);
    return el('b', '', box, '0');
  }

  showError(text) {
    if (text) this.notice(text);
  }

  setObjective(text) {
    if (text) this.objective.innerHTML = `<small>ЦЕЛЬ</small>${text}`;
    this.objective.classList.toggle('on', !!text);
  }

  say({ text, big, ms = 3000 }) {
    const node = big ? this.bigEl : this.sayEl;
    node.textContent = text;
    node.classList.add('on');
    clearTimeout(node._t);
    node._t = setTimeout(() => node.classList.remove('on'), ms);
  }

  notice(text) {
    this.noticeEl.textContent = text;
    this.noticeEl.classList.add('on');
    clearTimeout(this.noticeEl._t);
    this.noticeEl._t = setTimeout(() => this.noticeEl.classList.remove('on'), 2200);
  }

  setPrompt(p) {
    this.promptEl.classList.toggle('on', !!p);
    if (p) this.promptEl.innerHTML = `${p.label}<small>пробел</small>`;
  }

  setFlags(f) {
    this.resBar.classList.toggle('on', f.resources);
    this.watch.classList.toggle('on', f.swarmBar);
    this.nestPanel.classList.toggle('on', f.swarmBar);
    this.dock.classList.toggle('on', f.swarmBar);
  }

  // Цифра над гнездом при каждой доставке: видно, как капает доход.
  float({ x, z, v }) {
    V.set(x, 0.2, z).project(this.stage.camera);
    const e = el('div', 'float', this.root, `+${v}`);
    e.style.left = `${(V.x + 1) * 0.5 * innerWidth}px`;
    e.style.top = `${(1 - V.y) * 0.5 * innerHeight}px`;
    setTimeout(() => e.remove(), 1000);
  }

  addRadio({ who, text }) {
    const p = el('p', '', this.radio);
    p.innerHTML = `<b>${who}</b>`;
    p.append(text);
    while (this.radio.children.length > 4) this.radio.firstChild.remove();
    setTimeout(() => {
      p.style.opacity = 0;
      setTimeout(() => p.remove(), 1000);
    }, 9000);
  }

  flash({ dim } = {}) {
    this.flashEl.getAnimations().forEach((a) => a.cancel());
    this.flashEl.animate([{ opacity: dim ? 0.22 : 0.8 }, { opacity: 0 }], { duration: dim ? 300 : 650, easing: 'ease-out' });
  }

  fade({ hold = 1500, text = '' }) {
    this.fadeEl.textContent = text;
    this.fadeEl.classList.add('on');
    setTimeout(() => this.fadeEl.classList.remove('on'), hold);
  }

  update() {
    const w = this.world;
    this.soki.textContent = `${fmt(w.res.soki)}  +${w.income.toFixed(1)}/с`;
    this.swarm.textContent = `${w.supplyUsed()} / ${w.supplyCap()}`;
    this.pop.textContent = `${w.level.population}`;
    this.meter.style.width = `${w.suspicion}%`;
    this.timer.textContent = w.assaultOn ? 'Идёт нападение' : w.quietLeft ? `До нападения ${clock(w.quietLeft)}` : '';

    const room = w.supplyUsed() < w.supplyCap();
    const nest = w.nests[0];
    for (const u of this.units) {
      const cost = w.unitCost(u.kind);
      u.cost.textContent = `${cost} соков`;
      u.have.textContent = `×${w.count(u.kind)}`;
      u.b.disabled = w.res.soki < cost || !room;
      const q = nest?.queue[0];
      u.bar.style.width = q?.kind === u.kind ? `${(1 - q.left / q.total) * 100}%` : '0';
    }
    for (const x of this.ups) {
      const level = w.levels[x.u.id] ?? 0;
      const full = level >= x.u.max;
      const cost = full ? 0 : upgradeCost(x.u, level);
      x.price.textContent = full ? 'макс' : `${cost}`;
      x.title.textContent = `${x.u.name} ${level}/${x.u.max}`;
      x.b.disabled = full || w.res.soki < cost;
      x.b.classList.toggle('can', !full && w.res.soki >= cost);
    }
    const fighters = w.count('fighter');
    this.attackBtn.disabled = !!w.assaultOn || fighters < 3;
    this.attackBtn.innerHTML = `НАПАСТЬ<small>${w.assaultOn ? 'рой в бою' : fighters < 3 ? 'нужно 3 бойца' : `сила роя ${w.strength()}`}</small>`;

    // Полоски яда над людьми: видно, сколько осталось до паралича.
    const cam = this.stage.camera;
    for (const { h, bar, fill } of this.bars) {
      const fighting = h.venom > 0.01 && h.fade > 0.4 && !['cocoon', 'gone', 'still'].includes(h.state);
      bar.classList.toggle('on', fighting);
      if (!fighting) continue;
      const lying = h.lie > 0.5;
      V.set(h.x, lying ? 0.95 : h.height + 0.2, lying ? h.z - h.height * 0.5 : h.z).project(cam);
      bar.style.left = `${(V.x + 1) * 0.5 * innerWidth}px`;
      bar.style.top = `${(1 - V.y) * 0.5 * innerHeight}px`;
      fill.style.width = `${Math.min(100, (h.venom / h.venomMax) * 100)}%`;
    }
  }
}

export function showTitle(root, onStart, instant) {
  if (instant) {
    onStart();
    return;
  }
  const t = el('div', 'title', root);
  el('h1', '', t, 'РУКА ЦЕЛА');
  el('p', '', t, 'Паук против человека');
  const btn = el('button', '', t, 'Начать');
  el('small', '', t, 'В игре есть пауки, мерцание света и насилие. Лучше играть в наушниках и в темноте.');
  btn.addEventListener('click', () => {
    t.innerHTML = '';
    const a = el('div', 'line', t, 'Ташкент, 02:14.');
    const b = el('div', 'line', t, 'Ночью каракурт чуть не укусил человека за руку.');
    requestAnimationFrame(() => a.classList.add('on'));
    setTimeout(() => b.classList.add('on'), 1400);
    setTimeout(() => {
      t.style.opacity = 0;
      onStart();
    }, 4200);
    setTimeout(() => t.remove(), 5500);
  });
}
