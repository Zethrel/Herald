// Where to read each guide's page for a given spec.
//
// Worth being clear about why this is safe to derive when selectors were not: a
// wrong URL 404s. It fails loudly, in one command, and is fixed with one line
// in OVERRIDES. A wrong CSS selector returns the wrong flask and says nothing.
//
// So: the pattern is applied to the whole spec catalogue, the slugs confirmed
// against the real site are marked as such, and `npm run check-guides` turns
// the rest from derived into confirmed (or finds the exceptions).

import { SPECS } from '../game/specs.js';

export function guideSlug(spec) {
  return `${spec.name} ${spec.className}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// --- Method --------------------------------------------------------------------
//
//   https://www.method.gg/guides/<spec>-<class>/stats-races-and-consumables
//
// The pattern held for every spec when checked: see METHOD_CONFIRMED below.

export const METHOD_BASE = 'https://www.method.gg/guides';
export const METHOD_PAGE = 'stats-races-and-consumables';

// Every slug below returned 200 when checked against the live site on
// 2026-08-17: all 39 specs, no 404s, no exceptions to the pattern. The list is
// explicit rather than "the pattern is verified" on purpose -- if a patch adds
// a spec, its derived URL is unverified until someone checks it, and the test
// suite says so rather than the bot quietly linking somewhere that may not
// exist.
export const METHOD_CONFIRMED = new Set([
  // Death Knight
  'blood-death-knight',
  'frost-death-knight',
  'unholy-death-knight',
  // Demon Hunter
  'havoc-demon-hunter',
  'vengeance-demon-hunter',
  // Druid
  'balance-druid',
  'feral-druid',
  'guardian-druid',
  'restoration-druid',
  // Evoker
  'devastation-evoker',
  'preservation-evoker',
  'augmentation-evoker',
  // Hunter
  'beast-mastery-hunter',
  'marksmanship-hunter',
  'survival-hunter',
  // Mage
  'arcane-mage',
  'fire-mage',
  'frost-mage',
  // Monk
  'brewmaster-monk',
  'mistweaver-monk',
  'windwalker-monk',
  // Paladin
  'holy-paladin',
  'protection-paladin',
  'retribution-paladin',
  // Priest
  'discipline-priest',
  'holy-priest',
  'shadow-priest',
  // Rogue
  'assassination-rogue',
  'outlaw-rogue',
  'subtlety-rogue',
  // Shaman
  'elemental-shaman',
  'enhancement-shaman',
  'restoration-shaman',
  // Warlock
  'affliction-warlock',
  'demonology-warlock',
  'destruction-warlock',
  // Warrior
  'arms-warrior',
  'fury-warrior',
  'protection-warrior',
]);

/**
 * Slugs that do not follow the pattern. Empty, and now known to be empty rather
 * than merely unwritten: all 39 derived URLs answered 200 on 2026-08-17.
 *
 * @type {Record<string, string>} spec key -> slug
 */
export const METHOD_OVERRIDES = {};

export function methodSlug(spec) {
  return METHOD_OVERRIDES[spec.key] ?? guideSlug(spec);
}

export function methodGuideUrl(spec) {
  return `${METHOD_BASE}/${methodSlug(spec)}/${METHOD_PAGE}`;
}

// --- The rest ------------------------------------------------------------------
//
// Only Method is followed by pattern, because only Method keeps one address per
// spec across tiers. The guild's own call has no page to link to, and any
// source added later needs a builder here or it simply has no link.

const BUILDERS = {
  method: methodGuideUrl,
  guild: () => null,
};

/** @returns {string|null} */
export function guideUrl(sourceId, spec) {
  return BUILDERS[sourceId]?.(spec) ?? null;
}

/** Whether a URL was verified against the live site or derived from the pattern. */
export function isConfirmed(sourceId, spec) {
  if (sourceId !== 'method') return false;
  return METHOD_CONFIRMED.has(methodSlug(spec));
}

/** Every Method URL, for the checker. */
export function allMethodGuides() {
  return SPECS.map((spec) => ({
    spec,
    slug: methodSlug(spec),
    url: methodGuideUrl(spec),
    confirmed: METHOD_CONFIRMED.has(methodSlug(spec)),
  }));
}
