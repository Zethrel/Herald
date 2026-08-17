// What a given spec should be carrying, and -- just as important -- where that
// answer came from.
//
// Pure. The fallback chain is the whole point: a tier file that only says
// "intellect casters use X" still answers for all nineteen intellect specs,
// while a guild that disagrees about one spec can override just that one.

import { SLOTS, resolveItem } from './dataset.js';
import { consensusFor } from '../sources/compare.js';

/**
 * Order matters: the first source that has an answer for a slot wins.
 *
 *   guild      a /consumables set override on this server
 *   spec       the tier file's entry for this exact spec
 *   sources    what the guides agree on, where they agree
 *   stat       the tier file's default for its primary stat
 *   role       the tier file's default for its role
 *
 * Sources sit below anything a person wrote deliberately and above the generic
 * defaults: a guide that has looked at this exact spec beats "all intellect
 * casters use X", but never beats a decision the guild made. Where the guides
 * disagree they contribute nothing and the chain falls through -- see
 * `src/sources/compare.js` for why a split is not a recommendation.
 *
 * Role sits below stat so a healer default cannot quietly outrank an explicit
 * intellect entry, while still catching healer-only consumables.
 */
export function resolveSpecConsumables({ spec, dataset, overrides = {}, reports = null }) {
  const guild = overrides?.[spec.key] ?? {};
  const specEntry = dataset.specs?.[spec.key] ?? {};
  const statDefault = dataset.defaults?.[spec.stat] ?? {};
  const roleDefault = dataset.defaults?.[spec.role] ?? {};
  const consensus = consensusFor({ dataset, spec, reports });

  const slots = {};
  for (const slot of SLOTS) {
    const candidates = [
      ['guild', guild[slot]],
      ['spec', specEntry[slot]],
      ['sources', consensus[slot]?.item ?? null],
      [`default:${spec.stat}`, statDefault[slot]],
      [`default:${spec.role}`, roleDefault[slot]],
    ];

    const hit = candidates.find(([, reference]) => Boolean(reference));

    slots[slot] = hit
      ? {
          via: hit[0],
          item: resolveItem(dataset, hit[1]),
          // Which guides, and whether they were unanimous, so the reply can say
          // "Icy Veins and Method" rather than an anonymous "sources".
          ...(hit[0] === 'sources'
            ? { agreement: consensus[slot].agreement, sourceIds: consensus[slot].sourceIds }
            : {}),
        }
      : { via: null, item: null };
  }

  return {
    spec,
    slots,
    source: guild.source ?? specEntry.source ?? null,
    note: guild.note ?? specEntry.note ?? null,
    updatedAt: guild.updatedAt ?? specEntry.updatedAt ?? dataset.updatedAt ?? null,
    complete: SLOTS.every((slot) => slots[slot].item),
  };
}

/** The same, for every spec in the catalogue. Used by the shopping list. */
export function resolveAll({ specs, dataset, overrides = {}, reports = null }) {
  return specs.map((spec) => resolveSpecConsumables({ spec, dataset, overrides, reports }));
}

/**
 * Which specs are still unanswered, so `/consumables tier` can say what needs
 * filling in rather than leaving people to discover it one spec at a time.
 */
export function gaps({ specs, dataset, overrides = {}, reports = null }) {
  const missing = [];
  for (const spec of specs) {
    const resolved = resolveSpecConsumables({ spec, dataset, overrides, reports });
    const empty = SLOTS.filter((slot) => !resolved.slots[slot].item);
    if (empty.length > 0) missing.push({ spec, slots: empty });
  }
  return missing;
}
