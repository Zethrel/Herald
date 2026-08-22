// Reading a class-by-class consumable table.
//
// The input is the shape people actually have: a markdown heading per class and
// a two-column table of spec and consumables, pasted out of a guide, a wiki or
// a chat message. Out comes the same line format `import.js` reads, so the
// table becomes an editable tier file rather than a thing nobody can maintain.
//
// Pure: text in, lines and a list of complaints out. The one judgement it makes
// is which slot each item belongs in, and every call it is unsure about comes
// back in `problems` rather than being quietly filed somewhere plausible -- a
// flask recorded as a potion is wrong on a raid night, while one that never
// made it in is a blank someone fills.

import { SLOTS } from './dataset.js';
import { findSpec } from '../game/specs.js';

// How a slot is spelled in the output. The canonical keys are camelCase because
// they are object keys; the file format takes English.
export const SLOT_TEXT = {
  flask: 'flask',
  food: 'food',
  potion: 'potion',
  healthPotion: 'health potion',
  manaPotion: 'mana potion',
  oil: 'oil',
  rune: 'rune',
};

// Which slot a name belongs to, decided on the words in the name. First match
// wins, so the specific rules come before the general ones: a mana potion and a
// health potion are both potions, and only one of them is the one you drink on
// pull.
const SLOT_RULES = [
  [/\bflask\b/i, 'flask'],
  [/\bmana potion\b/i, 'manaPotion'],
  [/\b(?:health|healing) potion\b/i, 'healthPotion'],
  [/\baugment rune\b/i, 'rune'],
  [/\b(?:oil|weightstone|whetstone|rite of sanctification)\b/i, 'oil'],
  [/\b(?:potion|draught|potential|luster|lustre|elixir)\b/i, 'potion'],
  [/\b(?:feast|roast|parade|celebration|medley|filet|fillet|calamari|banquet|stew|wings|delight|platter)\b/i, 'food'],
];

// "Any Feast", "any primary-stat feast" -- a real statement, and not an item
// anyone can put on a shopping list. It is kept as a note and the slot is left
// to fall through to the tier file's own default.
const GENERIC_FOOD = /^(?:any\s+)?(?:primary[- ]stat\s+|main[- ]stat\s+)?feasts?$/i;

const NO_ITEM = /^no\s+(?:weapon\s+)?(?:oil|food|flask|potion|rune)$/i;

function unescapeMarkdown(text) {
  // The tables arrive pasted out of a chat client, which escapes every markdown
  // character on the way out.
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|])/g, '$1');
}

function stripReferenceNoise(text) {
  // Footnote markers left behind by whatever the table was copied from:
  // "Void-Touched Augment Rune  ][12])".
  return text.replace(/\]?\s*\[\d+\]\s*\)/g, ' ');
}

/**
 * Pull the qualifiers out of one fragment: parentheses, bold asides, a trailing
 * "depending on ...", a leading "2x". What is left is the item name, and the
 * qualifiers become the spec's note.
 */
export function splitQualifiers(fragment) {
  const notes = [];
  let text = fragment;

  // "Thalassian Phoenix Oil *(only without Flametongue Weapon talent)*"
  text = text.replace(/\*?\(([^)]+)\)\*?/g, (_, inner) => {
    notes.push(inner.trim());
    return ' ';
  });

  // "Thalassian Phoenix Oil **on both weapons**" -- an aside, unless the bold
  // wraps the item itself, which is how the tables emphasise "2x".
  text = text.replace(/\*\*([^*]+)\*\*/g, (_, inner) => {
    const trimmed = inner.trim();
    if (/^\d+\s*[×x]\s*/i.test(trimmed) || /^no\s/i.test(trimmed)) return ` ${trimmed} `;
    notes.push(trimmed);
    return ' ';
  });

  text = text.replace(/\*/g, ' ');

  // "no weapon oil — uses Windfury Weapon + Flametongue Weapon"
  const dash = text.split(/\s+[—–]\s+/);
  if (dash.length > 1) {
    text = dash[0];
    notes.push(...dash.slice(1).map((part) => part.trim()));
  }

  // "Light's Potential depending on highest secondary"
  text = text.replace(/\s+depending on\s+(.+)$/i, (_, inner) => {
    notes.push(`depending on ${inner.trim()}`);
    return '';
  });

  // "any main-stat feast, default Harandar Celebration"
  const fallback = text.match(/^(.*?),\s*default\s+(.+)$/i);
  if (fallback) {
    notes.push(fallback[1].trim());
    text = fallback[2];
  }

  // "2× Thalassian Phoenix Oil"
  const quantity = text.trim().match(/^(\d+)\s*[×x]\s*(.+)$/i);
  if (quantity) {
    notes.push(`${quantity[1]}× ${quantity[2].trim()}`);
    text = quantity[2];
  }

  return { name: text.replace(/\s+/g, ' ').trim(), notes };
}

