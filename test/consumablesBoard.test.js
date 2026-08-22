import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOARD_SLOTS,
  LIMITS,
  SIGNED_MARK,
  boardHash,
  buildBoardEmbed,
  commonSlots,
  embedSize,
  fit,
  signedUpSpecKeys,
  slotText,
  specLine,
} from '../src/consumables/board.js';
import { SPECS, specByKey } from '../src/game/specs.js';
import { resolveSpecConsumables } from '../src/consumables/resolve.js';

// A tier small enough to reason about: one flask that differs by stat, and an
// oil every spec shares, which is the case the board hoists out of the table.
function tier() {
  return {
    tier: { name: 'Test Tier' },
    specs: {},
    defaults: {
      all: { flask: 'Test Flask', food: 'Test Food', potion: 'Test Potion', oil: 'Test Oil' },
    },
    items: {},
    recipes: {},
    reports: {},
  };
}

function raid(overrides = {}) {
  return {
    id: 'raid-1',
    startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    closed: false,
    cancelled: false,
    signups: {},
    ...overrides,
  };
}

describe('signedUpSpecKeys', () => {
  it('collects the specs on the roster', () => {
    const config = {
      raids: {
        'raid-1': raid({
          signups: {
            u1: { status: 'yes', specKey: 'mage.fire' },
            u2: { status: 'late', specKey: 'druid.restoration' },
          },
        }),
      },
    };

    const keys = signedUpSpecKeys(config);
    assert.ok(keys.has('mage.fire'));
    // Late still turns up, and still needs a flask.
    assert.ok(keys.has('druid.restoration'));
  });

  it('marks exactly who the shopping list buys for, and nobody else', () => {
    // The board and `/consumables shopping` must not disagree about who is
    // coming: both follow ROSTER_STATUSES.
    for (const status of ['tentative', 'bench', 'no']) {
      const config = {
        raids: { 'raid-1': raid({ signups: { u1: { status, specKey: 'mage.fire' } } }) },
      };
      assert.equal(signedUpSpecKeys(config).size, 0, `${status} should not be marked`);
    }
  });

  it('ignores closed, cancelled and finished raids', () => {
    const signups = { u1: { status: 'yes', specKey: 'mage.fire' } };

    for (const gone of [
      raid({ signups, closed: true }),
      raid({ signups, cancelled: true }),
      raid({ signups, startsAt: new Date(Date.now() - 3_600_000).toISOString() }),
    ]) {
      assert.equal(signedUpSpecKeys({ raids: { 'raid-1': gone } }).size, 0);
    }
  });

  it('is empty for a server with no raids', () => {
    assert.equal(signedUpSpecKeys({}).size, 0);
    assert.equal(signedUpSpecKeys(undefined).size, 0);
  });
});

describe('slotText', () => {
  it('is null for an empty slot and for one the tier says has no item', () => {
    assert.equal(slotText(undefined), null);
    assert.equal(slotText({ item: null, alternatives: [] }), null);
    assert.equal(slotText({ none: true, item: null, alternatives: [] }), null);
  });

  it('offers the alternative, and drops it when asked to be compact', () => {
    const entry = { item: { name: 'A' }, alternatives: [{ name: 'B' }] };
    assert.equal(slotText(entry), 'A / B');
    assert.equal(slotText(entry, { alternatives: false }), 'A');
  });
});

describe('specLine', () => {
  const resolved = () => resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: tier() });

  it('marks a spec somebody signed up as', () => {
    assert.ok(specLine({ resolved: resolved(), signed: true }).startsWith(SIGNED_MARK));
    assert.ok(!specLine({ resolved: resolved(), signed: false }).startsWith(SIGNED_MARK));
  });

  it('says so rather than going blank when nothing is recorded', () => {
    const empty = resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: { specs: {}, defaults: {} } });
    assert.match(specLine({ resolved: empty }), /nothing recorded/);
  });
});

describe('commonSlots', () => {
  it('hoists a slot every spec answers the same way', () => {
    const all = SPECS.map((spec) => resolveSpecConsumables({ spec, dataset: tier() }));
    const common = commonSlots(all);

    for (const slot of BOARD_SLOTS) assert.equal(common[slot], `Test ${slotName(slot)}`);
  });

  it('leaves a slot alone when one spec differs', () => {
    const dataset = tier();
    dataset.specs = { 'mage.fire': { flask: 'Something Else' } };
    const all = SPECS.map((spec) => resolveSpecConsumables({ spec, dataset }));

    assert.equal(commonSlots(all).flask, undefined);
  });
});

function slotName(slot) {
  return { flask: 'Flask', food: 'Food', potion: 'Potion', oil: 'Oil' }[slot];
}

describe('fit', () => {
  it('keeps whole rows and says how many it dropped', () => {
    const lines = Array.from({ length: 40 }, (_, index) => `row ${index} ${'x'.repeat(60)}`);
    const value = fit(lines, 300);

    assert.ok(value.length <= 300);
    // No half-written item names: every kept line is one of the originals.
    for (const line of value.split('\n').slice(0, -1)) assert.ok(lines.includes(line));
    assert.match(value, /more, see/);
  });

  it('never returns an empty field value', () => {
    assert.equal(fit([], 1024), '_nothing recorded_');
  });
});

describe('buildBoardEmbed', () => {
  it('lists every spec, one field per class', () => {
    const embed = buildBoardEmbed({ dataset: tier() });
    const json = embed.toJSON();
    const text = json.fields.map((field) => field.value).join('\n');

    assert.equal(json.fields.length, 13);
    for (const spec of SPECS) assert.ok(text.includes(`**${spec.name}**`), `${spec.key} is missing`);
  });

  it('stays inside every limit Discord enforces', () => {
    const embed = buildBoardEmbed({ dataset: tier(), signedUp: new Set(SPECS.map((spec) => spec.key)) });
    const json = embed.toJSON();

    assert.ok(json.fields.length <= LIMITS.fields);
    assert.ok(embedSize(embed) <= LIMITS.total);
    for (const field of json.fields) assert.ok(field.value.length <= LIMITS.fieldValue);
  });

  it('stays inside the total even when every item name is absurd', () => {
    const dataset = tier();
    dataset.specs = Object.fromEntries(
      SPECS.map((spec) => [spec.key, { flask: 'F'.repeat(90), food: 'D'.repeat(90), potion: 'P'.repeat(90) }]),
    );

    assert.ok(embedSize(buildBoardEmbed({ dataset })) <= LIMITS.total);
  });

  it('marks only the specs that are signed up', () => {
    const embed = buildBoardEmbed({ dataset: tier(), signedUp: new Set(['mage.fire']) });
    const text = embed.toJSON().fields.map((field) => field.value).join('\n');

    assert.equal(text.split(SIGNED_MARK).length - 1, 1);
    assert.match(text, new RegExp(`${SIGNED_MARK} \\*\\*Fire\\*\\*`));
  });
});

describe('boardHash', () => {
  it('is stable for the same data and moves when the data does', () => {
    const before = buildBoardEmbed({ dataset: tier() });
    assert.equal(boardHash(before), boardHash(buildBoardEmbed({ dataset: tier() })));

    const changed = tier();
    changed.specs = { 'mage.fire': { flask: 'A Different Flask' } };
    assert.notEqual(boardHash(before), boardHash(buildBoardEmbed({ dataset: changed })));
  });

  it('moves when only the signed-up markers change', () => {
    const dataset = tier();
    assert.notEqual(
      boardHash(buildBoardEmbed({ dataset })),
      boardHash(buildBoardEmbed({ dataset, signedUp: new Set(['mage.fire']) })),
    );
  });
});
