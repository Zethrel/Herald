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
// Confirmed by hand against the live site. Everything else follows the same
// pattern and is derived until the checker says otherwise.

export const METHOD_BASE = 'https://www.method.gg/guides';
export const METHOD_PAGE = 'stats-races-and-consumables';

export const METHOD_CONFIRMED = new Set([
  'blood-death-knight',
  'frost-death-knight',
  'unholy-death-knight',
  'restoration-druid',
]);

/**
 * Slugs that do not follow the pattern. Empty because none are known yet -- the
 * point of the checker is to fill this in with facts rather than guesses.
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

// --- The others ----------------------------------------------------------------
//
// Icy Veins and Wowhead both organise their guides differently again, and
// neither pattern has been checked, so neither is guessed at here. A spec with
// no known URL simply has none -- `/consumables compare` says "no link on file"
// rather than offering one that might 404.

const BUILDERS = {
  method: methodGuideUrl,
  'icy-veins': () => null,
  wowhead: () => null,
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
