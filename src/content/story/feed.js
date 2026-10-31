import { RADIO } from './radio.js';

// Реплики этапа идут по мере продвижения: progress от 0 до 1.
export class RadioFeed {
  constructor(bus, key) {
    this.bus = bus;
    this.lines = RADIO[key] ?? [];
    this.n = 0;
  }

  update(progress) {
    if (this.n >= this.lines.length || progress < this.n / this.lines.length) return;
    const [who, text] = this.lines[this.n++];
    this.bus.emit('radio', { who, text });
  }
}
