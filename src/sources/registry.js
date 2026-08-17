// The sites whose recommendations Herald will repeat.
//
// It repeats them, it does not adopt them: every entry keeps the source's name,
// the page it came from and when it was read, and nothing here is ever
// presented as Herald's own advice. That is the difference between quoting a
// guide and laundering it.

// Icy Veins and Wowhead were considered and dropped, and the reason is worth
// keeping: both mint a new URL for every tier, so there is no stable page to
// follow. A source has to have a durable address before anything can track it
// by pattern -- Method's /guides/<spec>-<class>/ does, theirs does not.
export const SOURCES = [
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
