// The sites whose recommendations Herald will repeat.
//
// It repeats them, it does not adopt them: every entry keeps the source's name,
// the page it came from and when it was read, and nothing here is ever
// presented as Herald's own advice. That is the difference between quoting a
// guide and laundering it.

export const SOURCES = [
  {
    id: 'icy-veins',
    name: 'Icy Veins',
    homepage: 'https://www.icy-veins.com/',
  },
  {
    id: 'wowhead',
    name: 'Wowhead',
    homepage: 'https://www.wowhead.com/',
  },
  {
    id: 'method',
    name: 'Method',
    homepage: 'https://www.method.gg/',
  },
  {
    id: 'guild',
    name: 'Our own call',
    homepage: null,
    // Not a site: what the guild decided, recorded alongside the others so a
    // disagreement with the guides is visible rather than silent.
    local: true,
  },
];

export const SOURCE_IDS = SOURCES.map((source) => source.id);

export function sourceById(id) {
  return SOURCES.find((source) => source.id === id) ?? null;
}

export function sourceName(id) {
  return sourceById(id)?.name ?? id;
}
