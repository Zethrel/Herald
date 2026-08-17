// Comparing what the guides say.
//
// Pure. The interesting decision is what to do when they disagree, and the
// answer is: say so, and pick nothing. A bot that silently resolves a three-way
// split into one flask is worse than one that shows the split, because the
// split is the information -- it means the choice is close, or the tier moved,
// or one guide is stale.
//
// Majority wins only when it is a real majority. Two against two is not a
// recommendation.

import { SLOTS, resolveItem } from '../consumables/dataset.js';
import { SOURCES, sourceName } from './registry.js';

/**
 * Reports shipped in the tier file, with a server's own recorded ones layered
 * over the top. Per source, per spec, per slot -- so a guild can record what
 * Icy Veins says for one spec without touching the file.
 */
export function mergeReports(datasetReports = {}, guildReports = {}) {
  const merged = {};

  for (const sourceId of new Set([...Object.keys(datasetReports), ...Object.keys(guildReports)])) {
    const base = datasetReports[sourceId] ?? {};
    const overlay = guildReports[sourceId] ?? {};
    const specs = { ...(base.specs ?? {}) };

    for (const [specKey, entry] of Object.entries(overlay.specs ?? {})) {
      specs[specKey] = { ...(specs[specKey] ?? {}), ...entry };
    }

    merged[sourceId] = { ...base, ...overlay, specs };
  }

  return merged;
}

/** How two answers are judged the same thing: by slug, or by name if no slug. */
function identity(item) {
  return item?.slug ?? `name:${(item?.name ?? '').trim().toLowerCase()}`;
}

/**
 * What every source says about one spec, slot by slot.
 *
 * @param {object} input
 * @param {object} input.dataset the tier file
 * @param {object} input.spec from the spec catalogue
 * @param {object} [input.reports] merged reports; defaults to the dataset's own
 * @returns {{slots: Record<string, object>, sources: string[]}}
 */
export function compareSpec({ dataset, spec, reports = null }) {
  const all = reports ?? dataset.reports ?? {};
  const present = SOURCES.filter((source) => all[source.id]?.specs?.[spec.key]).map((source) => source.id);

  const slots = {};

  for (const slot of SLOTS) {
    /** @type {Array<{sourceId: string, name: string, item: object, url: string|null, fetchedAt: string|null}>} */
    const opinions = [];

    for (const sourceId of present) {
      const report = all[sourceId];
      const entry = report.specs[spec.key];
      const reference = entry?.[slot];
      if (!reference) continue;

      opinions.push({
        sourceId,
        name: sourceName(sourceId),
        item: resolveItem(dataset, reference),
        url: entry.url ?? report.url ?? null,
        fetchedAt: entry.fetchedAt ?? report.fetchedAt ?? null,
      });
    }

    slots[slot] = { opinions, ...tally(opinions) };
  }

  return { slots, sources: present };
}

/**
 * @returns {{agreement: 'none'|'single'|'unanimous'|'majority'|'split', consensus: object|null, groups: Array}}
 */
export function tally(opinions) {
  if (opinions.length === 0) return { agreement: 'none', consensus: null, groups: [] };

  const byItem = new Map();
  for (const opinion of opinions) {
    const key = identity(opinion.item);
    const group = byItem.get(key) ?? { item: opinion.item, sourceIds: [] };
    group.sourceIds.push(opinion.sourceId);
    byItem.set(key, group);
  }

  const groups = [...byItem.values()].sort((a, b) => b.sourceIds.length - a.sourceIds.length);

  if (opinions.length === 1) {
    return { agreement: 'single', consensus: groups[0].item, groups };
  }

  if (groups.length === 1) {
    return { agreement: 'unanimous', consensus: groups[0].item, groups };
  }

  // A real majority means strictly more than the runner-up. Two against two
  // decides nothing, and pretending otherwise is how a bot ends up confidently
  // wrong.
  const clear = groups[0].sourceIds.length > groups[1].sourceIds.length;

  return {
    agreement: clear ? 'majority' : 'split',
    consensus: clear ? groups[0].item : null,
    groups,
  };
}

/**
 * The consensus per slot, in the shape the resolver wants. Only where the
 * sources actually agree -- a split contributes nothing and falls through to
 * the tier file's own defaults.
 */
export function consensusFor({ dataset, spec, reports = null }) {
  const { slots } = compareSpec({ dataset, spec, reports });
  const answer = {};

  for (const slot of SLOTS) {
    const { agreement, consensus, groups } = slots[slot];
    if (!consensus || agreement === 'split') continue;

    answer[slot] = {
      item: consensus,
      agreement,
      sourceIds: groups[0].sourceIds,
    };
  }

  return answer;
}

/**
 * The secondary stat a source reported for a spec -- which is what picks the
 * flask. Only where the sources agree: two guides naming different stat
 * priorities is a real disagreement, and guessing between them would hand
 * someone the wrong flask.
 */
export function reportedSecondary({ dataset, spec, reports = null }) {
  const all = reports ?? dataset.reports ?? {};
  const named = SOURCES.map((source) => all[source.id]?.specs?.[spec.key]?.secondary).filter(Boolean);

  if (named.length === 0) return null;
  return named.every((value) => value === named[0]) ? named[0] : null;
}

/** Every spec where the guides disagree, for `/consumables compare` with no spec. */
export function disagreements({ dataset, specs, reports = null }) {
  const found = [];

  for (const spec of specs) {
    const { slots } = compareSpec({ dataset, spec, reports });
    const split = SLOTS.filter((slot) => slots[slot].agreement === 'split');
    if (split.length > 0) found.push({ spec, slots: split });
  }

  return found;
}
