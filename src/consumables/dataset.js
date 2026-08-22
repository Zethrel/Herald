// Loading and validating the tier data file.
//
// The dataset is deliberately external to the code: which flask a Fire Mage
// wants changes every tier and is decided by people, not by this program. What
// the program guarantees is that it never presents a guess as fact -- an entry
// carries where it came from and when it was last touched, and an empty slot
// renders as "not set" rather than as something plausible.

import { readFile } from 'node:fs/promises';

export const SLOTS = ['flask', 'food', 'potion', 'healthPotion', 'manaPotion', 'oil', 'rune'];

export const SLOT_LABELS = {
  flask: 'Flask',
  food: 'Food buff',
  potion: 'Combat potion',
  healthPotion: 'Health potion',
  manaPotion: 'Mana potion',
  oil: 'Weapon oil',
  rune: 'Augment rune',
};

/**
 * The slots every raider is expected to turn up with, and the only ones a gap
 * is reported for.
 *
 * The rest are real, and get carried, but they are conditional: a mana potion
 * is a healer's business, an augment rune is not something every guide bothers
 * to state, and a health potion is a personal preference more than a raid buff.
 * Listing them as "not set for this tier" for the thirty-odd specs they do not
 * apply to would bury the four that matter, so an unanswered optional slot
 * simply is not rendered.
 */
export const REQUIRED_SLOTS = ['flask', 'food', 'potion', 'oil'];

export const OPTIONAL_SLOTS = SLOTS.filter((slot) => !REQUIRED_SLOTS.includes(slot));

/**
 * Whether a slot got an answer at all. `none` counts: "there is no weapon oil
 * for mastery this tier" is an answer, and treating it as a gap would send
 * people looking for something that does not exist.
 */
export function isAnswered(slot) {
  return Boolean(slot?.item) || Boolean(slot?.none);
}

// Modern flasks give a secondary stat, not a primary one, so which flask a spec
// wants follows its stat priority rather than its class. That priority is a
// per-spec, per-tier judgement -- it cannot be derived from the catalogue the
// way intellect-or-agility can -- so a spec declares its secondary in the tier
// file and the flask follows from that.
export const SECONDARY_STATS = ['crit', 'haste', 'mastery', 'versatility'];

export const SECONDARY_ALIASES = {
  crit: 'crit',
  'critical strike': 'crit',
  crits: 'crit',
  haste: 'haste',
  mastery: 'mastery',
  vers: 'versatility',
  versatility: 'versatility',
};

/** The default block that applies to every spec, whatever it plays. */
export const ALL_KEY = 'all';

/**
 * An explicit "there isn't one this tier", as opposed to "nobody has filled
 * this in". A mastery spec has no weapon oil because none exists, and saying so
 * is worth more than an empty slot a raider has to go and check.
 */
export const NONE = 'none';

export function isNone(reference) {
  return reference === NONE;
}

export function emptyDataset() {
  return {
    schema: 1,
    tier: { name: null, patch: null, expansion: null },
    updatedAt: null,
    staleAfterDays: 90,
    sources: [],
    note: null,
    items: {},
    recipes: {},
    defaults: {},
    specs: {},
    // What each guide says, per source: see src/sources/compare.js.
    reports: {},
  };
}

/**
 * Fill in anything the file left out, so every consumer can assume the shape.
 * Unknown keys are kept -- the file is hand-edited and losing someone's notes
 * on a round trip would be rude.
 */
export function normalizeDataset(raw) {
  const base = emptyDataset();
  return {
    ...base,
    ...raw,
    tier: { ...base.tier, ...(raw?.tier ?? {}) },
    items: raw?.items ?? {},
    recipes: raw?.recipes ?? {},
    defaults: raw?.defaults ?? {},
    specs: raw?.specs ?? {},
    reports: raw?.reports ?? {},
    sources: raw?.sources ?? [],
  };
}

export async function loadDataset(filePath) {
  try {
    return normalizeDataset(JSON.parse(await readFile(filePath, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyDataset();
    throw new Error(`Could not read the tier file at ${filePath}: ${error.message}`);
  }
}

/**
 * A consumable reference is either a slug in `items` or a plain name someone
 * typed into `/consumables set`. Both resolve to the same shape so the rest of
 * the code never has to care which it was.
 *
 * @returns {{slug: string|null, name: string, itemId: number|null, wowhead: string|null}|null}
 */
export function resolveItem(dataset, reference) {
  if (!reference) return null;

  if (typeof reference === 'object') {
    return {
      slug: reference.slug ?? null,
      name: reference.name ?? reference.slug ?? 'unnamed item',
      itemId: reference.itemId ?? null,
      wowhead: reference.wowhead ?? null,
    };
  }

  const item = dataset.items?.[reference];
  if (!item) {
    // A free-text name. Perfectly usable -- it just has no recipe attached.
    return { slug: null, name: reference, itemId: null, wowhead: null };
  }

  return {
    slug: reference,
    name: item.name ?? reference,
    itemId: item.itemId ?? null,
    wowhead: item.wowhead ?? null,
  };
}

/**
 * A slot may hold one item or several acceptable ones -- a guide that says
 * "crit or haste flask" is stating a real fact about the spec, not hedging, and
 * flattening it to one would lose it. The first is the primary; the rest are
 * alternatives.
 *
 * @returns {Array<{slug: string|null, name: string, itemId: number|null, wowhead: string|null}>}
 */
export function resolveItemList(dataset, reference) {
  if (reference == null || isNone(reference)) return [];

  const references = Array.isArray(reference) ? reference : [reference];
  const seen = new Set();
  const items = [];

  for (const entry of references) {
    const item = resolveItem(dataset, entry);
    if (!item) continue;
    const key = item.slug ?? `name:${item.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  return items;
}

/** How many of the catalogue's specs have at least one slot filled. */
export function coverage(dataset, specKeys) {
  const filled = specKeys.filter((key) => {
    const entry = dataset.specs?.[key];
    return entry && SLOTS.some((slot) => entry[slot]);
  });

  return { filled: filled.length, total: specKeys.length, missing: specKeys.length - filled.length };
}

/**
 * Data this old should not be quoted at a raid without checking. Missing dates
 * count as stale: "we do not know when this was written" is not reassuring.
 */
export function isStale(dataset, now = Date.now()) {
  if (!dataset.updatedAt) return true;
  const updated = Date.parse(dataset.updatedAt);
  if (Number.isNaN(updated)) return true;
  const days = (now - updated) / 86_400_000;
  return days > (dataset.staleAfterDays ?? 90);
}
