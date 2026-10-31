import { SPIDERS } from '../sim/world.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const fmt = (v) => Math.floor(v).toLocaleString('ru-RU');

export class Hud {
  constructor(root, world, { onPrompt, onBuy }) {
    this.world = world;
    this.onPrompt = onPrompt;

    this.objective = el('div', 'objective panel', root);
    this.resBar = el('div', 'res panel', root);
    this.silk = this.stat('silk', 'Шёлк');
    this.soki = this.stat('soki', 'Соки');
    this.swarm = this.stat('swarm', 'Рой');
    this.pop = this.stat('pop', 'Дом');

    this.swarmBar = el('div', 'swarm', root);
    this.units = ['ling', 'weaver'].map((kind) => {
      const def = SPIDERS[kind];
      const b = el('button', 'unit', this.swarmBar);
      el('i', '', b, def.key);
      el('b', '', b, def.name);
      el('em', '', b, def.desc);
      el('span', '', b, `${def.cost} соков`);
      b.addEventListener('click', () => onBuy(kind));
      return { b, def };
    });

    this.radio = el('div', 'radio', root);
    this.sayEl = el('div', 'say', root);
    this.bigEl = el('div', 'big', root);
    this.promptEl = el('button', 'prompt', root);
    this.promptEl.addEventListener('click', onPrompt);
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

  setPrompt(p) {
    this.promptEl.classList.toggle('on', !!p);
    if (p) this.promptEl.innerHTML = `${p.label}<small>пробел</small>`;
  }

  setFlags(f) {
    this.resBar.classList.toggle('on', f.resources);
    this.swarmBar.classList.toggle('on', f.swarmBar);
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
    this.swarm.textContent = fmt(w.swarmCount());
    this.pop.textContent = `${w.level.population} чел.`;
    for (const u of this.units) u.b.disabled = w.res.soki < u.def.cost;
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
