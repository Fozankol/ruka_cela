import { RESOURCES, TERRAIN } from '../content/war/factions.js';
import { FIGURES } from '../content/war/figures.js';
import { FOCUS, focusOpen } from '../content/war/focus.js';
import { BRANCHES, RESEARCH } from '../content/war/research.js';
import { LEGIONS } from '../content/war/units.js';
import { STAGES } from '../sim/war.js';
import { ICONS, icon } from './icons.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const START = new Date(2026, 10, 1).getTime();
// Города живут часами: секунда игры равна часу, мировая война считает дни.
const NIGHTS = (v) => `Ночь ${Math.floor(v / 24) + 1}, ${String(Math.floor(v % 24)).padStart(2, '0')}:00`;
const fmtInt = (v) => Math.floor(v).toLocaleString('ru-RU');
const big = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} млрд` : v >= 1e6 ? `${Math.round(v / 1e6)} млн` : fmtInt(v));
const REFRESH = 12;
const FOCUS_ROW = 68;
// Портреты союзников необязательны: без файла показываем инициалы.
const PORTRAITS = Object.values(import.meta.glob('../content/war/portraits.js', { eager: true }))[0]?.PORTRAITS ?? {};

const MENU = [
  { id: 'focus', label: 'Разум', icon: 'eye', politics: true },
  { id: 'science', label: 'Наука', icon: 'flask' },
  { id: 'brood', label: 'Выводок', icon: 'egg' },
  { id: 'diplo', label: 'Дипломатия', icon: 'knot', politics: true },
  { id: 'allies', label: 'Союзники', icon: 'ally', politics: true },
];

// Интерфейс войны: карта с легионами и панели управления роем.
export class WarHud {
  constructor(root, war, view, bus, ui) {
    this.war = war;
    this.view = view;
    this.ui = ui;
    // Мировая война идёт вдвое спокойнее: на ×1 есть время всё обдумать.
    this.pace = war.map.politics ? 0.75 : 1;
    this.speed = 1;
    this.keep = 1;
    this.instinct = false;
    this.selected = null;
    this.picked = new Set();
    this.subs = [];
    this.tickN = 0;
    this.lesson = 0;
    this.lastStage = 0;
    this.panelId = null;
    this.panelItems = [];
    this.forecasts = new Map();
    this.root = el('div', 'war', root);
    this.buildTop();
    this.buildMenu();
    this.buildMap();
    this.buildDock();

    const on = (n, f) => this.subs.push(bus.on(n, f));
    on('warCapture', (r) => {
      this.say(`${r.name} под шёлком`);
      const res = RESOURCES[r.res];
      if (r.spoil) this.float(r, `+${Math.round(r.spoil)}${res ? `  ${res.name}` : ''}`);
      r.spoil = 0;
      if (this.selected === r) this.renderSide();
    });
    on('warLost', (r) => {
      this.say(`Люди отбили: ${r.name}`);
      this.float(r, 'Потеряно', 'bad');
      if (this.selected === r) this.renderSide();
    });
    on('warPlan', ({ faction, target }) => {
      this.say(`${faction.name} готовит удар: ${target.name}`);
      ui.say({ text: `${faction.name} готовит удар: ${target.name}`, ms: 3200 });
    });
    on('warPocket', (r) => {
      this.say(`Котёл: ${r.name}`);
      this.float(r, 'Котёл');
    });
    on('warGoal', (g) => {
      this.say(`Цель выполнена: +${g.biomass}`);
      ui.say({ text: `Цель выполнена: ${g.text}`, ms: 2600 });
    });
    on('warCounter', (r) => this.say(`Люди атакуют: ${r.name}`));
    on('front', ({ to }) => this.say(`Бой: ${war.byId[to].name}`));
    on('warDeclared', (f) => this.say(`Война: ${f.name}`));
    on('warSurrender', (f) => ui.say({ text: `${f.name} сдаётся`, big: true, ms: 2600 }));
    on('warToast', (t) => this.say(t));
    on('warLegion', (u) => this.say(`Вышел легион: ${u.name}`));
    on('warResearch', (n) => this.say(`Наука: ${n.name}`));
    on('warFocus', (n) => this.say(`Решение роя: ${n.name}`));
    on('warNukeWarn', () => ui.notice('Ядерный удар! Выведи легионы'));
    on('warNuke', ({ region, safe }) => ui.say({ text: `${region.name}: удар. ${safe ? 'Легионы успели уйти' : 'Потери огромны'}`, ms: 3000 }));
    on('warDawn', () => ui.say({ text: 'Рассвет. Люди отбили границу, дух роя упал.', big: true, ms: 2600 }));
    on('warQuarantine', () => {
      ui.say({ text: 'КАРАНТИН', big: true, ms: 2600 });
      ui.setObjective('Мосты закрыты кордоном. Кликни по району за рекой и нажми «Блэкаут: снять кордон».');
      bus.emit('radio', { who: 'Диспетчер', text: 'Мосты закрыты. На том берегу пока есть свет.' });
    });
    on('warCard', (c) => this.showCard(c));

    this.onKey = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePause();
      }
      if (e.code === 'Escape') this.clearPicks();
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (n >= 0) this.setSpeed([1, 2, 4, 8][n]);
    };
    window.addEventListener('keydown', this.onKey);
    view.onRegion = (r) => this.clickRegion(r);
    view.onHover = (r, e) => this.hoverRegion(r, e);
    view.onRight = () => this.clearPicks();
    this.setSpeed(war.map.politics ? 2 : 1);
    this.updateMenu();
    this.updateDock();
    this.updateLessons();
  }

  buildTop() {
    const w = this.war;
    this.top = el('div', 'wtop', this.root);
    const clock = el('div', 'wclock', this.top);
    const row = el('div', 'wspeeds', clock);
    this.speeds = [0, 1, 2, 4, 8].map((s) => {
      const b = el('button', 'wspeed', row, s ? `×${s}` : undefined);
      if (!s) b.innerHTML = ICONS.pause;
      b.title = s ? 'Клавиши 1–4' : 'Пробел';
      b.addEventListener('click', () => this.setSpeed(s));
      return { s, b };
    });
    this.date = el('b', 'wdate', clock);
    const stats = el('div', 'wstats', this.top);
    this.people = this.stat(stats, w.map.peopleLabel, 'people');
    this.bio = this.stat(stats, 'Биомасса', 'drop');
    this.inf = w.map.politics ? this.stat(stats, 'Влияние', 'signal') : null;
    this.army = this.stat(stats, 'Легионы', 'spider');
    const meters = el('div', 'wmeters', this.top);
    this.stageBar = this.meter(meters, 'stage');
    if (w.map.dawn) this.dawnBar = this.meter(meters, 'dawn', 'Проект «Рассвет»');
  }

  stat(parent, label, ico) {
    const d = el('div', 'wstat', parent);
    icon(ico, d);
    const t = el('div', '', d);
    el('span', '', t, label);
    const row = el('div', '', t);
    return { v: el('b', '', row, '0'), delta: el('em', '', row) };
  }

  meter(parent, cls, label) {
    const d = el('div', `wmeter ${cls}`, parent);
    const name = el('span', '', d, label ?? '');
    const fill = el('i', '', el('section', '', d));
    return { name, fill };
  }

  buildMenu() {
    const w = this.war;
    const box = el('div', 'wmenu', this.root);
    this.menu = MENU.filter((m) => w.map.politics || !m.politics).map((m) => {
      const b = el('button', 'wtab', box);
      icon(m.icon, b);
      el('b', '', b, m.label);
      const note = el('small', '', b);
      b.addEventListener('click', () => this.openPanel(this.panelId === m.id ? null : m.id));
      return { ...m, b, note };
    });
    this.autoBtn = el('button', 'wtab', box);
    icon('eight', this.autoBtn);
    el('b', '', this.autoBtn, 'Инстинкт');
    el('small', '', this.autoBtn, 'рой играет сам');
    this.autoBtn.addEventListener('click', () => this.setInstinct(!this.instinct));
    this.panel = el('div', 'wpanel panel', this.root);
    this.panel.style.display = 'none';
  }

  buildMap() {
    const w = this.war;
    this.pins = w.regions.map((r) => ({ r, b: el('div', 'chip', this.root) }));
    this.counters = new Map();
    this.nameTip = el('div', 'wname', this.root);
    const right = el('div', 'wright', this.root);
    this.goalBox = el('div', 'wgoals', right);
    this.log = el('div', 'wlog', right);
    this.loot = new Map();
    this.side = el('div', 'wside panel', this.root);
    this.side.style.display = 'none';
    this.nukeBtn = el('button', 'wnuke', this.root, 'ВЫВЕСТИ ЛЕГИОНЫ');
    this.nukeBtn.addEventListener('click', () => w.evacuate());
    this.veil = el('div', 'wveil', this.root);
    this.cardEl = el('div', 'wcard panel', this.root);
    this.cardEl.style.display = 'none';
  }

  dockBtn(ico, label, fn) {
    const b = el('button', 'wbtn', this.dock);
    icon(ico, b);
    const text = el('span', '', b, label);
    b.addEventListener('click', fn);
    b.text = text;
    return b;
  }

  buildDock() {
    const w = this.war;
    this.dock = el('div', 'wdock panel', this.root);
    this.sel = el('div', 'wsel none', this.dock);
    this.selMark = el('span', 'mark', this.sel);
    const box = el('div', '', this.sel);
    this.selName = el('b', '', box);
    this.selNote = el('em', '', box);
    const bars = el('div', 'twobars', box);
    this.selStr = el('i', '', el('u', '', bars));
    this.selOrg = el('i', '', el('u', '', bars));
    this.allBtn = this.dockBtn('all', 'Все', () => {
      this.picked = new Set(w.legions().map((u) => u.id));
      this.closeSide();
      this.updateDock();
    });
    this.allBtn.title = 'Выбрать все легионы';
    this.stopBtn = this.dockBtn('stop', 'Стоп', () => {
      for (const u of this.pickedUnits()) {
        w.stop(u);
        w.setAuto(u, false);
      }
    });
    this.selfBtn = this.dockBtn('forward', 'Сами вперёд', () => {
      const list = this.pickedUnits();
      const on = !list.every((u) => u.auto);
      for (const u of list) w.setAuto(u, on);
      this.updateDock();
    });
    this.selfBtn.title = 'Легионы сами бьют самого слабого соседа и отдыхают';
    this.stormBtn = this.dockBtn('fang', 'Натиск', () => this.setStance('storm'));
    this.stormBtn.title = 'Легион бьёт на 40% сильнее, но теряет дух на 70% быстрее';
    this.careBtn = this.dockBtn('shield', 'Беречь', () => this.setStance('care'));
    this.careBtn.title = 'Легион бьёт на 35% слабее, зато теряет дух вдвое медленнее';
    this.blackBtn = this.dockBtn('bolt', 'Блэкаут', () => {
      if (!this.selected) return this.ui.notice('Сначала кликни по региону людей');
      this.report(w.blackout(this.selected.id));
      return null;
    });
    this.blackBtn.title = 'Гасит выбранный регион людей: оборона падает на 30%';
  }

  setStance(kind) {
    const list = this.pickedUnits();
    const on = !list.every((u) => u.stance === kind);
    for (const u of list) u.stance = on ? kind : 'normal';
    this.updateDock();
  }

  // Короткая подпись над регионом: что сейчас случилось.
  float(r, text, cls = '') {
    const p = this.view.screen(r);
    if (!p.visible) return;
    const e = el('div', `wfloat ${cls}`, this.root, text);
    e.style.left = `${p.x}px`;
    e.style.top = `${p.y - 30}px`;
    setTimeout(() => e.remove(), 1800);
  }

  // Сводка с фронта: коротко и с датой.
  say(text) {
    const d = this.war.map.end ? NIGHTS(this.war.day).slice(-5) : new Date(START + this.war.day * 864e5).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    if (this.lastLine === text) return;
    this.lastLine = text;
    const line = el('p', '', this.log);
    line.innerHTML = `<b>${d}</b>`;
    line.append(text);
    while (this.log.children.length > 6) this.log.firstChild.remove();
  }

  report(err) {
    if (err) this.ui.notice(err);
  }

  pickedUnits() {
    return this.war.legions().filter((u) => this.picked.has(u.id));
  }

  clearPicks() {
    this.picked.clear();
    this.closeSide();
    this.openPanel(null);
    this.updateDock();
  }

  closeSide() {
    this.selected = null;
    this.side.style.display = 'none';
  }

  setSpeed(s) {
    this.speed = s;
    if (s) this.keep = s;
    for (const x of this.speeds) x.b.classList.toggle('on', x.s === s);
  }

  togglePause() {
    this.setSpeed(this.speed ? 0 : this.keep);
  }

  setInstinct(on) {
    this.instinct = on;
    this.autoBtn.classList.toggle('on', on);
    this.war.instinct = on;
    if (!on) for (const u of this.war.legions()) u.auto = false;
  }

  hoverRegion(r, e) {
    const t = this.nameTip;
    t.style.display = r ? 'block' : 'none';
    if (!r) return;
    const w = this.war;
    const f = w.factionById[r.faction];
    const go = this.picked.size ? (r.owner === 'swarm' ? ': идти сюда' : ': атаковать') : '';
    t.textContent = `${r.name}${f && r.owner !== 'swarm' ? ` · ${f.name}` : ''}${go}`;
    const res = RESOURCES[r.res];
    if (res) el('small', '', t, `${res.name}: ${res.text}`);
    if (r.pocket) el('small', 'good', t, 'Котёл: армии слабеют и сдаются');
    const plan = w.factions.find((x) => x.plan?.target === r.id);
    if (plan) el('small', 'bad', t, `Сюда бьёт ${plan.name}. Легион на месте окопается`);
    const list = this.pickedUnits();
    if (list.length && r.owner !== 'swarm' && !w.isPact(r) && !r.sealed) {
      const fc = w.forecast(list, r);
      el('small', fc.cls, t, `Около ${fc.days} дн., духа уйдёт ${fc.loss}: ${fc.text}`);
    }
    t.style.left = `${e.clientX + 14}px`;
    t.style.top = `${e.clientY + 12}px`;
  }

  // Клик по карте: приказ выбранным легионам, а без выбора сведения о регионе.
  clickRegion(r) {
    const w = this.war;
    if (this.picked.size) {
      const f = this.peaceOnPath(r);
      if (f && w.map.politics) this.askWar(f, r);
      else this.sendPicked(r);
      return;
    }
    this.selected = r;
    this.renderSide();
  }

  sendPicked(r) {
    let err = null;
    let ok = 0;
    for (const u of this.pickedUnits()) {
      const e = this.war.order(u, r.id);
      if (e) err = e;
      else {
        u.auto = false;
        ok++;
      }
    }
    if (!ok) this.report(err);
  }

  // Блок, с которым рой ещё не воюет, но идёт через его землю.
  peaceOnPath(r) {
    const w = this.war;
    for (const u of this.pickedUnits()) {
      for (const id of w.findPath(u.moveT > 0 ? u.moveTo : u.region, r.id) ?? []) {
        const f = w.factionById[w.byId[id].owner];
        if (f && !f.war && !f.surrendered && f.pactT <= 0) return f;
      }
    }
    return null;
  }

  // Новая война это решение, а не случайный клик.
  askWar(f, r) {
    const w = this.war;
    const own = f.regions.filter((id) => w.byId[id].owner === f.id).map((id) => w.byId[id]);
    const res = [...new Set(own.map((x) => RESOURCES[x.res]?.name).filter(Boolean))];
    this.showCard({
      kind: 'war',
      role: 'РЕШЕНИЕ РОЯ',
      title: `Война: ${f.name}`,
      text: f.text,
      perk: `Регионов ${own.length}, столица: ${w.byId[f.capital].name}.${res.length ? ` Там есть: ${res.join(', ').toLowerCase()}.` : ''} Тревога мира вырастет, блок начнёт собирать армии.`,
      options: [
        { label: 'Напасть', fn: () => this.sendPicked(r) },
        { label: 'Подождать', fn: () => {} },
      ],
    });
  }

  renderSide() {
    const r = this.selected;
    const w = this.war;
    this.side.style.display = r ? 'block' : 'none';
    if (!r) return;
    const mine = r.owner === 'swarm';
    this.side.innerHTML = '';
    el('h3', '', this.side, r.name);
    const f = w.factionById[r.faction];
    el('p', 'wsub', this.side, mine ? (r.vassal ? 'Сдавшийся регион' : 'Под шёлком') : `${f?.name ?? ''}${f?.pactT > 0 ? ': пакт' : f?.war ? ': война' : ': не воюет'}`);
    const dl = el('dl', '', this.side);
    const fact = (k, v) => {
      el('dt', '', dl, k);
      return el('dd', '', dl, v);
    };
    const ground = TERRAIN[r.terrain] ?? TERRAIN.plain;
    fact('Местность', `${ground.name}${!mine && ground.def !== 1 ? `, оборона ${ground.def > 1 ? '+' : '−'}${Math.round(Math.abs(ground.def - 1) * 100)}%` : ''}`);
    if (RESOURCES[r.res]) fact(RESOURCES[r.res].name, RESOURCES[r.res].text);
    fact('Население', big(r.people * w.map.peopleK));
    this.sideGarrison = fact('Гарнизон', '');
    this.sideUnits = fact(mine ? 'Легионов' : 'Армий', '');
    this.sideSupply = mine ? fact('Снабжение', '') : null;
    this.updateSide();
    if (mine) {
      const b = el('button', 'wbtn', this.side, r.nest ? 'Гнездо построено' : `Гнездо: ${fmtInt(w.nestCost())}`);
      b.disabled = r.nest;
      b.title = 'Снабжение, лимит легионов, доход';
      b.addEventListener('click', () => {
        this.report(w.buildNest(r.id));
        this.renderSide();
      });
      if (r.nest) {
        const rally = el('button', `wbtn${w.rally === r.id ? ' on' : ''}`, this.side, w.rally === r.id ? 'Легионы выходят здесь' : 'Выводить легионы здесь');
        rally.addEventListener('click', () => {
          w.rally = r.id;
          this.renderSide();
        });
      }
      return;
    }
    const black = el('button', 'wbtn', this.side, r.sealed ? 'Блэкаут: снять кордон' : 'Блэкаут: ослабить');
    black.addEventListener('click', () => {
      this.report(w.blackout(r.id));
      this.renderSide();
    });
    if (w.focusDone.mimic) {
      const swap = el('button', 'wbtn', this.side, 'Подмена: 45 влияния');
      swap.title = 'Регион на границе без армий переходит к рою без боя';
      swap.addEventListener('click', () => {
        this.report(w.replace(r.id));
        this.renderSide();
      });
    }
  }

  updateSide() {
    const r = this.selected;
    const w = this.war;
    if (!r || !this.sideGarrison) return;
    const here = w.unitsAt(r.id);
    const foes = here.filter((u) => u.side !== 'swarm').length;
    this.sideGarrison.textContent = fmtInt(w.garrisonOf(r));
    this.sideUnits.textContent = String(r.owner === 'swarm' ? here.length - foes : foes);
    if (this.sideSupply) this.sideSupply.textContent = w.isSupplied(r.id) ? 'есть' : 'нет';
  }

  // Панели слева: строятся один раз, потом обновляются только значения.
  openPanel(id) {
    this.panelId = id;
    this.panel.style.display = id ? 'flex' : 'none';
    for (const m of this.menu) m.b.classList.toggle('open', m.id === id);
    this.panel.innerHTML = '';
    this.panelItems = [];
    if (!id) return;
    this.panel.className = `wpanel panel p-${id}`;
    this[`panel_${id}`]();
    this.refreshPanel();
  }

  refreshPanel() {
    for (const f of this.panelItems) f();
  }

  head(title, ico, text = '') {
    const h = el('header', 'phead', this.panel);
    icon(ico, h);
    const box = el('div', '', h);
    el('h3', '', box, title);
    const note = el('p', '', box, text);
    const x = el('button', 'pclose', h);
    x.innerHTML = ICONS.close;
    x.addEventListener('click', () => this.openPanel(null));
    return note;
  }

  body() {
    return el('div', 'pbody', this.panel);
  }

  // Подробности узла показываются внизу, а сами узлы остаются короткими.
  infoBar(hint) {
    const box = el('div', 'pinfo', this.panel, hint);
    return (name, text, extra) => {
      box.innerHTML = '';
      el('b', '', box, name);
      box.append(text);
      if (extra) el('em', '', box, extra);
    };
  }

  panel_focus() {
    const w = this.war;
    this.head('Путь разума', 'eye', 'Рой думает над одним решением за раз. Три доктрины исключают друг друга.');
    const body = this.body();
    const show = this.infoBar('Наведи на узел, чтобы прочитать его.');
    const rows = Math.max(...FOCUS.map((n) => n.row)) + 1;
    const tree = el('div', 'ftree', body);
    tree.style.height = `${rows * FOCUS_ROW}px`;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 500 ${rows * 100}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    tree.append(svg);
    const grid = el('div', 'fgrid', tree);
    grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    const spot = (n) => ({ x: n.col * 100 + 50, y: n.row * 100 });
    for (const n of FOCUS) {
      for (const group of n.needs) {
        for (const id of group.split('|')) {
          const a = spot(FOCUS.find((x) => x.id === id));
          const b = spot(n);
          const y0 = a.y + 88;
          const y1 = b.y + 12;
          const mid = (y0 + y1) / 2;
          const path = document.createElementNS(SVG_NS, 'path');
          path.setAttribute('d', `M${a.x} ${y0}C${a.x} ${mid} ${b.x} ${mid} ${b.x} ${y1}`);
          svg.append(path);
          this.panelItems.push(() => {
            const cls = w.focusDone[n.id] && w.focusDone[id] ? 'on' : w.focusDone[id] && focusOpen(n, w.focusDone) ? 'next' : '';
            if (path.getAttribute('class') !== cls) path.setAttribute('class', cls);
          });
        }
      }
      const b = el('button', 'fnode', grid);
      b.style.gridColumn = n.col + 1;
      b.style.gridRow = n.row + 1;
      el('b', '', b, n.name);
      const days = el('s', '', b);
      const bar = el('i', '', b);
      b.addEventListener('pointerenter', () => show(n.name, n.desc, `${n.days} дн.`));
      b.addEventListener('click', () => {
        if (!w.focusDone[n.id]) this.report(w.focus(n.id));
        this.refreshPanel();
      });
      this.panelItems.push(() => {
        const done = !!w.focusDone[n.id];
        const now = w.focusNow?.id === n.id;
        const open = focusOpen(n, w.focusDone);
        const gone = n.excl?.some((id) => w.focusDone[id]);
        b.className = `fnode${done ? ' done' : now ? ' now' : open ? ' open' : gone ? ' gone' : ' lock'}`;
        days.textContent = done ? 'принято' : now ? `${Math.ceil(w.focusNow.left)} дн.` : gone ? 'закрыто' : `${n.days} дн.`;
        bar.style.width = now ? `${(1 - w.focusNow.left / w.focusNow.full) * 100}%` : '0';
      });
    }
  }

  panel_science() {
    const w = this.war;
    const note = this.head('Наука', 'flask');
    this.panelItems.push(() => {
      note.textContent = `Темы: ${w.active.length} из ${w.slots}. Захваченные лаборатории ускоряют работу.`;
    });
    const body = this.body();
    const show = this.infoBar('Наведи на узел, чтобы прочитать его.');
    const row = el('div', 'scols', body);
    for (const br of BRANCHES) {
      const col = el('div', 'scol', row);
      el('h4', '', col, br.name);
      el('span', '', col, br.text);
      RESEARCH.filter((x) => x.branch === br.id).forEach((n, i) => {
        if (i) {
          const thread = el('div', 'wthread', col);
          this.panelItems.push(() => thread.classList.toggle('on', !!w.done[n.id]));
        }
        const b = el('button', 'wnode', col);
        el('b', '', b, n.name);
        const days = el('s', '', b);
        const bar = el('i', '', b);
        b.addEventListener('pointerenter', () => show(n.name, n.desc, `${n.days} дн.`));
        b.addEventListener('click', () => {
          if (!w.done[n.id] && !w.active.some((x) => x.id === n.id)) this.report(w.research(n.id));
          this.refreshPanel();
        });
        this.panelItems.push(() => {
          const a = w.active.find((x) => x.id === n.id);
          const done = !!w.done[n.id];
          b.className = `wnode${done ? ' done' : a ? ' now' : w.researchable(n) ? ' open' : ' lock'}`;
          days.textContent = done ? 'изучено' : a ? `${Math.ceil(a.left)} дн.` : `${n.days} дн.`;
          bar.style.width = a ? `${(1 - a.left / a.full) * 100}%` : '0';
        });
      });
    }
  }

  panel_brood() {
    const w = this.war;
    const note = this.head('Выводок', 'egg');
    this.panelItems.push(() => {
      note.textContent = `Легионов ${w.legions().length} из ${w.cap}. Линий кладки: ${w.lines}. Гнёзда поднимают лимит.`;
    });
    const body = this.body();
    const types = el('div', 'ltypes', body);
    for (const [id, t] of Object.entries(LEGIONS)) {
      if (t.hidden) continue;
      const b = el('button', 'ltype', types);
      el('span', 'mark', b, t.mark);
      const box = el('div', '', b);
      el('b', '', box, t.name);
      el('em', '', box, `Атака ${t.atk}, оборона ${t.def}`);
      const price = el('s', '', b);
      b.title = t.text;
      b.addEventListener('click', () => {
        this.report(w.buildLegion(id));
        this.refreshPanel();
      });
      this.panelItems.push(() => {
        const open = w.legionOpen(id);
        b.disabled = !open || w.biomass < w.legionCost(id);
        price.textContent = open ? fmtInt(w.legionCost(id)) : w.legionLock(id);
      });
    }
    const qHead = el('h4', '', body, 'КЛАДКА');
    const queue = el('div', '', body);
    this.panelItems.push(() => {
      qHead.style.display = w.queue.length ? '' : 'none';
      queue.innerHTML = '';
      w.queue.forEach((q, i) => {
        const line = el('div', 'wq', queue, `${LEGIONS[q.type].name}${i < w.lines ? `: ${Math.ceil(q.left)} дн.` : ': ждёт'}`);
        el('i', '', line).style.width = `${(1 - q.left / q.full) * 100}%`;
      });
    });
    el('h4', '', body, 'ЛЕГИОНЫ');
    const list = el('div', '', body);
    this.panelItems.push(() => {
      list.innerHTML = '';
      for (const u of w.legions()) {
        const b = el('button', `wrow${this.picked.has(u.id) ? ' on' : ''}`, list);
        el('b', '', b, u.name);
        const fed = w.isSupplied(u.region);
        el('em', fed ? '' : 'bad', b, `${w.byId[u.region].name}${fed ? '' : ', без снабжения'}`);
        const bars = el('div', 'twobars', b);
        el('i', '', el('u', '', bars)).style.width = `${u.str}%`;
        el('i', '', el('u', '', bars)).style.width = `${u.org}%`;
        b.addEventListener('pointerdown', () => {
          this.picked = new Set([u.id]);
          this.closeSide();
          this.updateDock();
        });
      }
    });
  }

  panel_diplo() {
    const w = this.war;
    const note = this.head('Дипломатия', 'knot');
    this.panelItems.push(() => {
      note.textContent = w.mods.diplomacy ? `Пакт стоит ${w.pactCost()} влияния. Блок с пактом не воюет, пока не придёт Коалиция.` : 'Рой ещё не умеет говорить. Изучи «Язык нитей» в разделе Разум.';
    });
    const body = this.body();
    for (const f of w.factions) {
      const row = el('div', 'dipl', body);
      el('i', 'dot', row).style.background = `rgb(${f.color.map((c) => Math.min(255, c * 1.9)).join(',')})`;
      const box = el('div', '', row);
      el('b', '', box, f.name);
      const tag = el('mark', '', box);
      const state = el('em', '', box);
      row.title = f.text;
      const pact = el('button', 'wbtn', row, 'Пакт');
      const tribute = el('button', 'wbtn', row, 'Дань');
      tribute.title = '25 влияния. Блок с пактом кормит рой, но мир злится быстрее';
      const spoil = el('button', 'wbtn', row, 'Раздор');
      spoil.title = `${w.T.sabotageCost} влияния. Армии блока слабеют на полгода`;
      const end = el('button', 'wbtn danger', row, 'Разорвать');
      pact.addEventListener('click', () => this.report(w.pact(f.id)));
      tribute.addEventListener('click', () => this.report(w.tribute(f.id)));
      spoil.addEventListener('click', () => this.report(w.sabotage(f.id)));
      end.addEventListener('click', () => w.breakPact(f.id));
      this.panelItems.push(() => {
        const left = f.regions.filter((id) => w.byId[id].owner === f.id).length;
        const armies = w.units.filter((u) => u.side === f.id).length;
        tag.className = f.surrendered ? 'is-out' : f.pactT > 0 ? 'is-pact' : f.war ? 'is-war' : '';
        tag.textContent = f.surrendered ? 'сдался' : f.pactT > 0 ? `пакт ${Math.ceil(f.pactT)} дн.` : f.war ? 'война' : 'не воюет';
        state.textContent = `регионов ${left}, армий ${armies}${f.tribute ? ', дань' : ''}`;
        const live = !f.surrendered && w.mods.diplomacy;
        pact.style.display = live && f.pactT <= 0 ? '' : 'none';
        spoil.style.display = live && f.pactT <= 0 ? '' : 'none';
        tribute.style.display = live && f.pactT > 0 && !f.tribute ? '' : 'none';
        end.style.display = live && f.pactT > 0 ? '' : 'none';
      });
    }
  }

  face(id, parent) {
    const f = FIGURES.find((x) => x.id === id);
    const box = el('div', 'wface', parent);
    if (PORTRAITS[id]) box.innerHTML = PORTRAITS[id];
    else box.textContent = f.name.split(' ').map((p) => p[0]).join('').slice(0, 2);
    return box;
  }

  panel_allies() {
    const w = this.war;
    const note = this.head('Союзники', 'ally');
    const list = this.body();
    let shown = null;
    this.panelItems.push(() => {
      note.textContent = `Люди и звери приходят сами, когда рой становится достаточно страшен. Встречено ${Object.keys(w.met).length} из ${FIGURES.length}.`;
      const key = `${w.allies.join()}/${w.allySlots}`;
      if (key === shown) return;
      shown = key;
      list.innerHTML = '';
      for (const id of w.allies) {
        const f = FIGURES.find((x) => x.id === id);
        const row = el('div', 'ally', list);
        this.face(id, row);
        const box = el('div', '', row);
        el('b', '', box, f.name);
        el('em', '', box, f.role);
        el('em', '', box, f.perk);
        const eat = el('button', 'wbtn danger', row, `Съесть: +${f.feast}`);
        eat.title = 'Союзник станет коконом, его бонус пропадёт';
        eat.addEventListener('click', () => w.feast(id));
      }
      for (let i = w.allies.length; i < w.allySlots; i++) el('div', 'ally empty', list, 'Свободное место');
    });
  }

  showCard(c) {
    this.keep = this.speed || this.keep;
    this.setSpeed(0);
    this.nameTip.style.display = 'none';
    const e = this.cardEl;
    e.innerHTML = '';
    e.style.display = 'block';
    e.className = `wcard panel k-${c.kind}`;
    this.veil.classList.add('on');
    if (c.figure) this.face(c.figure, e);
    if (c.role) el('small', '', e, c.role);
    el('h3', '', e, c.title);
    el('p', '', e, c.text);
    if (c.perk) el('p', 'wperk', e, c.perk);
    for (const o of c.options) {
      const b = el('button', 'wbtn', e, o.label);
      b.addEventListener('click', () => {
        e.style.display = 'none';
        this.veil.classList.remove('on');
        this.setSpeed(this.keep);
        if (o.fn) o.fn();
        else this.war.chooseCard(o);
      });
    }
  }

  updateLoot() {
    const w = this.war;
    for (const d of w.depots) {
      if (this.loot.has(d)) continue;
      const b = el('button', d.kind === 'signal' ? 'wloot signal' : 'wloot', this.root, d.kind === 'signal' ? 'Эфир' : `+${d.value}`);
      b.addEventListener('click', () => w.takeDepot(d));
      this.loot.set(d, b);
    }
    for (const [d, b] of this.loot) {
      if (!w.depots.includes(d)) {
        b.remove();
        this.loot.delete(d);
        continue;
      }
      const p = this.view.screen(w.byId[d.region]);
      b.style.display = p.visible ? 'block' : 'none';
      b.style.left = `${p.x + 26}px`;
      b.style.top = `${p.y - 30}px`;
    }
  }

  // Подсказки ведут по первым минутам и исчезают, когда приём усвоен.
  updateLessons() {
    const w = this.war;
    const pol = w.map.politics;
    const STEPS = [
      ['Кликни по значку легиона: подписи соседей покажут исход боя. Зелёный по силам, красный сломает легион. Кликни по соседу, чтобы ударить.', () => w.units.some((u) => u.attacking)],
      ['Бой идёт сам. Жёлтая полоска это дух: без него легион отступит. Открой «Выводок» и выведи ещё легион.', () => w.queue.length > 0 || w.legions().length > 3 || w.regions.filter((r) => r.owner === 'swarm').length > 1],
      ['Выбери легион и нажми «Натиск»: бой быстрее, но дух тает сильнее. «Беречь» наоборот.', () => w.legions().some((u) => u.stance !== 'normal') || w.day > 240],
      ['Открой «Науку» и выбери тему: она идёт сама, пока ты воюешь.', () => w.active.length > 0 || Object.keys(w.done).length > 0],
      [pol ? 'Открой «Разум»: Первая мысль откроет путь к дипломатии и доктринам.' : '', () => !pol || !!w.focusNow || !!w.focusDone.first],
      ['Чем дальше от гнезда, тем хуже снабжение. Кликни по своему региону и поставь гнездо.', () => w.nests > 0],
      [pol ? 'Режь связи: регион людей, отрезанный от столиц, станет котлом, и армии там сдадутся.' : '', () => !pol || w.day > 500 || w.regions.some((r) => r.pocket)],
    ];
    while (this.lesson < STEPS.length && STEPS[this.lesson][1]()) this.lesson++;
    const text = STEPS[this.lesson]?.[0] ?? '';
    if (text !== this.lessonText && !(w.map.quarantine && w.quarantined)) {
      this.lessonText = text;
      this.ui.setObjective(text);
    }
  }

  updateMenu() {
    const w = this.war;
    for (const m of this.menu) {
      let note = '';
      let idle = false;
      if (m.id === 'science') {
        note = `${w.active.length} из ${w.slots}`;
        idle = w.active.length < w.slots && RESEARCH.some((n) => w.researchable(n));
      } else if (m.id === 'focus') {
        const n = w.focusNow && FOCUS.find((x) => x.id === w.focusNow.id);
        idle = !n && FOCUS.some((x) => focusOpen(x, w.focusDone));
        note = n ? `${Math.ceil(w.focusNow.left)} дн.` : idle ? 'нет решения' : 'всё решено';
      } else if (m.id === 'brood') {
        note = w.queue.length ? `${w.queue.length} в кладке` : `${w.legions().length} из ${w.cap}`;
      } else if (m.id === 'diplo') {
        note = w.mods.diplomacy ? `${w.factions.filter((f) => f.war).length} войн` : 'закрыто';
      } else if (m.id === 'allies') {
        note = `${w.allies.length} из ${w.allySlots}`;
      }
      if (m.note.textContent !== note) m.note.textContent = note;
      m.b.classList.toggle('idle', idle);
    }
  }

  updateDock() {
    const w = this.war;
    const list = this.pickedUnits();
    for (const id of [...this.picked]) if (!list.some((u) => u.id === id)) this.picked.delete(id);
    const n = list.length;
    this.sel.classList.toggle('none', !n);
    if (!n) {
      this.selMark.innerHTML = ICONS.spider;
      this.selMark.style.padding = '8px';
      this.selName.textContent = 'Легион не выбран';
      this.selNote.textContent = 'Клик по значку на карте, правая кнопка снимает выбор';
    } else {
      this.selMark.style.padding = '';
      const str = list.reduce((v, u) => v + u.str, 0) / n;
      const org = list.reduce((v, u) => v + u.org, 0) / n;
      this.selStr.style.width = `${str}%`;
      this.selOrg.style.width = `${org}%`;
      if (n === 1) {
        const u = list[0];
        const where = u.attacking ? `Бой: ${w.byId[u.attacking].name}` : u.moveT > 0 ? `Идёт: ${w.byId[u.moveTo].name}` : w.byId[u.region].name;
        this.selMark.textContent = `${w.armyInfo(u).mark}${u.no}`;
        this.selName.textContent = u.name;
        const rank = w.rank(u);
        this.selNote.textContent = `${where}${w.isSupplied(u.region) ? '' : ', без снабжения'}${rank ? `, ранг ${rank}` : ''}${u.dig >= 0.5 ? ', окоп' : ''}`;
      } else {
        this.selMark.textContent = String(n);
        this.selName.textContent = `Легионов: ${n}`;
        this.selNote.textContent = 'Кликни по региону: идти или атаковать';
      }
    }
    this.stopBtn.disabled = !n;
    this.selfBtn.disabled = !n;
    this.stormBtn.disabled = !n;
    this.careBtn.disabled = !n;
    this.stormBtn.classList.toggle('on', n > 0 && list.every((u) => u.stance === 'storm'));
    this.careBtn.classList.toggle('on', n > 0 && list.every((u) => u.stance === 'care'));
    this.forecasts.clear();
    if (n) for (const r of w.regions) if (w.border(r) && !r.sealed && !w.isPact(r)) this.forecasts.set(r.id, w.forecast(list, r));
    this.selfBtn.classList.toggle('on', n > 0 && list.every((u) => u.auto));
    this.blackBtn.text.textContent = w.blackoutCd > 0 ? `Блэкаут ${Math.ceil(w.blackoutCd)}` : 'Блэкаут';
    this.blackBtn.disabled = w.blackoutCd > 0;
  }

  // Цели кампании: ближайшая задача, срок и награда.
  updateGoals() {
    const w = this.war;
    const key = w.goals.map((g) => g.text).join();
    if (key !== this.goalKey) {
      this.goalKey = key;
      this.goalBox.innerHTML = '';
      this.goalRows = w.goals.map((g) => {
        const row = el('div', 'wgoal', this.goalBox);
        el('b', '', row, g.text);
        el('em', '', row, `+${g.biomass}`);
        return { g, bar: el('i', '', row) };
      });
    }
    for (const { g, bar } of this.goalRows ?? []) bar.style.width = `${(g.left / g.full) * 100}%`;
  }

  updateTop() {
    const w = this.war;
    const stage = STAGES[w.stage];
    this.date.textContent = w.map.end ? NIGHTS(w.day) : new Date(START + w.day * 864e5).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    this.people.v.textContent = fmtInt(w.people);
    this.bio.v.textContent = fmtInt(w.biomass);
    this.bio.delta.textContent = `${w.lastIncome >= 0 ? '+' : ''}${w.lastIncome.toFixed(1)}`;
    this.bio.delta.classList.toggle('down', w.lastIncome < 0);
    if (this.inf) {
      this.inf.v.textContent = fmtInt(w.influencePts);
      this.inf.delta.textContent = `+${w.influenceRate.toFixed(2)}`;
    }
    this.army.v.textContent = `${w.legions().length} / ${w.cap}`;
    this.stageBar.name.textContent = `Тревога: ${stage.name}`;
    this.stageBar.fill.style.width = `${w.tension}%`;
    if (this.dawnBar) this.dawnBar.fill.style.width = `${w.dawn}%`;
    if (w.stage !== this.lastStage) {
      this.lastStage = w.stage;
      this.ui.say({ text: stage.name, big: true, ms: 2200 });
    }
  }

  // Подписи регионов на карте.
  updatePins() {
    const w = this.war;
    const hit = new Set();
    for (const u of w.units) if (u.attacking) hit.add(u.attacking);
    const planned = new Map();
    for (const f of w.factions) if (f.plan) planned.set(f.plan.target, f.plan.t);
    const goals = new Set(w.goals.map((g) => g.target));
    for (const p of this.pins) {
      const r = p.r;
      const edge = w.border(r);
      const s = this.view.screen(r);
      const show = s.visible && (edge || hit.has(r.id) || r.nest || this.view.showAll());
      p.b.style.display = show ? 'flex' : 'none';
      if (!show) continue;
      p.b.style.left = `${s.x}px`;
      p.b.style.top = `${s.y}px`;
      const force = r.owner === 'swarm' ? '' : r.sealed ? 'кордон' : w.isPact(r) ? 'пакт' : edge || hit.has(r.id) ? fmtInt(w.strength(r)) : '';
      const fc = this.forecasts.get(r.id);
      const plan = planned.get(r.id);
      const tag = plan !== undefined ? `<b class="plan">удар ${Math.max(0, Math.ceil(plan))}</b>` : r.pocket ? '<b class="pocket">котёл</b>' : goals.has(r.id) ? '<b class="goal">цель</b>' : '';
      const ico = RESOURCES[r.res] ? `<b class="rs ${r.res}">${ICONS[RESOURCES[r.res].icon]}</b>` : '';
      const mark = force ? `<b class="them${hit.has(r.id) ? ' hot' : ''}${fc ? ` ${fc.cls}` : ''}">${force}</b>` : r.nest ? '<b class="us">гнездо</b>' : '';
      const vals = mark || tag || ico ? `<div>${mark}${ico}${tag}</div>` : '';
      const html = `${vals}<span>${r.name}</span>`;
      if (p.html !== html) {
        p.html = html;
        p.b.innerHTML = html;
      }
      p.b.classList.toggle('dark', r.blackT > 0);
    }
  }

  counter(u) {
    let c = this.counters.get(u.id);
    if (c) return c;
    const swarm = u.side === 'swarm';
    const b = el('div', `lg${swarm ? '' : ' foe'}`, this.root);
    el('b', '', b, swarm ? `${this.war.armyInfo(u).mark}${u.no}` : 'А');
    const s = el('i', 's', b);
    const o = el('i', 'o', b);
    const rank = el('u', '', b);
    if (swarm) {
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (e.shiftKey) {
          if (this.picked.has(u.id)) this.picked.delete(u.id);
          else this.picked.add(u.id);
        } else {
          this.picked = new Set([u.id]);
        }
        this.closeSide();
        this.updateDock();
      });
      b.addEventListener('dblclick', () => {
        this.picked = new Set(this.war.legions().filter((x) => x.region === u.region).map((x) => x.id));
        this.updateDock();
      });
    }
    b.title = u.name;
    c = { b, s, o, rank };
    this.counters.set(u.id, c);
    return c;
  }

  // Значки легионов: стоят над столицей, идут вместе с маршем, наклоняются в сторону боя.
  updateCounters() {
    const w = this.war;
    const stacks = new Map();
    const seen = (r) => w.mods.intel || r.owner === 'swarm' || r.neighbors.some((n) => w.byId[n].owner === 'swarm');
    for (const u of w.units) {
      const key = `${u.side === 'swarm' ? 's' : 'h'}${u.region}`;
      if (!stacks.has(key)) stacks.set(key, 0);
      const i = stacks.get(key);
      stacks.set(key, i + 1);
      const c = this.counter(u);
      const r = w.byId[u.region];
      const a = this.view.screen(r);
      let { x, y } = a;
      if (u.moveT > 0) {
        const b = this.view.screen(w.byId[u.moveTo]);
        const k = 1 - u.moveT / u.moveFull;
        x += (b.x - x) * k;
        y += (b.y - y) * k;
      } else if (u.attacking) {
        const b = this.view.screen(w.byId[u.attacking]);
        x += (b.x - x) * 0.3;
        y += (b.y - y) * 0.3;
      }
      const swarm = u.side === 'swarm';
      const show = a.visible && (swarm || seen(r));
      c.b.style.display = show ? 'block' : 'none';
      if (!show) continue;
      c.b.style.left = `${x + (i % 4) * 35 - 28}px`;
      c.b.style.top = `${y + (swarm ? -32 - Math.floor(i / 4) * 25 : 36 + Math.floor(i / 4) * 25)}px`;
      c.s.style.width = `${u.str}%`;
      c.o.style.width = `${u.org}%`;
      c.b.classList.toggle('on', this.picked.has(u.id));
      c.b.classList.toggle('fight', u.fight);
      c.b.classList.toggle('out', u.routed);
      c.b.classList.toggle('self', u.auto);
      c.b.classList.toggle('storm', u.stance === 'storm');
      c.b.classList.toggle('care', u.stance === 'care');
      c.b.classList.toggle('dug', u.dig >= 0.5);
      const pips = '▴'.repeat(w.rank(u));
      if (c.rank.textContent !== pips) c.rank.textContent = pips;
    }
    for (const [id, c] of this.counters) {
      if (w.units.some((u) => u.id === id)) continue;
      c.b.remove();
      this.counters.delete(id);
    }
  }

  update() {
    const w = this.war;
    this.tickN++;
    this.updateTop();
    this.updatePins();
    this.updateCounters();
    this.updateLoot();
    if (this.tickN % REFRESH === 0) {
      this.updateMenu();
      this.updateDock();
      this.refreshPanel();
      this.updateLessons();
      this.updateSide();
      this.updateGoals();
    }
    const n = w.nuke;
    this.nukeBtn.style.display = n && !n.safe ? 'block' : 'none';
    if (n) {
      const s = this.view.screen(w.byId[n.region]);
      this.nukeBtn.style.left = `${s.x}px`;
      this.nukeBtn.style.top = `${s.y}px`;
      this.nukeBtn.textContent = `ВЫВЕСТИ ЛЕГИОНЫ ${Math.ceil(n.t)}`;
    }
    if (this.instinct && this.tickN % 6 === 0) w.autoplay();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    for (const off of this.subs) off();
    this.root.remove();
  }
}
