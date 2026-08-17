// Turning Blizzard's responses into tier data.
//
// Pure, and tested against fixtures shaped like the real payloads. The rule
// this file exists to enforce: the sync fills in facts (item ids, recipe
// reagents, craft yields) and never touches judgement (which flask a spec
// wants, the notes, the sources). A human's entry is never overwritten by a
// machine's guess -- worst case the sync reports a disagreement and leaves the
// human's version in place.

export function slugify(name) {
  return (name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Localised strings come back as a string or as a {en_US: …} map. */
export function localized(value, locale = 'en_US') {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value[locale] ?? value.en_US ?? Object.values(value)[0] ?? null;
}

/** Items in the tier file that still need an id looked up. */
export function itemsNeedingIds(dataset) {
  return Object.entries(dataset.items ?? {})
    .filter(([, item]) => item?.name && !item.itemId)
    .map(([slug, item]) => ({ slug, name: item.name }));
}

/** Items flagged `"craft": true` — the ones a recipe should be fetched for. */
export function itemsToCraft(dataset) {
  return Object.entries(dataset.items ?? {})
    .filter(([, item]) => item?.craft && item?.name)
    .map(([slug, item]) => ({ slug, name: item.name, recipeId: item.recipeId ?? null }));
}

/**
 * How many the recipe makes. Blizzard writes this as `{value}` on a fixed
 * recipe and `{minimum, maximum}` on a variable one; a variable yield is taken
 * at its minimum, because a shopping list that assumes the lucky outcome sends
 * someone back to the auction house.
 */
export function craftedQuantity(recipe) {
  const quantity = recipe?.crafted_quantity;
  if (typeof quantity === 'number') return quantity;
  if (quantity?.value != null) return quantity.value;
  if (quantity?.minimum != null) return quantity.minimum;
  return 1;
}

/**
 * A recipe payload becomes a tier `recipes` entry plus any reagent items the
 * file did not know about yet.
 *
 * @returns {{recipe: object, items: Record<string, object>}|null}
 */
export function recipeToEntry(payload, { locale = 'en_US' } = {}) {
  if (!payload) return null;

  const reagents = payload.reagents ?? [];
  if (reagents.length === 0) return null;

  const items = {};
  const mapped = [];

  for (const line of reagents) {
    const name = localized(line?.reagent?.name, locale);
    if (!name) continue;

    const slug = slugify(name);
    items[slug] = { name, itemId: line.reagent.id ?? null };
    mapped.push({ item: slug, quantity: line.quantity ?? 1 });
  }

  if (mapped.length === 0) return null;

  return {
    recipe: {
      recipeId: payload.id ?? null,
      yield: craftedQuantity(payload),
      reagents: mapped,
      syncedAt: new Date().toISOString(),
    },
    items,
  };
}

/**
 * Fold sync results into the dataset.
 *
 * `results` is a list of:
 *   {kind: 'itemId', slug, itemId, name}
 *   {kind: 'recipe', slug, recipe, items}
 *   {kind: 'miss',   slug, reason}
 *
 * Returns a new dataset and a report. Nothing is mutated, and human-set fields
 * survive: a recipe's `profession` and `source` are carried over from whatever
 * was already there.
 */
export function applySyncResults(dataset, results) {
  const items = { ...(dataset.items ?? {}) };
  const recipes = { ...(dataset.recipes ?? {}) };
  const report = { ids: [], recipes: [], reagents: [], misses: [], conflicts: [] };

  for (const result of results) {
    if (result.kind === 'miss') {
      report.misses.push({ slug: result.slug, reason: result.reason });
      continue;
    }

    if (result.kind === 'itemId') {
      const existing = items[result.slug] ?? {};

      if (existing.itemId && existing.itemId !== result.itemId) {
        // Someone typed an id by hand and the search disagrees. Theirs wins.
        report.conflicts.push({
          slug: result.slug,
          kept: existing.itemId,
          found: result.itemId,
        });
        continue;
      }

      items[result.slug] = { ...existing, itemId: result.itemId };
      report.ids.push({ slug: result.slug, itemId: result.itemId });
      continue;
    }

    if (result.kind === 'recipe') {
      for (const [slug, item] of Object.entries(result.items ?? {})) {
        if (items[slug]?.itemId) continue; // Already known; leave it alone.
        items[slug] = { ...(items[slug] ?? {}), ...item };
        report.reagents.push({ slug, name: item.name });
      }

      const existing = recipes[result.slug] ?? {};
      recipes[result.slug] = {
        ...result.recipe,
        // Judgement, not fact: the sync cannot work these out, so whatever a
        // human wrote stays.
        profession: existing.profession ?? result.recipe.profession ?? null,
        source: existing.source ?? null,
      };
      report.recipes.push({
        slug: result.slug,
        yield: result.recipe.yield,
        reagents: result.recipe.reagents.length,
      });
    }
  }

  return {
    dataset: { ...dataset, items, recipes },
    report,
  };
}

/** A one-line summary per section, for the CLI to print. */
export function summarize(report) {
  return [
    `item ids filled: ${report.ids.length}`,
    `recipes written: ${report.recipes.length}`,
    `new reagent items: ${report.reagents.length}`,
    `not found: ${report.misses.length}`,
    `left alone (you set them): ${report.conflicts.length}`,
  ];
}
