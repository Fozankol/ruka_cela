// Звук подключается сам, как только появится src/audio/GameAudio.js. Без него игра молчит.
const modules = import.meta.glob('../audio/GameAudio.js');

export async function connectSound(world, stage) {
  const load = modules['../audio/GameAudio.js'];
  if (!load) return null;
  const { GameAudio } = await load();
  const audio = new GameAudio();
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  // Панорама зависит от положения источника относительно цели камеры.
  const pan = (x) => Math.max(-1, Math.min(1, (x - stage.rig.target.x) / 6));
  const volume = (x, z) => {
    const d = Math.hypot(x - stage.rig.target.x, z - stage.rig.target.z);
    return Math.max(0.08, 1 - d / 14);
  };

  const bus = world.bus;
  bus.on('ripple', ({ x, z, kind }) => {
    const name = { step: 'step', bite: 'bite', hatch: 'hatch', stomp: 'slipper', death: 'scuttle' }[kind];
    if (name) audio.play(name, { pan: pan(x), volume: volume(x, z) });
  });
  bus.on('lamp', ({ on }) => audio.play(on ? 'lightOn' : 'lightOff'));
  bus.on('flash', () => audio.play('wireSnap'));
  bus.on('human', ({ event }) => event === 'cocoon' && audio.play('cocoon'));
  bus.on('radio', () => audio.play('radioBlip'));
  return audio;
}
