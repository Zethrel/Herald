// Reading tier data out of a plain text file.
//
// Editing JSON by hand to record twelve item names is a bad trade, and doing it
// through 117 slash commands is worse. So there is a line format instead:
//
//   intellect: flask = Flask of X; food = Feast of Y; potion = Potion of Z
//   fire mage: potion = Potion of Something Else
//
// A stat or role on the left fills a default, covering every spec that maps to
// it. A spec on the left is an exception, and only needs the slots that differ.
// Five default lines plus a handful of exceptions is the whole tier.
//
// Pure: text in, a patch and a list of complaints out. Nothing is written here,
// and a file with one bad line still contributes every good one.

import { ROLES, STATS, findSpec } from '../game/specs.js';
import { SLOTS } from './dataset.js';
import { slugify } from '../sync/tierSync.js';

const DEFAULT_KEYS = new Set([...Object.values(STATS), ...Object.values(ROLES)]);

// What people actually type for each slot.
const SLOT_ALIASES = {
  flask: 'flask',
  flasks: 'flask',
  phial: 'flask',
  food: 'food',
  feast: 'food',
  'food buff': 'food',
  well_fed: 'food',
  potion: 'potion',
  pot: 'potion',
  potions: 'potion',
  'combat potion': 'potion',
};

function parseAssignments(text, lineNumber, errors) {
  const assignments = {};

  // Split on semicolons only: item names contain spaces and the odd comma, and
  // silently truncating "Feast of the Divine, Second Course" would be worse
  // than making people type one character.
  for (const part of text.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^([a-z_ ]+?)\s*[=:]\s*(.+)$/i);
    if (!match) {
      errors.push({ line: lineNumber, text: trimmed, reason: 'expected `slot = item name`' });
      continue;
    }

    const slot = SLOT_ALIASES[match[1].trim().toLowerCase()];
    if (!slot) {
      errors.push({
        line: lineNumber,
        text: trimmed,
        reason: `unknown slot "${match[1].trim()}" — use ${SLOTS.join(', ')}`,
      });
      continue;
    }

    const value = match[2].trim();
    if (!value || value === '-') continue; // A blank in the template: not filled in yet.

    assignments[slot] = value;
  }

  return assignments;
}

/**
 * @param {string} text
 * @returns {{defaults: object, specs: object, items: object, errors: Array, lines: number}}
 */
export function parseTierText(text) {
  const defaults = {};
  const specs = {};
  const items = {};
  const errors = [];
  let lines = 0;

  const remember = (name) => {
    const slug = slugify(name);
    // Every consumable is worth trying a recipe for; sync-tier reports the ones
    // that turn out not to have one, and the shopping list buys those instead.
    items[slug] = { name, craft: true };
    return slug;
  };

  const store = (target, key, assignments) => {
    const entry = target[key] ?? {};
    for (const [slot, name] of Object.entries(assignments)) entry[slot] = remember(name);
    target[key] = entry;
  };

  text.split(/\r?\n/).forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;

    const split = line.indexOf(':');
    if (split === -1) {
      errors.push({ line: lineNumber, text: line, reason: 'expected `key: slot = item`' });
      return;
    }

    const key = line.slice(0, split).trim().toLowerCase();
    const assignments = parseAssignments(line.slice(split + 1), lineNumber, errors);
    if (Object.keys(assignments).length === 0) return;

    lines += 1;

    if (DEFAULT_KEYS.has(key)) {
      store(defaults, key, assignments);
      return;
    }

    const spec = findSpec(key);
    if (spec) {
      store(specs, spec.key, assignments);
      return;
    }

    lines -= 1;
    errors.push({
      line: lineNumber,
      text: key,
      reason: `not a stat, role or spec. Use one of ${[...DEFAULT_KEYS].join(', ')}, or a spec like "fire mage"`,
    });
  });

  return { defaults, specs, items, errors, lines };
}

/**
 * Fold a parsed file into a dataset. Additive: a slot the file does not mention
 * keeps whatever was there, so a one-line correction is a one-line file.
 */
export function applyImport(dataset, parsed, { now = () => new Date().toISOString() } = {}) {
  const items = { ...(dataset.items ?? {}) };
  for (const [slug, item] of Object.entries(parsed.items)) {
    // Keep an id already looked up, and the name already on file.
    items[slug] = { ...item, ...(dataset.items?.[slug] ?? {}) };
  }

  const merge = (existing, incoming) => {
    const merged = { ...existing };
    for (const [key, entry] of Object.entries(incoming)) {
      merged[key] = { ...(existing?.[key] ?? {}), ...entry };
    }
    return merged;
  };

  return {
    ...dataset,
    items,
    defaults: merge(dataset.defaults, parsed.defaults),
    specs: merge(dataset.specs, parsed.specs),
    updatedAt: now(),
  };
}

/**
 * The same, but recorded as what a source said rather than as the guild's own
 * data. Defaults have no place here: Method publishes a page per spec, not a
 * ruling on "all intellect casters", and attributing one to them would be
 * putting words in their mouth.
 */
export function applyImportAsReport(dataset, parsed, { sourceId, urlFor = () => null, now = () => new Date().toISOString() }) {
  const items = { ...(dataset.items ?? {}) };
  for (const [slug, item] of Object.entries(parsed.items)) {
    items[slug] = { ...item, ...(dataset.items?.[slug] ?? {}) };
  }

  const reports = { ...(dataset.reports ?? {}) };
  const existing = reports[sourceId] ?? {};
  const specs = { ...(existing.specs ?? {}) };
  const at = now();

  for (const [specKey, entry] of Object.entries(parsed.specs)) {
    specs[specKey] = {
      ...(specs[specKey] ?? {}),
      ...entry,
      url: urlFor(specKey) ?? specs[specKey]?.url ?? null,
      fetchedAt: at,
    };
  }

  reports[sourceId] = { ...existing, specs, fetchedAt: at };

  return { ...dataset, items, reports };
}
