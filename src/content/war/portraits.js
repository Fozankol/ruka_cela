// Портреты союзников: тёмные силуэты с одним узнаваемым признаком.
const BONE = '#e8e2da';
const RED = '#d8342a';
const AMBER = '#e0a63c';
const STEEL = '#5b87c4';
const SHADE = '#2b2024';

const frame = (body) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="100" height="100" fill="#120a0c"/>${body}</svg>`;
const bust = `<path d="M16 100c2-20 17-30 34-30s32 10 34 30z" fill="${SHADE}"/><circle cx="50" cy="44" r="19" fill="${SHADE}"/>`;

export const PORTRAITS = {
  scientist: frame(`${bust}<g fill="none" stroke="${BONE}" stroke-width="2"><circle cx="42" cy="43" r="6"/><circle cx="58" cy="43" r="6"/><path d="M48 43h4M36 42l-5-2M64 42l5-2"/></g><path d="M72 92 84 62M78 92 86 64" stroke="${AMBER}" stroke-width="2" stroke-linecap="round"/>`),
  electrician: frame(`${bust}<path d="M29 39a21 21 0 0 1 42 0z" fill="${AMBER}"/><rect x="24" y="38" width="52" height="4" rx="2" fill="${AMBER}"/><path d="M47 18h6v9h-6z" fill="#120a0c"/><path d="M72 94 80 70M86 94 78 70" stroke="${BONE}" stroke-width="3" stroke-linecap="round"/>`),
  sprayer: frame(`<rect x="66" y="46" width="15" height="42" rx="7" fill="#3f7f4f"/><path d="M73 46V36" stroke="${BONE}" stroke-width="3"/>${bust}<path d="M38 50h24v8a12 8 0 0 1-24 0z" fill="#16100f" stroke="${BONE}" stroke-width="1.5"/><circle cx="50" cy="56" r="4" fill="${BONE}"/><path d="M50 62c2 14 16 12 23-16" fill="none" stroke="${BONE}" stroke-width="1.5"/>`),
  cult: frame(`<path d="M50 12C26 12 22 46 18 100h64C78 46 74 12 50 12z" fill="${SHADE}"/><ellipse cx="50" cy="48" rx="14" ry="20" fill="#060304"/><g fill="${RED}"><circle cx="32" cy="42" r="2"/><circle cx="35" cy="31" r="2"/><circle cx="42" cy="24" r="2"/><circle cx="50" cy="22" r="2"/><circle cx="58" cy="24" r="2"/><circle cx="65" cy="31" r="2"/><circle cx="68" cy="42" r="2"/><circle cx="50" cy="84" r="2"/></g>`),
  general: frame(`${bust}<path d="M26 32c6-14 42-14 48 0-6 7-42 7-48 0z" fill="#3b4a40"/><path d="M34 37c8 4 24 4 32 0v5c-8 3-24 3-32 0z" fill="#120a0c"/><path d="M18 80l18-5v6l-18 5zM82 80l-18-5v6l18 5z" fill="${AMBER}"/>`),
  tycoon: frame(`${bust}<path d="M38 72 50 96 62 72z" fill="${BONE}"/><path d="M47 74h6l2 6-5 16-5-16z" fill="${RED}"/>`),
  hacker: frame(`<path d="M50 14C28 14 22 44 18 100h64C78 44 72 14 50 14z" fill="${SHADE}"/><ellipse cx="50" cy="50" rx="15" ry="20" fill="#0a1320"/><ellipse cx="50" cy="60" rx="12" ry="9" fill="${STEEL}" opacity=".5"/><path d="M28 94 34 74h32l6 20z" fill="#0a0d14" stroke="${STEEL}" stroke-width="1.5"/><path d="M38 80h24M38 85h16" stroke="${STEEL}" stroke-width="1.5"/>`),
  rats: frame(`<circle cx="32" cy="42" r="11" fill="${SHADE}"/><circle cx="68" cy="42" r="11" fill="${SHADE}"/><path d="M50 92C34 80 28 66 32 54c4-10 32-10 36 0 4 12-2 26-18 38z" fill="${SHADE}"/><circle cx="50" cy="90" r="3" fill="${RED}"/><circle cx="42" cy="60" r="2.5" fill="${BONE}"/><circle cx="58" cy="60" r="2.5" fill="${BONE}"/><path d="M34 44 38 26l12 10 12-10 4 18z" fill="${AMBER}"/><path d="M36 76H20M36 80l-14 6M64 76h16M64 80l14 6" stroke="${BONE}" stroke-width="1"/>`),
  ants: frame(`<path d="M42 34C36 18 26 16 18 22M58 34c6-16 16-18 24-12" fill="none" stroke="${BONE}" stroke-width="2" stroke-linecap="round"/><path d="M50 26c18 0 26 14 22 30-3 12-12 18-22 18s-19-6-22-18c-4-16 4-30 22-30z" fill="${SHADE}"/><circle cx="37" cy="46" r="5" fill="${RED}"/><circle cx="63" cy="46" r="5" fill="${RED}"/><path d="M42 72C40 84 34 88 28 90M58 72c2 12 8 16 14 18" fill="none" stroke="${AMBER}" stroke-width="3.5" stroke-linecap="round"/>`),
};
