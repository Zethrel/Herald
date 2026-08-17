import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applySyncResults,
  craftedQuantity,
  itemsNeedingIds,
  itemsToCraft,
  localized,
  recipeToEntry,
  slugify,
} from '../src/sync/tierSync.js';
import { normalizeDataset } from '../src/consumables/dataset.js';

// Shaped like a real /data/wow/recipe/{id} payload.
const recipePayload = {
  id: 4567,
  name: { en_US: 'Flask of Testing', en_GB: 'Flask of Testing' },
  crafted_item: { id: 999, name: { en_US: 'Flask of Testing' } },
  crafted_quantity: { value: 2 },
  reagents: [
    { reagent: { id: 11, name: { en_US: 'Test Herb' } }, quantity: 3 },
    { reagent: { id: 12, name: { en_US: 'Test Water' } }, quantity: 1 },
  ],
};

describe('slugify', () => {
  it('makes a stable key out of an item name', () => {
    assert.equal(slugify("Flask of the Raider's Might"), 'flask-of-the-raider-s-might');
    assert.equal(slugify('  Test  Herb '), 'test-herb');
  });
});

describe('localized', () => {
  it('takes a plain string or a locale map', () => {
    assert.equal(localized('Test Herb'), 'Test Herb');
    assert.equal(localized({ en_US: 'Test Herb' }), 'Test Herb');
    assert.equal(localized({ de_DE: 'Testkraut' }), 'Testkraut');
    assert.equal(localized(null), null);
  });
});

describe('craftedQuantity', () => {
  it('reads a fixed yield', () => {
    assert.equal(craftedQuantity({ crafted_quantity: { value: 2 } }), 2);
  });

  it('takes the minimum of a variable yield', () => {
    // Assuming the lucky outcome would send someone back to the auction house
    // mid-raid.
    assert.equal(craftedQuantity({ crafted_quantity: { minimum: 2, maximum: 4 } }), 2);
  });

  it('defaults to one when the payload says nothing', () => {
    assert.equal(craftedQuantity({}), 1);
  });
});

describe('itemsNeedingIds / itemsToCraft', () => {
  const dataset = normalizeDataset({
    items: {
      'flask-of-testing': { name: 'Flask of Testing', craft: true },
      'known-item': { name: 'Known Item', itemId: 5 },
      'no-name': { itemId: 6 },
    },
  });

  it('lists only the items with a name and no id', () => {
    assert.deepEqual(itemsNeedingIds(dataset), [
      { slug: 'flask-of-testing', name: 'Flask of Testing' },
    ]);
  });

  it('lists the items flagged for crafting', () => {
    assert.deepEqual(itemsToCraft(dataset), [
      { slug: 'flask-of-testing', name: 'Flask of Testing', recipeId: null },
    ]);
  });
});

describe('recipeToEntry', () => {
  it('reads the yield and the reagents', () => {
    const { recipe, items } = recipeToEntry(recipePayload);

    assert.equal(recipe.yield, 2);
    assert.equal(recipe.recipeId, 4567);
    assert.deepEqual(recipe.reagents, [
      { item: 'test-herb', quantity: 3 },
      { item: 'test-water', quantity: 1 },
    ]);
    assert.deepEqual(items['test-herb'], { name: 'Test Herb', itemId: 11 });
  });

  it('returns nothing for a recipe with no reagents', () => {
    assert.equal(recipeToEntry({ id: 1, reagents: [] }), null);
    assert.equal(recipeToEntry(null), null);
  });
});

describe('applySyncResults', () => {
  const dataset = normalizeDataset({
    tier: { name: 'Test Tier' },
    sources: ['https://example.invalid/guide'],
    items: { 'flask-of-testing': { name: 'Flask of Testing', craft: true } },
    recipes: { 'flask-of-testing': { profession: 'Alchemy', source: 'our alchemist' } },
    defaults: { intellect: { flask: 'flask-of-testing' } },
    specs: { 'mage.fire': { flask: 'flask-of-testing', note: 'ask Steve' } },
  });

  const results = [
    { kind: 'itemId', slug: 'flask-of-testing', itemId: 999 },
    { kind: 'recipe', slug: 'flask-of-testing', ...recipeToEntry(recipePayload) },
  ];

  it('fills ids, recipes and the reagent items they mention', () => {
    const { dataset: next, report } = applySyncResults(dataset, results);

    assert.equal(next.items['flask-of-testing'].itemId, 999);
    assert.equal(next.recipes['flask-of-testing'].yield, 2);
    assert.equal(next.items['test-herb'].itemId, 11);
    assert.equal(report.ids.length, 1);
    assert.equal(report.recipes.length, 1);
    assert.equal(report.reagents.length, 2);
  });

  it('never touches the judgement half', () => {
    const { dataset: next } = applySyncResults(dataset, results);

    assert.deepEqual(next.specs, dataset.specs);
    assert.deepEqual(next.defaults, dataset.defaults);
    assert.deepEqual(next.sources, dataset.sources);
    // Profession and source on a recipe are human-set and survive a sync.
    assert.equal(next.recipes['flask-of-testing'].profession, 'Alchemy');
    assert.equal(next.recipes['flask-of-testing'].source, 'our alchemist');
  });

  it('does not mutate the dataset it was given', () => {
    applySyncResults(dataset, results);

    assert.equal(dataset.items['flask-of-testing'].itemId, undefined);
    assert.equal(dataset.items['test-herb'], undefined);
  });

  it('keeps a hand-written id when the search disagrees, and says so', () => {
    const pinned = normalizeDataset({
      items: { 'flask-of-testing': { name: 'Flask of Testing', itemId: 12345 } },
    });

    const { dataset: next, report } = applySyncResults(pinned, [
      { kind: 'itemId', slug: 'flask-of-testing', itemId: 999 },
    ]);

    assert.equal(next.items['flask-of-testing'].itemId, 12345);
    assert.deepEqual(report.conflicts, [{ slug: 'flask-of-testing', kept: 12345, found: 999 }]);
  });

  it('leaves a reagent alone once it has an id', () => {
    const known = normalizeDataset({
      items: { 'test-herb': { name: 'Our Name For It', itemId: 11 } },
    });

    const { dataset: next, report } = applySyncResults(known, [
      { kind: 'recipe', slug: 'flask-of-testing', ...recipeToEntry(recipePayload) },
    ]);

    assert.equal(next.items['test-herb'].name, 'Our Name For It');
    assert.equal(report.reagents.length, 1); // Only test-water was new.
  });

  it('records what it could not find', () => {
    const { report } = applySyncResults(dataset, [
      { kind: 'miss', slug: 'missing-thing', reason: 'no item named "Missing Thing"' },
    ]);

    assert.deepEqual(report.misses, [
      { slug: 'missing-thing', reason: 'no item named "Missing Thing"' },
    ]);
  });
});
