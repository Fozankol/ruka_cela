import * as THREE from 'three';
import { icon } from './icons.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const V = new THREE.Vector3();
const ACTION_ICONS = { Рабочий: 'spider', Грызун: 'fang', Вдова: 'widow', Боец: 'sword', Гнездо: 'nest' };

export class Hud {
  constructor(root, world, stage) {
    this.world = world;
    this.stage = stage;
    this.root = root;
    this.handlers = {};

    this.objective = el('div', 'objective', root);
    this.meters = el('div', 'meters panel', root);
    this.foodVal = this.meter('Еда', 'food', 'food');
    this.alertVal = this.meter('Тревога', 'alert', 'alert');
    this.goalVal = this.meter('', 'goal', 'house');
    this.goalName = this.goalVal.name;
    this.silkVal = this.meter('Шёлк', 'silk', 'web');
    this.alertName = this.alertVal.name;
    this.tags = [];
    this.workers = el('div', 'workers panel', root);
    this.workerText = el('span', '', this.workers);
    this.buyBtn = el('button', 'buy', this.workers);
    this.buyBtn.addEventListener('click', () => this.handlers.buy?.());
    this.extra = [0, 1, 2].map((i) => {
      const b = el('button', 'buy', this.workers);
      b.addEventListener('click', () => this.actions[i]?.run());
      return b;
    });
    this.actions = [];

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

  meter(label, cls, ico) {
    const row = el('div', `gauge ${cls}`, this.meters);
    icon(ico, row);
    const top = el('div', '', row);
    const name = el('span', '', top, label);
    const num = el('b', '', top, '0');
    const bar = el('i', '', el('section', '', row));
    return { row, bar, num, name };
  }

  setObjective(text) {
    const changed = text && text !== this.objectiveText;
    this.objectiveText = text;
    if (text) this.objective.innerHTML = `<small>ЦЕЛЬ</small>${text}`;
    this.objective.classList.toggle('on', !!text);
    if (changed) {
      this.objective.classList.remove('fresh');
      void this.objective.offsetWidth;
      this.objective.classList.add('fresh');
    }
  }

  // Кнопка покупки: значок, название и цена на отдельных строках.
  setAction(b, label) {
    if (b._label === label) return;
    b._label = label;
    const [name, cost] = label.split(': ');
    b.innerHTML = '';
    icon(ACTION_ICONS[name] ?? 'spider', b);
    el('b', '', b, name);
    el('small', '', b, cost ?? '');
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

  // Подписи на карте: дома и их особенности.
  updateTags(list) {
    while (this.tags.length < list.length) this.tags.push(el('div', 'maptag', this.root));
    this.tags.forEach((e, i) => {
      const t = list[i];
      e.style.display = t ? '' : 'none';
      if (!t) return;
      V.set(t.x, t.y ?? 0, t.z).project(this.stage.camera);
      e.style.left = `${(V.x + 1) * 0.5 * innerWidth}px`;
      e.style.top = `${(1 - V.y) * 0.5 * innerHeight}px`;
      const html = `<b>${t.text}</b>${t.sub ? `<span>${t.sub}</span>` : ''}${t.note ? `<em>${t.note}</em>` : ''}`;
      if (e._html !== html) {
        e._html = html;
        e.innerHTML = html;
      }
      e.classList.toggle('mine', t.cls === 'mine');
    });
  }

  update() {
    const w = this.world;
    const goal = w.rules.goal;
    const m = w.script?.meter?.();
    this.foodVal.row.classList.toggle('plain', !!m);
    this.foodVal.bar.style.width = m ? '0' : `${(w.food / goal) * 100}%`;
    this.foodVal.num.textContent = m ? `${Math.floor(w.food)}` : `${Math.floor(w.food)} / ${goal}`;
    this.goalVal.row.style.display = m ? '' : 'none';
    if (m) {
      this.goalName.textContent = m.label;
      this.goalVal.bar.style.width = `${m.share * 100}%`;
      this.goalVal.num.textContent = m.text;
    }
    const paints = !!w.script?.paints;
    this.silkVal.row.style.display = paints ? '' : 'none';
    if (paints) {
      this.silkVal.bar.style.width = `${(w.silk / w.rules.silkMax) * 100}%`;
      this.silkVal.num.textContent = `${Math.floor(w.silk)}`;
    }
    const alertName = w.script?.alertLabel ?? 'Тревога';
    if (this.alertName.textContent !== alertName) this.alertName.textContent = alertName;
    this.updateTags(w.script?.labels?.() ?? []);
    this.actions = w.script?.actions?.() ?? [];
    this.extra.forEach((b, i) => {
      const a = this.actions[i];
      b.style.display = a ? '' : 'none';
      if (!a) return;
      this.setAction(b, a.label);
      b.disabled = !!a.disabled;
    });
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
    this.workers.classList.toggle('alarm', w.alarmOn);
    this.workerText.textContent = w.alarmOn ? (out ? `Кликай по красным меткам: ${out}` : 'Все в укрытиях') : `Свободно ${free} из ${total}`;
    const cost = w.workerCost();
    this.setAction(this.buyBtn, total >= w.rules.workerCap ? 'Рабочий: мест нет' : `Рабочий: ${cost} еды · Z`);
    this.buyBtn.disabled = total >= w.rules.workerCap || w.food < cost;
  }
}
