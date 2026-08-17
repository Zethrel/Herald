import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SPECS, SPEC_KEYS, findSpec, specByKey } from '../src/game/specs.js';
import { coverage, isStale, normalizeDataset, resolveItem } from '../src/consumables/dataset.js';
import { buildShoppingList, parseRoster } from '../src/consumables/shopping.js';
import { gaps, resolveSpecConsumables } from '../src/consumables/resolve.js';

const dataset = normalizeDataset({
  tier: { name: 'Test Tier', patch: '0.0.1' },
  updatedAt: new Date().toISOString(),
  items: {
    'flask-int': { name: 'Flask of Intellect', itemId: 111 },
    'flask-agi': { name: 'Flask of Agility', itemId: 222 },
    'feast-of-testing': { name: 'Feast of Testing', itemId: 333 },
    'potion-int': { name: 'Potion of Intellect', itemId: 444 },
    'test-oil': { name: 'Test Oil', itemId: 555 },
    'herb-a': { name: 'Herb A' },
    'herb-b': { name: 'Herb B' },
  },
  recipes: {
    'flask-int': {
      profession: 'Alchemy',
      yield: 2,
      reagents: [
        { item: 'herb-a', quantity: 3 },
        { item: 'herb-b', quantity: 1 },
      ],
    },
    'potion-int': { profession: 'Alchemy', yield: 3, reagents: [{ item: 'herb-a', quantity: 2 }] },
  },
  defaults: {
    intellect: { flask: 'flask-int', potion: 'potion-int' },
    agility: { flask: 'flask-agi' },
    healer: { food: 'feast-of-testing' },
  },
  specs: {
    'mage.fire': {
      flask: 'flask-int',
      food: 'feast-of-testing',
      potion: 'potion-int',
      oil: 'test-oil',
      source: 'a sim',
    },
  },
});

describe('the spec catalogue', () => {
  it('covers every class with unique keys', () => {
    assert.equal(new Set(SPEC_KEYS).size, SPEC_KEYS.length);
    assert.equal(new Set(SPECS.map((spec) => spec.className)).size, 13);
    assert.equal(SPECS.length, 39);
  });

  it('gives every spec a role and a primary stat', () => {
    assert.ok(SPECS.every((spec) => spec.role && spec.stat));
  });
});

describe('findSpec', () => {
  it('takes the forms people actually type', () => {
    for (const text of ['mage.fire', 'fire mage', 'Fire Mage', 'MAGE FIRE']) {
      assert.equal(findSpec(text)?.key, 'mage.fire', text);
    }
  });

  it('knows the common nicknames', () => {
    assert.equal(findSpec('boomkin')?.key, 'druid.balance');
    assert.equal(findSpec('ww monk')?.key, 'monk.windwalker');
    assert.equal(findSpec('prot warr')?.key, 'warrior.protection');
  });

  it('refuses to guess when a name is ambiguous', () => {
    // Frost is a Mage and a Death Knight; Holy is a Paladin and a Priest.
    // Guessing here would hand someone the wrong flask.
    assert.equal(findSpec('frost'), null);
    assert.equal(findSpec('holy'), null);
    assert.equal(findSpec('protection'), null);
  });

  it('accepts a bare spec name when only one class has it', () => {
    assert.equal(findSpec('windwalker')?.key, 'monk.windwalker');
  });

  it('returns null for nonsense', () => {
    assert.equal(findSpec('bard'), null);
    assert.equal(findSpec(''), null);
  });
});

