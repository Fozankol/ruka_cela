import * as THREE from 'three';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const V = new THREE.Vector3();

export class Hud {
  constructor(root, world, stage) {
    this.world = world;
    this.stage = stage;
    this.root = root;
    this.handlers = {};

    this.objective = el('div', 'objective panel', root);
    this.meters = el('div', 'meters panel', root);
    this.foodVal = this.meter('Еда', 'food');
    this.alertVal = this.meter('Тревога', 'alert');
    this.workers = el('div', 'workers panel', root);
    this.workerText = el('span', '', this.workers);
    this.buyBtn = el('button', 'buy', this.workers);
    this.buyBtn.addEventListener('click', () => this.handlers.buy?.());

    this.radio = el('div', 'radio', root);
    this.sayEl = el('div', 'say', root);
    this.bigEl = el('div', 'big', root);
    this.noticeEl = el('div', 'notice', root);
    this.tip = el('div', 'tip', root);
    this.promptEl = el('button', 'prompt', root);
    this.promptEl.addEventListener('click', () => this.handlers.prompt?.());
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

  meter(label, cls) {
    const row = el('div', `gauge ${cls}`, this.meters);
    el('span', '', row, label);
    const bar = el('i', '', el('section', '', row));
    return { row, bar, num: el('b', '', row, '0') };
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
    this.noticeEl._t = setTimeout(() => this.noticeEl.classList.remove('on'), 2000);
  }

  setPrompt(p) {
    this.promptEl.classList.toggle('on', !!p);
    if (p) this.promptEl.innerHTML = `${p.label}<small>пробел</small>`;
  }

  setFlags(f) {
    this.meters.classList.toggle('on', f.resources);
    this.workers.classList.toggle('on', f.resources);
  }

  setTip(it, x, y) {
    const t = this.tip;
    t.classList.toggle('on', !!it);
    if (!it) return;
    if (t.textContent !== it.label) t.textContent = it.label;
    t.style.left = `${x + 16}px`;
    t.style.top = `${y + 14}px`;
  }

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
    while (this.radio.children.length > 3) this.radio.firstChild.remove();
    setTimeout(() => {
      p.style.opacity = 0;
      setTimeout(() => p.remove(), 1000);
    }, 6000);
  }

  flash({ dim } = {}) {
    if (this.lessFlicker) return;
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
    const goal = w.rules.goal;
    this.foodVal.bar.style.width = `${(w.food / goal) * 100}%`;
    this.foodVal.num.textContent = `${Math.floor(w.food)} / ${goal}`;
    this.alertVal.bar.style.width = `${w.alert}%`;
    this.alertVal.num.textContent = `${Math.floor(w.alert)}`;
    this.alertVal.row.classList.toggle('hot', w.alert >= 75 || w.alarmOn);
    let total = 0;
    let free = 0;
    for (const s of w.spiders) {
      if (s.kind !== 'carrier') continue;
      total++;
      if (!s.order && !s.hidden && s.load === 0) free++;
    }
    const out = w.alarmOn ? w.exposedMarks().length : 0;
    this.workerText.textContent = w.alarmOn ? (out ? `Кликай по красным меткам! Снять рабочих: ${out}` : 'Все в укрытиях') : `Свободно рабочих: ${free} из ${total}`;
    const cost = w.workerCost();
    this.buyBtn.textContent = total >= w.rules.workerCap ? 'Гнездо полное' : `Вывести рабочего: ${cost} еды (Z)`;
    this.buyBtn.disabled = total >= w.rules.workerCap || w.food < cost;
  }
}
