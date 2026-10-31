import * as THREE from 'three';
import { NEST_COST, SPIDERS } from '../sim/world.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const fmt = (v) => Math.floor(v).toLocaleString('ru-RU');
const V = new THREE.Vector3();

export class Hud {
  constructor(root, world, stage) {
    this.world = world;
    this.stage = stage;
    this.handlers = {};

    this.objective = el('div', 'objective panel', root);
    this.resBar = el('div', 'res panel', root);
    this.silk = this.stat('silk', 'Шёлк');
    this.soki = this.stat('soki', 'Соки');
    this.swarm = this.stat('swarm', 'Рой');
    this.pop = this.stat('pop', 'Люди');

    this.command = el('div', 'command', root);
    this.units = el('div', 'train panel', this.command);
    this.trainButtons = ['ling', 'weaver'].map((kind) => {
      const def = SPIDERS[kind];
      const b = el('button', 'unit', this.units);
      el('i', '', b, def.key);
      el('b', '', b, def.name);
      el('em', '', b, def.desc);
      el('span', '', b, `${def.cost} соков, ${def.supply} места`);
      b.addEventListener('click', () => this.handlers.action?.(kind));
      return { b, def };
    });
    this.queue = el('div', 'queue', this.units);

    this.card = el('div', 'card panel', this.command);
    this.selInfo = el('div', 'sel', this.card, 'Никто не выбран');
    this.cmdRow = el('div', 'cmds', this.card);
    this.cmds = [
      ['amove', 'Атака', 'Q', 'Идти и кусать всех по пути'],
      ['stop', 'Стоп', 'E', 'Остановиться'],
      ['hide', 'Затаиться', 'R', 'Замереть: люди не заметят издали'],
      ['nest', 'Гнездо', 'B', `Только Мать. ${NEST_COST} шёлка, +12 мест роя`],
    ].map(([id, label, key, title]) => {
      const b = el('button', 'cmd', this.cmdRow);
      b.title = title;
      b.innerHTML = `${label}<i>${key}</i>`;
      b.addEventListener('click', () => this.handlers.action?.(id));
      return { id, b };
    });

    this.radio = el('div', 'radio', root);
    this.sayEl = el('div', 'say', root);
    this.bigEl = el('div', 'big', root);
    this.noticeEl = el('div', 'notice', root);
    this.promptEl = el('button', 'prompt', root);
    this.promptEl.addEventListener('click', () => this.handlers.prompt?.());
    this.boxEl = el('div', 'box', root);
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
    this.command.classList.toggle('on', f.resources);
    this.units.classList.toggle('on', f.swarmBar);
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

  setSelection(list, mode) {
    const by = {};
    for (const s of list) by[s.kind] = (by[s.kind] ?? 0) + 1;
    const names = Object.entries(by).map(([k, n]) => `${SPIDERS[k].name} ${k === 'hero' ? '' : '×' + n}`.trim());
    this.selInfo.textContent = list.length ? names.join(', ') : 'Выдели пауков рамкой';
    const hasHero = !!by.hero;
    for (const c of this.cmds) {
      c.b.disabled = !list.length || (c.id === 'nest' && !hasHero);
      c.b.classList.toggle('armed', c.id === mode);
    }
    const hint = { amove: 'Клик по полу: идти и кусать всех по пути', nest: 'Клик по полу: место для гнезда' }[mode];
    if (hint) this.notice(hint);
    document.body.classList.toggle('aiming', !!mode);
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
    this.silk.textContent = fmt(w.res.silk);
    this.soki.textContent = fmt(w.res.soki);
    this.swarm.textContent = `${w.supplyUsed()} / ${w.supplyCap()}`;
    this.pop.textContent = `${w.level.population}`;
    for (const u of this.trainButtons) u.b.disabled = w.res.soki < u.def.cost;

    let q = 0;
    let head = null;
    for (const n of w.nests) {
      q += n.queue.length;
      if (!head && n.queue[0]) head = n.queue[0];
    }
    this.queue.textContent = head ? `В кладке: ${q}, следующий через ${Math.ceil(head.left)} с` : '';

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
