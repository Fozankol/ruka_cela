const RED = [3.4, 0.4, 0.2];
const BLUE = [0.4, 1.1, 3.4];
const PALE = [0.5, 0.62, 0.8];

// Какие стрелки сейчас нужны на карте: удары, контратаки и марши легионов.
export function arrowWants(war, at = (r) => r) {
  const want = new Map();
  const add = (kind, from, to, color) => want.set(`${kind}${from}>${to}`, [at(war.byId[from]), at(war.byId[to]), color]);
  for (const u of war.units) {
    const swarm = u.side === 'swarm';
    if (u.attacking) add(swarm ? 'f' : 'c', u.region, u.attacking, swarm ? RED : BLUE);
    else if (swarm && u.moveT > 0 && !u.routed) add('m', u.region, u.moveTo, PALE);
  }
  // Готовящийся удар людей виден заранее.
  for (const f of war.factions) if (f.plan) add('p', f.plan.stage, f.plan.target, [0.22, 0.5, 1.7]);
  return want;
}
