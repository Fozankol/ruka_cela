// Вставляется в консоль страницы с ?notitle=1&paused=1: проходит дом целиком и пишет журнал шагов.
(() => {
  const g = window.__g;
  const w = g.world;
  const p = w.level.points;
  const log = [];
  let last = '';
  const note = () => {
    if (g.script.step !== last) {
      last = g.script.step;
      log.push(`${w.t.toFixed(1)}s ${last} рой=${w.swarmCount()} соки=${Math.floor(w.res.soki)} шёлк=${Math.floor(w.res.silk)}`);
    }
  };
  const run = (sec, fn) => {
    for (let t = 0; t < sec; t += 0.2) {
      fn?.();
      g.advance(0.2);
      note();
    }
  };
  g.advance(0.3);
  w.setMark(p.hand.x, p.hand.z, true);
  run(3);
  g.script.action();
  run(1.3);
  w.setMark(p.crack.x, p.crack.z, true);
  run(16);
  g.script.action();
  run(5);
  w.setMark(p.plate.x, p.plate.z, true);
  run(25);
  run(30, () => w.buy('ling'));
  w.setMark(p.wire.x, p.wire.z, true);
  run(40, () => w.buy('ling'));
  w.setMark(p.grandpa.x, p.grandpa.z, true);
  run(40, () => w.buy('ling'));
  const targets = () => w.humans.filter((h) => h.huntable && h.state !== 'cocoon');
  run(160, () => {
    const t = targets()[0];
    if (t) w.setMark(t.x, t.z);
    w.buy('ling');
  });
  run(45);
  return { log, step: g.script.step, pop: w.level.population, humans: w.humans.map((h) => [h.id, h.state]) };
})();
