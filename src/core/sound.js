import { GameAudio } from '../audio/GameAudio.js';
import { Music } from '../audio/Music.js';
import { loud, readVolume, writeVolume } from './volume.js';

// Связывает события мира со звуком и ведёт постоянные слои: дыхание, часы, лапки, сердце.
export class Sound {
  constructor(world, stage, script) {
    this.world = world;
    this.stage = stage;
    this.script = script;
    this.audio = new GameAudio();
    this.t = { scuttle: 0, swarm: 0, breath: 1.5, tick: 1, cricket: 2, heart: 0 };
    this.breathIn = true;
    this.music = new Music();
    this.volume = readVolume();
    this.applyVolume();
    const unlock = () => {
      this.audio.unlock();
      if (this.audio.ctx && !this.music.ctx) this.music.attach(this.audio.ctx, this.audio.master);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Таймер не зависит от кадров: скрытая вкладка не обрывает музыку.
    setInterval(() => this.music.schedule(document.hidden ? 1.6 : 0.4), 120);

    const { audio } = this;
    const bus = world.bus;
    bus.on('ripple', ({ x, z, kind }) => {
      const name = { step: 'step', bite: 'bite', hatch: 'hatch', stomp: 'slipper', death: 'scuttle' }[kind];
      if (name) audio.play(name, { pan: this.pan(x), volume: this.near(x, z) });
    });
    bus.on('slipper', ({ x, z, phase }) => {
      if (phase === 'warn') audio.play('whoosh', { pan: this.pan(x), volume: this.near(x, z) });
    });
    bus.on('lamp', ({ on }) => audio.play(on ? 'lightOn' : 'lightOff'));
    bus.on('flash', (o) => audio.play(o?.dim ? 'wireSnap' : 'gasp', { pan: -0.2 }));
    bus.on('human', ({ h, event }) => {
      if (event === 'cocoon') audio.play('cocoon', { pan: this.pan(h.x), volume: this.near(h.x, h.z) });
      if (event === 'para' && !h.deepSleep) audio.play('cry', { pan: this.pan(h.x) });
    });
    bus.on('radio', () => audio.play('radioBlip'));
    bus.on('flyEaten', (f) => audio.play('bite', { pan: this.pan(f.x), volume: 0.25 * this.near(f.x, f.z) }));
    bus.on('levelComplete', () => {
      audio.play('windowOpen');
      this.music.hit('win');
    });
    bus.on('alarm', () => audio.play('alarm'));
    bus.on('warCapture', () => {
      audio.play('cocoon');
      this.music.hit('capture');
    });
    bus.on('warNukeWarn', () => audio.play('alarm'));
    bus.on('warNuke', () => audio.play('explosion'));
    bus.on('warLost', () => {
      audio.play('wireSnap');
      this.music.hit('lost');
    });
    bus.on('warBlackout', () => audio.play('lightOff'));
    bus.on('warCounter', () => audio.play('radioBlip'));
    bus.on('warPlan', () => {
      audio.play('alarm');
      this.music.hit('war');
    });
    bus.on('warPocket', () => this.music.hit('capture'));
    bus.on('warGoal', () => this.music.hit('idea'));
    bus.on('warDeclared', () => {
      audio.play('alarm');
      this.music.hit('war');
    });
    bus.on('warSurrender', () => audio.play('cocoon'));
    bus.on('warResearch', () => {
      audio.play('hatch');
      this.music.hit('idea');
    });
    bus.on('warFocus', () => {
      audio.play('radioBlip');
      this.music.hit('idea');
    });
    bus.on('warQuarantine', () => audio.play('alarm'));
    bus.on('zone', () => this.music.hit('capture'));
    bus.on('scream', (p) => audio.play('cry', { pan: this.pan(p.x), volume: this.near(p.x, p.z) }));
    bus.on('bark', (d) => audio.play('bark', { pan: this.pan(d.x), volume: this.near(d.x, d.z) }));
    bus.on('order', () => audio.play('uiClick'));
  }

  applyVolume() {
    const v = this.volume;
    this.audio.setVolume(loud(v.all), loud(v.sfx));
    this.music.setVolume(loud(v.music));
  }

  setVolume(id, value) {
    this.volume[id] = value;
    writeVolume(this.volume);
    this.applyVolume();
  }

  // Финал звучит отдельно от игры, поэтому получает итоговую громкость.
  get finaleVolume() {
    const v = this.volume;
    return loud(v.all) * Math.max(loud(v.music), loud(v.sfx));
  }

  pan(x) {
    const scale = Math.max(2, this.stage.rig.dist * 0.6);
    return (x - this.stage.rig.target.x) / scale;
  }

  near(x, z) {
    const d = Math.hypot(x - this.stage.rig.target.x, z - this.stage.rig.target.z);
    const room = Math.max(3, this.stage.rig.dist);
    return Math.max(0.06, 1 - d / (room * 2.2));
  }

  update(dt) {
    const { world: w, audio, t, script } = this;
    if (!audio.ctx || dt <= 0) return;

    t.scuttle -= dt;
    if (w.hero?.moving && !w.hero.hidden && t.scuttle <= 0) {
      t.scuttle = 0.06 + Math.random() * 0.05;
      audio.play('scuttle', { pan: this.pan(w.hero.x), volume: 0.9 });
    }

    // Чем больше рой в движении, тем гуще шорох.
    t.swarm -= dt;
    if (t.swarm <= 0) {
      let moving = 0;
      for (const s of w.spiders) if (s.moving && s.kind !== 'hero') moving++;
      t.swarm = moving > 20 ? 0.04 : 0.09;
      if (moving > 0) audio.play('scuttle', { pan: (Math.random() - 0.5) * 1.4, volume: Math.min(0.75, 0.12 + moving * 0.03) });
    }

    // Спящие дышат, и рядом с рукой это слышно лучше всего.
    t.breath -= dt;
    if (t.breath <= 0) {
      const sleeper = this.nearestSleeper();
      t.breath = this.breathIn ? 1.7 : 2.6;
      if (sleeper) audio.play(this.breathIn ? 'breathIn' : 'breathOut', { pan: this.pan(sleeper.x), volume: sleeper.volume });
      this.breathIn = !this.breathIn;
    }

    // Часы тикают, пока есть ток. Потом в доме становится тихо.
    t.tick -= dt;
    if (t.tick <= 0) {
      t.tick = 1;
      if (!w.powerCut) audio.play('tick', { pan: 0.25, volume: 0.65 });
    }

    t.cricket -= dt;
    if (t.cricket <= 0) {
      t.cricket = 0.8 + Math.random() * 2.2;
      audio.play('cricket', { pan: (Math.random() - 0.5) * 1.8, volume: 1 - audio.dread });
    }

    // В погоне слышно собственное сердце.
    t.heart -= dt;
    if ((script.step === 'flee' || w.alarmOn) && t.heart <= 0) {
      t.heart = 0.62;
      audio.play('heartbeat', { volume: 0.9 });
    }

    const lit = w.lights.some((l) => l.on && !l.moon && !l.dynamic && l.id !== 'nightlight');
    audio.setHum(lit ? 1 : 0);

    let flyLevel = 0;
    for (const f of w.flies) flyLevel = Math.max(flyLevel, this.near(f.x, f.z));
    audio.setFlies(w.flies.length ? flyLevel * Math.min(1, w.flies.length / 5) : 0);

    audio.setDread(Math.min(1, (w.alert ?? 0) / 110));
  }

  nearestSleeper() {
    let best = null;
    for (const h of this.world.humans) {
      if (h.state !== 'sleep') continue;
      const volume = this.near(h.x, h.z - 0.9);
      if (!best || volume > best.volume) best = { x: h.x, volume };
    }
    return best && best.volume > 0.15 ? best : null;
  }
}
