// What a given spec should be carrying, and -- just as important -- where that
// answer came from.
//
// Pure. The fallback chain is the whole point: a tier file that only says
// "intellect casters use X" still answers for all nineteen intellect specs,
// while a guild that disagrees about one spec can override just that one.

import { ALL_KEY, SLOTS, resolveItem } from './dataset.js';
import { consensusFor, reportedSecondary } from '../sources/compare.js';

/**
 * Order matters: the first source that has an answer for a slot wins.
 *
 *   guild      a /consumables set override on this server
 *   spec       the tier file's entry for this exact spec
 *   sources    what the guides agree on, where they agree
 *   secondary  the default for the spec's stat priority -- this is what picks
 *              the flask, since modern flasks give a secondary stat
 *   role       the tier file's default for its role
 *   stat       the tier file's default for its primary stat -- the main-stat
 *              potion lives here
 *   all        the default that applies to everyone, whatever they play
 *
 * Sources sit below anything a person wrote deliberately and above the generic
 * defaults: a guide that has looked at this exact spec beats "all intellect
 * casters use X", but never beats a decision the guild made. Where the guides
 * disagree they contribute nothing and the chain falls through -- see
 * `src/sources/compare.js` for why a split is not a recommendation.
 *
 * Role beats stat because it is the narrower rule: every healer is an intellect
 * user, so a `healer: food` line that lost to `intellect: food` could never
 * apply to anyone. Whoever writes a role default means it.
 */
export function resolveSpecConsumables({ spec, dataset, overrides = {}, reports = null }) {
  const guild = overrides?.[spec.key] ?? {};
  const specEntry = dataset.specs?.[spec.key] ?? {};
  const statDefault = dataset.defaults?.[spec.stat] ?? {};
  const roleDefault = dataset.defaults?.[spec.role] ?? {};
  const allDefault = dataset.defaults?.[ALL_KEY] ?? {};
  const consensus = consensusFor({ dataset, spec, reports });

  // Which secondary this spec is stacking, decided the same way as everything
  // else: the guild first, then the tier file, then what the guides said.
  const secondary =
    guild.secondary ?? specEntry.secondary ?? reportedSecondary({ dataset, spec, reports }) ?? null;
  const secondaryDefault = secondary ? (dataset.defaults?.[secondary] ?? {}) : {};

  const slots = {};
  for (const slot of SLOTS) {
    const candidates = [
      ['guild', guild[slot]],
      ['spec', specEntry[slot]],
      ['sources', consensus[slot]?.item ?? null],
      [secondary ? `default:${secondary}` : 'default:secondary', secondaryDefault[slot]],
      [`default:${spec.role}`, roleDefault[slot]],
      [`default:${spec.stat}`, statDefault[slot]],
      ['default:all', allDefault[slot]],
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
    secondary,
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
