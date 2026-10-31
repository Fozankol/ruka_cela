import { BRANCHES, RESEARCH } from '../content/war/research.js';
import { STAGES } from '../sim/war.js';

const el = (tag, cls, parent, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

const START = new Date(2026, 10, 1).getTime();
const fmtInt = (v) => Math.floor(v).toLocaleString('ru-RU');
const big = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} млрд` : v >= 1e6 ? `${Math.round(v / 1e6)} млн` : fmtInt(v));

// Интерфейс войны: точки регионов на глобусе и панели по краям.
export class WarHud {
  constructor(root, war, view, bus, ui) {
    this.war = war;
    this.view = view;
    this.ui = ui;
    this.speed = 1;
    this.instinct = false;
    this.selected = null;
    this.subs = [];
    this.root = el('div', 'war', root);

    this.top = el('div', 'wtop panel', this.root);
    this.date = el('b', 'wdate', this.top);
    this.people = this.stat('Людей на Земле');
    this.bio = this.stat('Биомасса');
    this.army = this.stat('Армии');
    this.stageBar = this.meter('stage');
    this.dawnBar = this.meter('dawn', 'Проект «Рассвет»');

    this.pins = war.regions.map((r) => {
      const b = el('button', 'pin', this.root);
      b.innerHTML = '<i></i><span></span>';
      b.querySelector('span').textContent = r.name;
      b.addEventListener('click', () => this.clickRegion(r));
      return { r, b, ring: b.querySelector('i') };
    });
    this.loot = new Map();

    this.side = el('div', 'wside panel', this.root);
    this.side.style.display = 'none';

    this.dock = el('div', 'wdock', this.root);
    this.buyBtn = el('button', 'wbuy', this.dock);
    this.buyBtn.addEventListener('click', () => this.report(war.buyArmy()));
    this.evoBtn = el('button', 'wbtn', this.dock, 'Эволюция');
    this.evoBtn.addEventListener('click', () => this.toggleEvo());
    this.blackBtn = el('button', 'wbtn', this.dock);
    this.blackBtn.addEventListener('click', () => {
      if (!this.selected) return this.ui.notice('Выбери регион людей');
      this.report(war.blackout(this.selected.id));
      return null;
    });
    this.autoBtn = el('button', 'wbtn', this.dock, 'Инстинкт');
    this.autoBtn.title = 'Рой играет сам';
    this.autoBtn.addEventListener('click', () => {
      this.instinct = !this.instinct;
      this.autoBtn.classList.toggle('on', this.instinct);
    });
    this.speeds = [0, 1, 2, 4, 8].map((s) => {
      const b = el('button', 'wbtn wspeed', this.dock, s ? `×${s}` : '❚❚');
      b.addEventListener('click', () => this.setSpeed(s));
      return { s, b };
    });
    this.setSpeed(1);

    this.evo = el('div', 'wevo panel', this.root);
    this.evo.style.display = 'none';
    this.evoNodes = BRANCHES.map((br) => {
      const col = el('div', 'wcol', this.evo);
      el('h4', '', col, br.name);
      return RESEARCH.filter((n) => n.branch === br.id).map((n) => {
        const b = el('button', 'wnode', col);
        b.innerHTML = `<b>${n.name}</b><em>${n.desc}</em><s>${n.cost}</s>`;
        b.addEventListener('click', () => this.report(war.research(n.id)));
        return { n, b };
      });
    }).flat();

    this.nukeBtn = el('button', 'wnuke', this.root, 'ВЫВЕСТИ АРМИИ');
    this.nukeBtn.addEventListener('click', () => war.evacuate());
    this.cardEl = el('div', 'wcard panel', this.root);
    this.cardEl.style.display = 'none';

    const on = (n, f) => this.subs.push(bus.on(n, f));
    on('warCapture', (r) => {
      ui.notice(`${r.name}: регион наш`);
      if (this.selected === r) this.renderSide();
    });
    on('warLost', (r) => ui.notice(`${r.name}: люди отбили регион`));
    on('warToast', (t) => ui.notice(t));
    on('warNukeWarn', () => ui.notice('Ядерный удар! Выведи армии'));
    on('warNuke', ({ region, safe }) => ui.say({ text: `${region.name}: удар. ${safe ? 'Армии спасены' : 'Потери огромны'}`, ms: 3000 }));
    on('warDawn', () => ui.say({ text: 'Рассвет. Люди отбили границу.', big: true, ms: 2600 }));
    on('warCard', (c) => this.showCard(c));
    this.lastStage = 0;
  }

  stat(label) {
    const d = el('div', 'wstat', this.top);
    el('span', '', d, label);
    return el('b', '', d, '0');
  }

  meter(cls, label) {
    const d = el('div', `wmeter ${cls}`, this.top);
    const name = el('span', '', d, label ?? '');
    const fill = el('i', '', el('section', '', d));
    return { name, fill };
  }

  report(err) {
    if (err) this.ui.notice(err);
  }

  setSpeed(s) {
    this.speed = s;
    for (const x of this.speeds) x.b.classList.toggle('on', x.s === s);
  }

  toggleEvo() {
    this.evo.style.display = this.evo.style.display === 'none' ? 'flex' : 'none';
  }

  clickRegion(r) {
    this.selected = r;
    if (r.owner === 'human' && this.war.border(r)) this.war.toggleFront(r.id);
    this.renderSide();
  }

  renderSide() {
    const r = this.selected;
    const w = this.war;
    this.side.style.display = r ? 'block' : 'none';
    if (!r) return;
    const mine = r.owner === 'swarm';
    this.side.innerHTML = '';
    el('h3', '', this.side, r.name);
    el('p', '', this.side, mine ? 'Под шёлком' : w.border(r) ? 'Граница фронта' : 'Далеко от фронта');
    el('p', '', this.side, `Население: ${big(r.people)}`);
    if (!mine) {
      this.sideBar = el('i', '', el('section', 'wg', this.side));
      this.sideNote = el('p', 'wnote', this.side);
    }
    if (mine) {
      const b = el('button', 'wbtn', this.side, r.nest ? 'Гнездо построено' : `Гнездо: ${w.nestCost()}`);
      b.disabled = r.nest;
      b.addEventListener('click', () => {
        this.report(w.buildNest(r.id));
        this.renderSide();
      });
    } else if (w.border(r)) {
      const f = w.fronts.some((x) => x.to === r.id);
      const b = el('button', 'wbtn', this.side, f ? 'Остановить удар' : 'Начать удар');
      b.addEventListener('click', () => {
        w.toggleFront(r.id);
        this.renderSide();
      });
    }
  }

  showCard(c) {
    this.setSpeed(0);
    const e = this.cardEl;
    e.innerHTML = '';
    e.style.display = 'block';
    el('h3', '', e, c.title);
    el('p', '', e, c.text);
    for (const o of c.options) {
      const b = el('button', 'wbtn', e, o.label);
      b.addEventListener('click', () => {
        this.war.chooseCard(o);
        e.style.display = 'none';
        this.setSpeed(1);
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
      b.style.left = `${p.x + 16}px`;
      b.style.top = `${p.y - 28}px`;
    }
  }

  update() {
    const w = this.war;
    const stage = STAGES[w.stage];
    this.date.textContent = new Date(START + w.day * 864e5).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    this.people.textContent = fmtInt(w.people);
    this.bio.textContent = `${fmtInt(w.biomass)} +${w.lastIncome.toFixed(1)}/с`;
    this.army.textContent = `${Math.floor(w.armies)} / ${w.cap}`;
    this.stageBar.name.textContent = `Тревога: ${stage.name}`;
    this.stageBar.fill.style.width = `${w.tension}%`;
    this.dawnBar.fill.style.width = `${w.dawn}%`;

    if (w.stage !== this.lastStage) {
      this.lastStage = w.stage;
      this.ui.say({ text: stage.name, big: true, ms: 2200 });
    }

    const cost = w.armyCost();
    this.buyBtn.textContent = `Армия: ${fmtInt(cost)}`;
    this.buyBtn.disabled = w.biomass < cost || w.armies >= w.cap;
    this.blackBtn.textContent = w.blackoutCd > 0 ? `Блэкаут ${Math.ceil(w.blackoutCd)}` : 'Блэкаут';
    this.blackBtn.disabled = w.blackoutCd > 0;

    const frontTo = new Set(w.fronts.map((f) => f.to));
    for (const p of this.pins) {
      const s = this.view.screen(p.r);
      p.b.style.display = s.visible ? 'block' : 'none';
      if (!s.visible) continue;
      p.b.style.left = `${s.x}px`;
      p.b.style.top = `${s.y}px`;
      const front = frontTo.has(p.r.id);
      p.b.className = `pin ${p.r.owner === 'swarm' ? 'mine' : w.border(p.r) ? 'edge' : 'far'}${front ? ' front' : ''}${p.r.nest ? ' nest' : ''}${p.r === this.selected ? ' sel' : ''}${p.r.blackT > 0 ? ' dark' : ''}${p.r.burnT > 0 ? ' burn' : ''}`;
      if (front) p.ring.style.setProperty('--p', `${(1 - p.r.garrison / p.r.gMax) * 100}%`);
    }
    this.updateLoot();

    const r = this.selected;
    if (r && this.sideBar && r.owner === 'human') {
      this.sideBar.style.width = `${(r.garrison / r.gMax) * 100}%`;
      this.sideNote.textContent = `Гарнизон ${fmtInt(r.garrison)}, удар ${w.frontPower().toFixed(1)} на направление, запас ${w.reserve().toFixed(1)} из ${w.reserveNeed().toFixed(1)}`;
    }

    const n = w.nuke;
    this.nukeBtn.style.display = n && !n.safe ? 'block' : 'none';
    if (n) {
      const s = this.view.screen(w.byId[n.region]);
      this.nukeBtn.style.left = `${s.x}px`;
      this.nukeBtn.style.top = `${s.y}px`;
      this.nukeBtn.textContent = `ВЫВЕСТИ АРМИИ ${Math.ceil(n.t)}`;
    }

    if (this.evo.style.display !== 'none') {
      for (const x of this.evoNodes) {
        const done = !!w.done[x.n.id];
        x.b.classList.toggle('done', done);
        x.b.disabled = done || !w.researchable(x.n) || w.biomass < x.n.cost;
      }
    }
    if (this.instinct) w.autoplay();
  }

  dispose() {
    for (const off of this.subs) off();
    this.root.remove();
  }
}
