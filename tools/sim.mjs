// Баланс войны без браузера: npm run sim
import { CITY_MAP } from '../src/content/war/city.js';
import { War } from '../src/sim/war.js';

function line(war, extra = '') {
  const n = war.regions.filter((r) => r.owner === 'swarm').length;
  const leg = war.legions();
  const foes = war.units.length - leg.length;
  return `${Math.round(war.day / 60)}м р${n}/${war.regions.length} л${leg.length}/${war.cap} вр${foes} био${Math.round(war.biomass)} +${Math.round(war.lastIncome)} вл${Math.round(war.influencePts)} Т${Math.round(war.tension)} Р${Math.round(war.dawn)} нау${Object.keys(war.done).length} фок${Object.keys(war.focusDone).length} ${extra}`;
}

function run(label, every, seed, map) {
  const war = new War({ seed, ...(map ? { map } : {}) });
  const log = [];
  let lost = 0;
  let dead = 0;
  let surr = 0;
  war.bus.on('warLost', () => lost++);
  war.bus.on('warToast', (t) => { if (t.includes('уничтожен')) dead++; });
  war.bus.on('warSurrender', () => surr++);
  const dt = 0.25;
  const limit = (map ? 1 : 5) * 3600;
  let next = 0;
  let acc = 0;
  while (!war.finished && war.day < limit) {
    acc += dt;
    if (acc >= every) {
      acc = 0;
      war.autoplay();
    }
    war.tick(dt);
    if (war.day >= next) {
      next += map ? 60 : 600;
      log.push(line(war));
    }
  }
  console.log(`${label} seed ${seed}: ${war.finished ? 'конец' : 'не дошёл'} за ${(war.day / 60).toFixed(1)} мин. потери регионов ${lost}, легионов ${dead}, сдались ${surr}`);
  for (const l of log) console.log('  ' + l);
  return war;
}

const arg = process.argv[2];
if (!arg || arg === 'world') run('бот', 1, 7);
if (arg === 'lazy') run('рассеянный', 12, 7);
if (!arg || arg === 'city') run('город', 1, 7, CITY_MAP);