export /**
 * Split on a separator, but only where it separates: a semicolon inside
 * "(one; then another)" is part of the aside, and cutting there turns one item
 * into two fragments that mean nothing.
 */
function splitTop(text, separatorAt) {
  const parts = [];
  let depth = 0;
  let current = '';

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);

    const width = depth === 0 ? separatorAt(text, index) : 0;
    if (width > 0) {
      parts.push(current);
      current = '';
      index += width - 1;
      continue;
    }

    current += char;
  }

  parts.push(current);
  return parts;
}

/** One field of a row: "flask; food; potion" -> three. */
export function splitGroups(text) {
  return splitTop(text, (source, index) => (source[index] === ';' ? 1 : 0)).filter((part) => part.trim());
}

/** Equally acceptable answers within one field: "A / B". */
export function splitAlternatives(text) {
  return splitTop(text, (source, index) => {
    const match = source.slice(index).match(/^\s+\/\s+/);
    return match ? match[0].length : 0;
  }).filter((part) => part.trim());
}

export function classify(name) {
  for (const [pattern, slot] of SLOT_RULES) if (pattern.test(name)) return slot;
  return null;
}

/**
 * A fragment that says nothing on its own -- "Blood Knights" in "Flask of the
 * Magisters / Blood Knights" -- against every full name the document does
 * spell out. Document-local: nothing is invented, it only finds the long form
 * of a name that is already there.
 */
function expand(name, index) {
  const wanted = name.toLowerCase();
  const hits = index.filter((full) => {
    const lower = full.toLowerCase();
    return lower !== wanted && lower.endsWith(` ${wanted}`);
  });
  return hits.length === 1 ? hits[0] : null;
}

export function parseTable(text) {
  const rows = [];
  let className = null;

  for (const raw of stripReferenceNoise(unescapeMarkdown(text)).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const heading = line.match(/^#+\s*(.+?)\s*#*$/);
    if (heading) {
      className = heading[1].replace(/\*/g, '').trim();
      continue;
    }

    if (!line.startsWith('|')) continue;

    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());

    if (cells.length < 2) continue;
    if (/^:?-{2,}/.test(cells[0])) continue; // the separator row
    if (/^special/i.test(cells[0].replace(/\*/g, ''))) continue; // the header row

    const specName = cells[0].replace(/\*/g, '').trim();
    if (!specName || !className) continue;

    rows.push({ className, specName, text: cells[1] });
  }

  return rows;
}

/** Everything the document spells out in full, for `expand`. */
function nameIndex(rows) {
  const names = new Set();
  for (const row of rows) {
    for (const group of splitGroups(row.text)) {
      for (const fragment of splitAlternatives(group)) {
        const { name } = splitQualifiers(fragment);
        if (name && classify(name)) names.add(name);
      }
    }
  }
  return [...names];
}

