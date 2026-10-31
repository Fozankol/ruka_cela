import { setState } from '../../sim/humans.js';
import { OutdoorScript } from './outdoor.js';

// Город: рой больше не ходит по одному, игрок ведёт фронт по районам.
export class CityScript extends OutdoorScript {
  start() {
    const { w } = this;
    const p = w.level.points.nest;
    w.rts = true;
    w.grid.seen.fill(1);
    w.grid.sense.fill(0.8);
    w.addNest(p.x, p.z);
    for (const h of w.humans) {
      h.lie = 0;
      h.fade = 0;
      setState(h, 'gone');
    }
    w.setObjective(w.level.cfg.objective);
    w.bus.emit('cityStart', w);
  }

  onAlarm() {}

  tick() {}
}