describe('resolveSpecConsumables', () => {
  it('prefers the spec entry, and says so', () => {
    const resolved = resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset });

    assert.equal(resolved.slots.flask.item.name, 'Flask of Intellect');
    assert.equal(resolved.slots.flask.via, 'spec');
    assert.equal(resolved.complete, true);
    assert.equal(resolved.source, 'a sim');
  });

  it('falls back to the primary-stat default, and marks it as a default', () => {
    const resolved = resolveSpecConsumables({ spec: specByKey('warlock.affliction'), dataset });

    assert.equal(resolved.slots.flask.item.name, 'Flask of Intellect');
    assert.equal(resolved.slots.flask.via, 'default:intellect');
  });

  it('falls back to the role default when the stat default has nothing', () => {
    const resolved = resolveSpecConsumables({ spec: specByKey('priest.holy'), dataset });

    assert.equal(resolved.slots.food.item.name, 'Feast of Testing');
    assert.equal(resolved.slots.food.via, 'default:healer');
  });

  it('prefers the role default over the stat default', () => {
    // Every healer is an intellect user, so a healer line that lost to an
    // intellect line could never apply to anyone.
    const withBoth = normalizeDataset({
      ...dataset,
      defaults: {
        ...dataset.defaults,
        intellect: { ...dataset.defaults.intellect, food: 'flask-int' },
        healer: { food: 'feast-of-testing' },
      },
    });

    const healer = resolveSpecConsumables({ spec: specByKey('priest.holy'), dataset: withBoth });
    assert.equal(healer.slots.food.via, 'default:healer');

    // A caster that is not a healer still gets the intellect line.
    const caster = resolveSpecConsumables({ spec: specByKey('mage.frost'), dataset: withBoth });
    assert.equal(caster.slots.food.via, 'default:intellect');
  });

  it('reports an empty slot instead of inventing one', () => {
    const resolved = resolveSpecConsumables({ spec: specByKey('rogue.outlaw'), dataset });

    assert.equal(resolved.slots.flask.item.name, 'Flask of Agility');
    assert.equal(resolved.slots.food.item, null);
    assert.equal(resolved.slots.food.via, null);
    assert.equal(resolved.complete, false);
  });

  it("lets a server's override win over everything", () => {
    const resolved = resolveSpecConsumables({
      spec: specByKey('mage.fire'),
      dataset,
      overrides: { 'mage.fire': { flask: 'Something Our Guild Prefers' } },
    });

    assert.equal(resolved.slots.flask.item.name, 'Something Our Guild Prefers');
    assert.equal(resolved.slots.flask.via, 'guild');
    // The slots it did not override are untouched.
    assert.equal(resolved.slots.potion.via, 'spec');
  });

  it('handles a free-text item that is not in the item table', () => {
    const item = resolveItem(dataset, 'Some Unlisted Flask');
    assert.deepEqual(item, { slug: null, name: 'Some Unlisted Flask', itemId: null, wowhead: null });
  });
});

describe('gaps', () => {
  it('lists the specs that still have nothing', () => {
    const missing = gaps({ specs: SPECS, dataset });
    const keys = missing.map((entry) => entry.spec.key);

    assert.ok(!keys.includes('mage.fire'));
    assert.ok(keys.includes('rogue.outlaw'));
  });
});

describe('coverage and staleness', () => {
  it('counts specs with an entry of their own', () => {
    assert.deepEqual(coverage(dataset, SPEC_KEYS), {
      filled: 1,
      total: SPEC_KEYS.length,
      missing: SPEC_KEYS.length - 1,
    });
  });

  it('treats undated data as stale', () => {
    assert.equal(isStale(normalizeDataset({})), true);
  });

  it('treats data older than the window as stale', () => {
    const old = normalizeDataset({ updatedAt: '2020-01-01T00:00:00Z', staleAfterDays: 90 });
    assert.equal(isStale(old), true);
    assert.equal(isStale(dataset), false);
  });
});

describe('parseRoster', () => {
  it('reads counts in the forms people write them', () => {
    const { entries } = parseRoster('4x fire mage, 2 holy priest; boomkin', { findSpec });

    assert.deepEqual(
      entries.map((entry) => [entry.spec.key, entry.count]),
      [
        ['mage.fire', 4],
        ['priest.holy', 2],
        ['druid.balance', 1],
      ],
    );
  });

  it('adds up a spec listed more than once', () => {
    const { entries } = parseRoster('2 fire mage, 3 fire mage', { findSpec });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].count, 5);
  });

  it('keeps what it could not read instead of dropping it', () => {
    const { entries, unknown } = parseRoster('4x fire mage, 2 bards', { findSpec });

    assert.equal(entries.length, 1);
    assert.deepEqual(unknown, ['bards']);
  });
});

describe('buildShoppingList', () => {
  const roster = [{ spec: specByKey('mage.fire'), count: 4 }];

  it('multiplies consumables out across the roster', () => {
    const list = buildShoppingList({
      roster,
      dataset,
      perRaider: { flask: 2, food: 1, potion: 5 },
    });

    const flask = list.consumables.find((entry) => entry.slug === 'flask-int');
    assert.equal(flask.quantity, 8);
    assert.equal(list.raiders, 4);
  });

  it('buys reagents by whole crafts, not by flasks wanted', () => {
    // 9 flasks from a recipe yielding 2 is 5 crafts, not 4.5 -- and 5 crafts
    // means 15 Herb A, with one flask spare.
    const list = buildShoppingList({
      roster: [{ spec: specByKey('mage.fire'), count: 9 }],
      dataset,
      perRaider: { flask: 1, food: 0, potion: 0 },
    });

    const craft = list.crafts.find((entry) => entry.slug === 'flask-int');
    assert.equal(craft.crafts, 5);
    assert.equal(craft.surplus, 1);
    assert.deepEqual(
      list.reagents.map((entry) => [entry.name, entry.quantity]),
      [
        ['Herb A', 15],
        ['Herb B', 5],
      ],
    );
  });

  it('adds reagents up across different recipes', () => {
    const list = buildShoppingList({
      roster: [{ spec: specByKey('mage.fire'), count: 2 }],
      dataset,
      perRaider: { flask: 2, food: 0, potion: 6 },
    });

    // Flasks: 4 wanted, yield 2 -> 2 crafts -> 6 Herb A.
    // Potions: 12 wanted, yield 3 -> 4 crafts -> 8 Herb A.
    const herbA = list.reagents.find((entry) => entry.name === 'Herb A');
    assert.equal(herbA.quantity, 14);
  });

  it('separates items it has no recipe for', () => {
    const list = buildShoppingList({
      roster,
      dataset,
      perRaider: { flask: 0, food: 2, potion: 0 },
    });

    assert.deepEqual(list.buy, [{ name: 'Feast of Testing', quantity: 8, slug: 'feast-of-testing' }]);
    assert.deepEqual(list.reagents, []);
  });

  it('reports specs it could not fully answer for instead of silently short-changing them', () => {
    const list = buildShoppingList({
      roster: [{ spec: specByKey('rogue.outlaw'), count: 3 }],
      dataset,
    });

    assert.deepEqual(list.missingSlots, [
      { spec: specByKey('rogue.outlaw'), slots: ['food', 'potion', 'oil'] },
    ]);
    assert.equal(list.consumables.length, 1);
  });

  it('skips a slot the raid is not taking', () => {
    const list = buildShoppingList({ roster, dataset, perRaider: { flask: 1, food: 0, potion: 0 } });

    assert.equal(list.consumables.length, 1);
    assert.equal(list.consumables[0].slug, 'flask-int');
  });
});

