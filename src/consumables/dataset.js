// Loading and validating the tier data file.
//
// The dataset is deliberately external to the code: which flask a Fire Mage
// wants changes every tier and is decided by people, not by this program. What
// the program guarantees is that it never presents a guess as fact -- an entry
// carries where it came from and when it was last touched, and an empty slot
// renders as "not set" rather than as something plausible.

import { readFile } from 'node:fs/promises';

export const SLOTS = ['flask', 'food', 'potion'];

export const SLOT_LABELS = {
  flask: 'Flask',
  food: 'Food buff',
  potion: 'Combat potion',
};

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