function convertRow(row, index, problems) {
  const spec = findSpec(`${row.specName} ${row.className}`);
  if (!spec) {
    problems.push(`${row.className} / ${row.specName}: not a spec this bot knows about`);
    return null;
  }

  const slots = {};
  const notes = [];

  for (const group of splitGroups(row.text)) {
    const members = [];
    let slot = null;
    let mixed = false;

    for (const fragment of splitAlternatives(group)) {
      const { name, notes: qualifiers } = splitQualifiers(fragment);
      if (!name) {
        notes.push(...qualifiers);
        continue;
      }

      if (GENERIC_FOOD.test(name)) {
        // "Any Feast" is worth recording and impossible to buy.
        notes.push(name.toLowerCase());
        continue;
      }

      if (NO_ITEM.test(name)) {
        // "no weapon oil — uses Windfury Weapon". The slot already says there
        // is none, so only what comes after the dash is worth keeping.
        const stated = /oil/i.test(name) ? 'oil' : classify(name);
        if (stated) slots[stated] = 'none';
        notes.push(...(qualifiers.length > 0 ? qualifiers.map((note) => `${name} — ${note}`) : [name.toLowerCase()]));
        continue;
      }

      const resolved = classify(name) ? name : expand(name, index) ?? name;
      const own = classify(resolved);

      if (own && slot && own !== slot) mixed = true;
      if (own && !slot) slot = own;

      members.push({ name: resolved, known: Boolean(own) });
      // "Templar" only means something next to the oil it applies to, but
      // "2× Thalassian Phoenix Oil" already names it.
      notes.push(
        ...qualifiers.map((note) =>
          note.toLowerCase().includes(resolved.toLowerCase()) ? note : `${resolved}: ${note}`,
        ),
      );
    }

    if (members.length === 0) continue;

    if (!slot) {
      problems.push(
        `${spec.name} ${spec.className}: no idea which slot "${members.map((entry) => entry.name).join(' / ')}" belongs in`,
      );
      continue;
    }

    if (mixed) {
      // Alternatives listed in one field that classify differently. The first
      // one decides, because that is the order the source wrote them in -- but
      // say so, because it is the one call worth a human's eye.
      problems.push(
        `${spec.name} ${spec.className}: "${members.map((entry) => entry.name).join(' / ')}" mixes slots — filed under ${SLOT_TEXT[slot]}`,
      );
    }

    const existing = slots[slot];
    const names = members.map((entry) => entry.name);
    slots[slot] = existing && existing !== 'none' ? [...new Set([...[].concat(existing), ...names])] : names;
  }

  return { spec, slots, notes: [...new Set(notes)] };
}

export function toLine(entry) {
  const assignments = SLOTS.filter((slot) => entry.slots[slot]).map((slot) => {
    const value = entry.slots[slot];
    const text = value === 'none' ? 'none' : [].concat(value).join(' | ');
    return `${SLOT_TEXT[slot]} = ${text}`;
  });

  // Notes ride on the same line, so a semicolon inside one would be read as the
  // next assignment.
  if (entry.notes.length > 0) assignments.push(`note = ${entry.notes.join(' · ').replace(/;/g, ',')}`);

  return `${entry.spec.name.toLowerCase()} ${entry.spec.className.toLowerCase()}: ${assignments.join('; ')}`;
}


/**
 * Every row of a parsed table, converted.
 *
 * @returns {{entries: Array, problems: string[]}}
 */
export function convertTable(rows) {
  const index = nameIndex(rows);
  const problems = [];
  const entries = rows.map((row) => convertRow(row, index, problems)).filter(Boolean);
  return { entries, problems };
}

/** A problem that cost us data, as opposed to one that only wants an eye on it. */
export function isFatal(problem) {
  return /no idea|not a spec/.test(problem);
}

/**
 * The converted rows as tier text, grouped by class with the class as a
 * comment: the file is meant to be read and edited by hand afterwards, and
 * forty unbroken lines is not readable.
 */
export function toTierText(entries) {
  const lines = [];
  let currentClass = null;

  for (const entry of entries) {
    if (entry.spec.className !== currentClass) {
      currentClass = entry.spec.className;
      lines.push('', `# ${currentClass}`);
    }
    lines.push(toLine(entry));
  }

  return lines.join('\n').replace(/^\n+/, '');
}