describe('flasks follow the secondary stat', () => {
  // Modern flasks give a secondary, so the flask cannot be derived from the
  // class the way a main-stat potion can. A spec declares what it stacks and
  // the flask follows; without that declaration there is no flask to give.
  const tier = normalizeDataset({
    items: {
      'flask-crit': { name: 'Flask of the Shattered Sun' },
      'flask-mastery': { name: 'Flask of the Magisters' },
      'crit-oil': { name: 'Thalassian Phoenix Oil' },
      feast: { name: 'Harandar Celebration' },
      'main-potion': { name: "Light's Potential" },
      reckless: { name: 'Potion of Recklessness' },
    },
    defaults: {
      all: { food: 'feast', potion: 'main-potion' },
      crit: { flask: 'flask-crit', oil: 'crit-oil' },
      mastery: { flask: 'flask-mastery' },
    },
    specs: {
      'mage.fire': { secondary: 'mastery' },
      'mage.frost': { secondary: 'crit' },
      'warrior.protection': { secondary: 'crit', potion: 'reckless' },
    },
  });

  it('picks the flask from the declared secondary', () => {
    const fire = resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: tier });

    assert.equal(fire.secondary, 'mastery');
    assert.equal(fire.slots.flask.item.name, 'Flask of the Magisters');
    assert.equal(fire.slots.flask.via, 'default:mastery');
  });

  it('gives no flask at all when no secondary is declared', () => {
    // The honest answer. Handing an unstated spec a flask would be picking a
    // stat priority on their behalf.
    const rogue = resolveSpecConsumables({ spec: specByKey('rogue.outlaw'), dataset: tier });

    assert.equal(rogue.secondary, null);
    assert.equal(rogue.slots.flask.item, null);
  });

  it('takes the weapon oil from the same block, and leaves it empty where there is none', () => {
    const frost = resolveSpecConsumables({ spec: specByKey('mage.frost'), dataset: tier });
    assert.equal(frost.slots.oil.item.name, 'Thalassian Phoenix Oil');

    // No mastery oil exists, so a mastery spec gets none rather than the crit one.
    const fire = resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: tier });
    assert.equal(fire.slots.oil.item, null);
  });

  it('answers food and the main-stat potion for everyone from `all`', () => {
    for (const key of ['mage.fire', 'rogue.outlaw', 'warrior.arms']) {
      const resolved = resolveSpecConsumables({ spec: specByKey(key), dataset: tier });
      assert.equal(resolved.slots.food.item.name, 'Harandar Celebration', key);
      assert.equal(resolved.slots.food.via, 'default:all', key);
    }
  });

  it('lets a spec override the shared potion', () => {
    const prot = resolveSpecConsumables({ spec: specByKey('warrior.protection'), dataset: tier });

    assert.equal(prot.slots.potion.item.name, 'Potion of Recklessness');
    assert.equal(prot.slots.potion.via, 'spec');
    // …without disturbing the flask it gets from its secondary.
    assert.equal(prot.slots.flask.item.name, 'Flask of the Shattered Sun');
  });

  it("lets a server's own choice of secondary win", () => {
    const resolved = resolveSpecConsumables({
      spec: specByKey('mage.fire'),
      dataset: tier,
      overrides: { 'mage.fire': { secondary: 'crit' } },
    });

    assert.equal(resolved.secondary, 'crit');
    assert.equal(resolved.slots.flask.item.name, 'Flask of the Shattered Sun');
  });
});
