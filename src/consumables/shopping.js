// Turning a roster into a shopping list, and a shopping list into reagents.
//
// Pure arithmetic over the tier file. The part worth getting right is the
// crafting maths: recipes yield more than one flask per craft, so the reagent
// count is driven by whole crafts, not by the number of flasks wanted -- ask
// for 25 flasks from a recipe that yields 2 and you buy mats for 13 crafts.

import { REQUIRED_SLOTS, SLOTS, isAnswered, resolveItem } from './dataset.js';
import { resolveSpecConsumables } from './resolve.js';

/**
 * Parse what someone types into `/consumables shopping`:
 *
 *   "4x fire mage, 2 holy priest, boomkin"
 *   "3 prot warr; 2 resto sham"
 *
 * Entries that cannot be matched come back in `unknown` rather than being
 * dropped, so the reply can say which ones were not understood.
 */
export function parseRoster(text, { findSpec }) {
  const entries = [];
  const unknown = [];

  for (const chunk of (text ?? '').split(/[,;\n]+/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\d+)\s*[x×*]?\s+(.+)$/) ?? trimmed.match(/^(\d+)[x×*](.+)$/);
    const count = match ? Number.parseInt(match[1], 10) : 1;
    const name = match ? match[2].trim() : trimmed;

    const spec = findSpec(name);
    if (!spec) {
      unknown.push(name);
      continue;
    }

    // The same spec listed twice adds up rather than replacing.
    const existing = entries.find((entry) => entry.spec.key === spec.key);
    if (existing) existing.count += count;
    else entries.push({ spec, count });
  }

  return { entries, unknown };
}

/**
 * The three a raid buys in bulk, and the numbers a raid night actually goes
 * through. The other slots are deliberately absent rather than set to zero:
 * a weapon oil lasts an evening, an augment rune lasts an hour, and a health
 * potion is whatever someone already has in their bags -- guessing at how many
 * of those to buy would put gold on the list that nobody asked for. Anything
 * with a number here gets bought; anything without is left to the raider.
 */
export const DEFAULT_PER_RAIDER = { flask: 1, food: 2, potion: 8 };

/**
 * @param {object} input
 * @param {Array<{spec: object, count: number}>} input.roster
 * @param {object} input.dataset
 * @param {object} [input.overrides] this server's overrides
 * @param {{flask: number, food: number, potion: number}} [input.perRaider]
 */
export function buildShoppingList({
  roster,
  dataset,
  overrides = {},
  perRaider = DEFAULT_PER_RAIDER,
  reports = null,
}) {
  /** @type {Map<string, {slug: string|null, name: string, quantity: number, slots: Set<string>}>} */
  const wanted = new Map();
  const missingSlots = [];

  for (const { spec, count } of roster) {
    const resolved = resolveSpecConsumables({ spec, dataset, overrides, reports });
    const empty = [];

    for (const slot of SLOTS) {
      const { item } = resolved.slots[slot];
      if (!item) {
        // Only the four a raider is expected to bring. An optional slot nobody
        // filled in is not a hole in the list, and `none` is an answer.
        if (REQUIRED_SLOTS.includes(slot) && !isAnswered(resolved.slots[slot])) empty.push(slot);
        continue;
      }

      const perHead = perRaider[slot] ?? 0;
      if (perHead <= 0) continue;

      // Key on the slug where there is one, so two names for the same item do
      // not become two lines.
      const key = item.slug ?? `name:${item.name.toLowerCase()}`;
      const entry = wanted.get(key) ?? { slug: item.slug, name: item.name, quantity: 0, slots: new Set() };
      entry.quantity += perHead * count;
      entry.slots.add(slot);
      wanted.set(key, entry);
    }

    if (empty.length > 0) {
      // A missing flask usually has one cause -- nobody has recorded what the
      // spec stacks -- and saying so turns a shrug into a one-command fix.
      missingSlots.push({ spec, slots: empty, noSecondary: resolved.secondary.length === 0 });
    }
  }

  const crafts = [];
  const buy = [];
  /** @type {Map<string, {name: string, quantity: number}>} */
  const reagents = new Map();

  for (const entry of wanted.values()) {
    const recipe = entry.slug ? dataset.recipes?.[entry.slug] : null;

    if (!recipe || !Array.isArray(recipe.reagents) || recipe.reagents.length === 0) {
      buy.push({ name: entry.name, quantity: entry.quantity, slug: entry.slug });
      continue;
    }

    const yieldPerCraft = recipe.yield > 0 ? recipe.yield : 1;
    const craftCount = Math.ceil(entry.quantity / yieldPerCraft);

    crafts.push({
      slug: entry.slug,
      name: entry.name,
      quantity: entry.quantity,
      crafts: craftCount,
      yield: yieldPerCraft,
      profession: recipe.profession ?? null,
      // What the extra crafts leave over, so nobody wonders why the numbers
      // do not divide evenly.
      surplus: craftCount * yieldPerCraft - entry.quantity,
    });

    for (const reagent of recipe.reagents) {
      const item = resolveItem(dataset, reagent.item);
      if (!item) continue;
      const key = item.slug ?? `name:${item.name.toLowerCase()}`;
      const running = reagents.get(key) ?? { name: item.name, quantity: 0 };
      running.quantity += (reagent.quantity ?? 0) * craftCount;
      reagents.set(key, running);
    }
  }

  const byQuantityThenName = (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name);

  return {
    consumables: [...wanted.values()]
      .map((entry) => ({ ...entry, slots: [...entry.slots] }))
      .sort(byQuantityThenName),
    crafts: crafts.sort(byQuantityThenName),
    reagents: [...reagents.values()].sort(byQuantityThenName),
    buy: buy.sort(byQuantityThenName),
    missingSlots,
    raiders: roster.reduce((total, entry) => total + entry.count, 0),
    perRaider,
  };
}
