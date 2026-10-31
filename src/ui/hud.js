import * as THREE from 'three';
import { SPIDERS } from '../sim/world.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const fmt = (v) => Math.floor(v).toLocaleString('ru-RU');
const V = new THREE.Vector3();

const legs = [[-8, -6], [-9, -1], [-9, 3], [-7, 8], [8, -6], [9, -1], [9, 3], [7, 8]]
  .map(([x, y]) => `<path d="M0 0 L${x * 0.62} ${y * 0.5 - 3} L${x} ${y}"/>`)
  .join('');

// Значок паука для панели. Цвет совпадает с пауком в игре.
const icon = (kind) => `
  <svg viewBox="-11 -11 22 22" class="ico ${kind}">
    <g fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round">${legs}</g>
    <ellipse cx="0" cy="3.4" rx="${kind === 'hero' ? 5 : 3.8}" ry="${kind === 'hero' ? 6 : 4.6}" fill="currentColor"/>
    <circle cx="0" cy="-3.2" r="2.4" fill="currentColor"/>
    ${kind === 'carrier' ? '' : '<circle cx="0" cy="3.4" r="1.5" fill="#e0342a"/>'}
  </svg>`;

export class Hud {
  constructor(root, world, stage) {
    this.world = world;
    this.stage = stage;
    this.handlers = {};
    this.sel = new Set();

    this.objective = el('div', 'objective panel', root);
    this.resBar = el('div', 'res panel', root);
    this.soki = this.stat('soki', 'Соки');
    this.swarm = this.stat('swarm', 'Рой');
    this.pop = this.stat('pop', 'Люди');

    this.dock = el('div', 'dock', root);
    this.groups = el('div', 'groups panel', this.dock);
    this.fighters = this.groupButton('Бойцы', '1', 'fighters', 'fighter');
    this.carriers = this.groupButton('Носильщики', '2', 'carriers', 'carrier');
    this.home = this.groupButton('Домой', 'H', 'home');

    this.roster = el('div', 'roster panel', this.dock);
    this.tiles = [];
    this.rosterKey = '';

    this.train = el('div', 'train panel', this.dock);
    this.trainButtons = ['fighter', 'carrier'].map((kind, i) => {
      const def = SPIDERS[kind];
      const b = el('button', 'unit', this.train);
      b.title = def.desc;
      b.innerHTML = `${icon(kind)}<span><b>${def.name}</b><em>${def.cost} соков</em></span><i>${i ? 'X' : 'Z'}</i><u></u>`;
      b.addEventListener('click', () => this.handlers.action?.(kind));
      return { b, def, kind, bar: b.querySelector('u') };
    });

    this.radio = el('div', 'radio', root);
    this.sayEl = el('div', 'say', root);
    this.bigEl = el('div', 'big', root);
    this.noticeEl = el('div', 'notice', root);
    this.promptEl = el('button', 'prompt', root);
    this.promptEl.addEventListener('click', () => this.handlers.prompt?.());
    this.boxEl = el('div', 'box', root);
    this.tip = el('div', 'tip', root);
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
  }

  stat(cls, label) {
    const box = el('div', cls, this.resBar);
    el('span', '', box, label);
    return el('b', '', box, '0');
  }

  groupButton(label, key, action, kind) {
    const b = el('button', 'group', this.groups);
    b.innerHTML = `${kind ? icon(kind) : ''}<span>${label}</span><i>${key}</i>`;
    b.addEventListener('click', () => this.handlers.action?.(action));
    return b;
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
    this.noticeEl._t = setTimeout(() => this.noticeEl.classList.remove('on'), 1800);
  }

  setPrompt(p) {
    this.promptEl.classList.toggle('on', !!p);
    if (p) this.promptEl.innerHTML = `${p.label}<small>пробел</small>`;
  }

  setFlags(f) {
    this.resBar.classList.toggle('on', f.resources);
    this.dock.classList.toggle('on', f.resources);
    this.train.classList.toggle('on', f.swarmBar);
  }

  setBox(x0, y0, x1, y1) {
    const b = this.boxEl;
    if (x0 === null) {
      b.style.display = 'none';
      return;
    }
    b.style.display = 'block';
    b.style.left = `${Math.min(x0, x1)}px`;
    b.style.top = `${Math.min(y0, y1)}px`;
    b.style.width = `${Math.abs(x1 - x0)}px`;
    b.style.height = `${Math.abs(y1 - y0)}px`;
  }

  setSelection(sel) {
    this.sel = sel;
  }

  // Подсказка у курсора: что случится при клике.
  setTip(it, x, y) {
    const t = this.tip;
    t.classList.toggle('on', !!it);
    document.body.classList.toggle('aiming', it?.type === 'attack' || it?.type === 'gnaw');
    if (!it) return;
    if (t.textContent !== it.label) t.textContent = it.label;
    t.classList.toggle('danger', !!it.danger);
    t.style.left = `${x + 16}px`;
    t.style.top = `${y + 14}px`;
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

  // Портреты пересобираются только когда меняется состав роя.
  updateRoster() {
    const w = this.world;
    const order = { hero: 0, fighter: 1, carrier: 2 };
    const list = [...w.spiders].sort((a, b) => order[a.kind] - order[b.kind] || a.id - b.id);
    const key = list.map((s) => s.id).join();
    if (key !== this.rosterKey) {
      this.rosterKey = key;
      this.roster.innerHTML = '';
      this.tiles = list.map((s) => {
        const b = el('button', `tile ${s.kind}`, this.roster);
        b.innerHTML = `${icon(s.kind)}<i></i>`;
        b.title = SPIDERS[s.kind].name;
        b.addEventListener('click', (e) => this.handlers.pick?.(s, e.shiftKey));
        return { s, b, hp: b.querySelector('i') };
      });
    }
    for (const { s, b, hp } of this.tiles) {
      const k = s.hp / SPIDERS[s.kind].hp;
      hp.style.width = `${Math.max(0, k) * 100}%`;
      hp.style.background = k > 0.6 ? '#7ddf72' : k > 0.3 ? '#e8c04a' : '#e0342a';
      b.classList.toggle('sel', this.sel.has(s));
      b.classList.toggle('load', s.load > 0);
      b.classList.toggle('work', !!s.on || s.order?.type === 'attack' || s.order?.type === 'gnaw');
    }
  }

  update() {
    const w = this.world;
    this.soki.textContent = fmt(w.res.soki);
    this.swarm.textContent = `${w.supplyUsed()} / ${w.supplyCap()}`;
    this.pop.textContent = `${w.level.population}`;
    this.updateRoster();

    const nest = w.nests[0];
    for (const u of this.trainButtons) {
      u.b.disabled = w.res.soki < u.def.cost || w.supplyUsed() + u.def.supply > w.supplyCap();
      const q = nest?.queue[0];
      u.bar.style.width = q?.kind === u.kind ? `${(1 - q.left / q.total) * 100}%` : '0';
    }
    this.home.disabled = !this.sel.size;

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
