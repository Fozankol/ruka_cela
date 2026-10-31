// Значки интерфейса рисуются кодом: тонкая линия, цвет берётся из текста.
const line = (body) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  spider: line('<ellipse cx="8" cy="9.4" rx="2.1" ry="2.9" fill="currentColor"/><circle cx="8" cy="5.4" r="1.4" fill="currentColor"/><path d="M6.3 7.2 3.8 4.4 2 5M6 8.8 3 7.6 1.4 8.8M6 10.2 3.2 11 2.2 13.2M6.6 11.8 4.8 14.4M9.7 7.200l2.5-2.800L14 5M10 8.800l3-1.2 1.6 1.200M10 10.200l2.8.800 1 2.200M9.4 11.800l1.8 2.6"/>'),
  people: line('<circle cx="6" cy="5" r="2.3"/><path d="M2 13c.4-3 2-4.4 4-4.400s3.6 1.4 4 4.400M10.5 3a2.3 2.3 0 0 1 0 4.200M11.7 9.200c1.3.5 2 1.8 2.3 3.8"/>'),
  drop: line('<path d="M8 2s4.5 4.7 4.5 8a4.5 4.5 0 0 1-9 0C3.5 6.7 8 2 8 2z"/><path d="M5.8 10.300a2.3 2.3 0 0 0 1.9 2"/>'),
  signal: line('<circle cx="8" cy="12" r="1.2" fill="currentColor"/><path d="M5.2 9.200a4 4 0 0 1 5.6 0M2.8 6.800a7.4 7.4 0 0 1 10.4 0M.9 4.5"/>'),
  alert: line('<path d="M8 2.5 14.3 13.500H1.700L8 2.500z"/><path d="M8 6.600v3.300M8 11.700v.1"/>'),
  dawn: line('<path d="M1.5 12.500h13M4 12.500a4 4 0 0 1 8 0M8 3.200v2.400M2.9 6.400l1.6 1.600M13.1 6.400l-1.6 1.6"/>'),
  eye: line('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  flask: line('<path d="M6 2h4M6.7 2v4.300L3 12.500A1 1 0 0 0 3.9 14h8.200a1 1 0 0 0 .9-1.500L9.3 6.300V2M5 10.200h6"/>'),
  egg: line('<path d="M8 2c2.8 0 4.7 4.3 4.7 7a4.7 4.7 0 0 1-9.4 0C3.3 6.3 5.2 2 8 2z"/><path d="M6.4 8.600v.1M9.6 7.200v.1M8.4 11v.1"/>'),
  knot: line('<circle cx="5.8" cy="8" r="3.7"/><circle cx="10.2" cy="8" r="3.7"/>'),
  ally: line('<circle cx="8" cy="5" r="2.7"/><path d="M3 14c.5-3.5 2.4-5 5-5s4.5 1.5 5 5"/>'),
  eight: line('<path d="M8 8C6 5.4 4.8 4.4 3.4 4.400a3.6 3.6 0 0 0 0 7.200C4.8 11.6 6 10.6 8 8s3.2-3.6 4.6-3.600a3.6 3.6 0 0 1 0 7.200C11.2 11.6 10 10.6 8 8z"/>'),
  food: line('<circle cx="8" cy="8" r="5.5"/><path d="M6 6.300v.1M9.7 5.900v.1M10.3 9.700v.1M6.8 10.300v.1"/>'),
  web: line('<path d="M2 14 14 2M2 14V4.500M2 14h9.500M2 9.700A4.3 4.3 0 0 1 6.3 14M2 5.500A8.5 8.5 0 0 1 10.5 14"/>'),
  house: line('<path d="M2.5 8 8 3l5.5 5M4 7v6.500h8V7M6.7 13.500V10h2.600v3.5"/>'),
  fang: line('<path d="M5 2.500c-1.6 3-1.1 6.2 1.5 8.500M11 2.500c1.6 3 1.1 6.2-1.5 8.500M6.5 11 8 13.5 9.5 11"/>'),
  widow: line('<path d="M4.5 2.500h7L9 8l2.5 5.500h-7L7 8 4.5 2.500z" fill="currentColor"/>'),
  sword: line('<path d="M3 13 11.3 4.700M11.3 4.700l1.9-2 .3 2.3-2.2-.3zM4.8 9.200l2 2"/>'),
  nest: line('<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2.5"/><path d="M8 2.500v11M2.5 8h11M4.1 4.100l7.8 7.800M11.9 4.100l-7.8 7.8"/>'),
  close: line('<path d="M4 4l8 8M12 4l-8 8"/>'),
  stop: line('<rect x="4" y="4" width="8" height="8" rx="1"/>'),
  forward: line('<path d="M3 3.5 8 8l-5 4.500M8 3.5 13 8l-5 4.5"/>'),
  all: line('<rect x="2.5" y="2.5" width="4.5" height="4.5"/><rect x="9" y="2.5" width="4.5" height="4.5"/><rect x="2.5" y="9" width="4.5" height="4.5"/><rect x="9" y="9" width="4.5" height="4.5"/>'),
  bolt: line('<path d="M9 1.5 3.5 9H8l-1 5.500L12.5 7H8l1-5.500z"/>'),
  pause: line('<path d="M5.5 3.500v9M10.5 3.500v9"/>'),
  note: line('<path d="M6 12.500V3.500l7-1.300v9"/><ellipse cx="4.300" cy="12.500" rx="1.800" ry="1.400" fill="currentColor"/><ellipse cx="11.300" cy="11.200" rx="1.800" ry="1.400" fill="currentColor"/>'),
  shield: line('<path d="M8 2 13 4v4.500c0 3-2.200 4.800-5 5.500-2.800-.7-5-2.500-5-5.500V4z"/>'),
  flag: line('<path d="M3.5 14V2.500M3.5 3h8.500l-2 2.8 2 2.800H3.5"/>'),
};

export function icon(name, parent) {
  const i = document.createElement('i');
  i.className = 'ico';
  i.innerHTML = ICONS[name] ?? '';
  if (parent) parent.appendChild(i);
  return i;
}
