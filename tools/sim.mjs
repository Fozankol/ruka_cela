// Баланс войны без браузера: npm run sim
import { War } from '../src/sim/war.js';

function run(label, player, seed) {
  const war = new War({ seed });
  const log = [];
  const count = () => war.regions.filter((r) => r.owner === 'swarm').length;
  let lost = 0;
  let nukes = 0;
  war.bus.on('warLost', () => lost++);
  war.bus.on('warNuke', () => nukes++);
  const dt = 0.25;
  const limit = 4 * 3600;
  let next = 1;
  while (!war.finished && war.day < limit) {
    player(war);
    war.tick(dt);
    const n = count();
    while (n >= next) {
      if (next % 8 === 0 || next === 1) log.push(`${next}р ${Math.round(war.day / 60)}м А${Math.round(war.armies)}/${war.cap} ${Math.round(war.lastIncome)}/с Т${Math.round(war.tension)}`);
      next += 1;
    }
  }
  const stage = war.stage;
  console.log(`${label} seed ${seed}: ${war.finished ? 'конец' : 'не дошёл'} за ${Math.round(war.day / 60)} мин, регионов ${count()}/${war.regions.length}, стадия ${stage}, потери регионов ${lost}, удары ${nukes}, рассвет ${Math.round(war.dawn)}`);
  console.log('  ' + log.join(' | '));
  return war;
}

for (const seed of [7, 21, 42]) run('бот', (w) => w.autoplay(), seed);

// Ленивый игрок ничего не покупает, только держит один фронт.
run('ленивый', (w) => {
  if (!w.fronts.length) {
    const t = w.regions.find((r) => w.border(r));
    if (t) w.toggleFront(t.id);
  }
}, 7);
