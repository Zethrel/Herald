import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOARD_SLOTS,
  LIMITS,
  boardHash,
  buildBoardEmbed,
  commonSlots,
  embedSize,
  SLOT_ICONS,
  openRaids,
  rosterLine,
  rosterSpecs,
  slotText,
  spill,
} from '../src/consumables/board.js';
import { resolveSpecConsumables } from '../src/consumables/resolve.js';
import { SPECS, specByKey } from '../src/game/specs.js';

const HOUR = 3_600_000;

// A tier small enough to reason about: one answer for everybody, so anything
// the board does differently per spec is the board's doing and not the data's.
function tier(specs = {}) {
  return {
    tier: { name: 'Test Tier' },
    specs,
    defaults: { all: { flask: 'Test Flask', food: 'Test Food', potion: 'Test Potion', oil: 'Test Oil' } },
    items: {},
    recipes: {},
    reports: {},
  };
}

function raid(overrides = {}) {
  return {
    id: 'raid-1',
    title: 'Test Raid',
    startsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    closed: false,
    cancelled: false,
    signups: {},
    ...overrides,
  };
}

function signups(...pairs) {
  return Object.fromEntries(
    pairs.map(([status, specKey], index) => [`user-${index}`, { status, specKey }]),
  );
}

describe('openRaids', () => {
  it('drops closed, cancelled and finished raids', () => {
    const config = {
      raids: {
        a: raid({ id: 'a', closed: true }),
        b: raid({ id: 'b', cancelled: true }),
        c: raid({ id: 'c', startsAt: new Date(Date.now() - HOUR).toISOString() }),
        d: raid({ id: 'd' }),
      },
    };

    assert.deepEqual(openRaids(config).map((entry) => entry.id), ['d']);
  });

  it('lists the soonest first', () => {
    const config = {
      raids: {
        later: raid({ id: 'later', startsAt: new Date(Date.now() + 72 * HOUR).toISOString() }),
        sooner: raid({ id: 'sooner', startsAt: new Date(Date.now() + 2 * HOUR).toISOString() }),
      },
    };

    assert.deepEqual(openRaids(config).map((entry) => entry.id), ['sooner', 'later']);
  });

  it('is empty rather than undefined for a server with no raids', () => {
    assert.deepEqual(openRaids({}), []);
    assert.deepEqual(openRaids(undefined), []);
  });
});

describe('rosterSpecs', () => {
  it('counts people rather than repeating the spec', () => {
    const rows = rosterSpecs(raid({ signups: signups(['yes', 'mage.fire'], ['yes', 'mage.fire']) }));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 2);
    assert.equal(rows[0].spec.key, 'mage.fire');
  });

  it('takes exactly the statuses the shopping list buys for', () => {
    const rows = rosterSpecs(
      raid({
        signups: signups(
          ['yes', 'mage.fire'],
          ['late', 'priest.holy'],
          ['tentative', 'druid.balance'],
          ['bench', 'rogue.subtlety'],
          ['no', 'warrior.arms'],
        ),
      }),
    );

    assert.deepEqual(rows.map((row) => row.spec.key).sort(), ['mage.fire', 'priest.holy']);
  });

  it('orders tanks, then healers, then melee, then ranged', () => {
    const rows = rosterSpecs(
      raid({
        signups: signups(
          ['yes', 'mage.fire'],
          ['yes', 'warrior.protection'],
          ['yes', 'rogue.subtlety'],
          ['yes', 'priest.holy'],
        ),
      }),
    );

    assert.deepEqual(rows.map((row) => row.spec.role), ['tank', 'healer', 'melee', 'ranged']);
  });

  it('ignores a signup with no spec picked', () => {
    assert.deepEqual(rosterSpecs(raid({ signups: signups(['yes', null]) })), []);
  });
});

describe('slotText', () => {
  it('is null for an empty slot and for one the tier says has no item', () => {
    assert.equal(slotText(undefined), null);
    assert.equal(slotText({ item: null, alternatives: [] }), null);
    assert.equal(slotText({ none: true, item: null, alternatives: [] }), null);
  });

  it('leaves the alternative out unless asked for it', () => {
    const entry = { item: { name: 'A' }, alternatives: [{ name: 'B' }] };

    assert.equal(slotText(entry), 'A');
    assert.equal(slotText(entry, { alternatives: true }), 'A / B');
  });
});

describe('rosterLine', () => {
  const row = (count) => ({
    spec: specByKey('mage.fire'),
    count,
    resolved: resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: tier() }),
    slots: BOARD_SLOTS,
  });

  it('counts only when there is more than one', () => {
    assert.ok(!rosterLine(row(1)).includes('×'));
    assert.match(rosterLine(row(4)), /×4/);
  });

  it('says so rather than going blank when nothing is recorded', () => {
    assert.match(
      rosterLine({
        spec: specByKey('mage.fire'),
        count: 1,
        resolved: resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: { specs: {}, defaults: {} } }),
        slots: BOARD_SLOTS,
      }),
      /nothing recorded/,
    );
  });
});

describe('commonSlots', () => {
  const resolvedFor = (keys, dataset) =>
    keys.map((key) => resolveSpecConsumables({ spec: specByKey(key), dataset }));

  it('hoists a slot everybody answers the same way, and says everybody', () => {
    const common = commonSlots(resolvedFor(['mage.fire', 'priest.holy', 'warrior.arms'], tier()));

    assert.equal(common.flask.text, 'Test Flask');
    assert.equal(common.flask.all, true);
  });

  it('still hoists past a gap, but stops claiming everybody', () => {
    const dataset = tier({ 'mage.fire': { oil: 'none' } });
    const common = commonSlots(resolvedFor(['mage.fire', 'priest.holy', 'warrior.arms'], dataset));

    assert.equal(common.oil.text, 'Test Oil');
    assert.equal(common.oil.all, false);
  });

  it('leaves a slot on the rows when one spec disagrees', () => {
    const dataset = tier({ 'mage.fire': { flask: 'Something Else' } });

    assert.equal(commonSlots(resolvedFor(['mage.fire', 'priest.holy'], dataset)).flask, undefined);
  });

  it('leaves a slot on the rows when only a minority answers it', () => {
    const dataset = tier({});
    dataset.defaults = {};
    dataset.specs = { 'mage.fire': { oil: 'Lonely Oil' } };
    const common = commonSlots(resolvedFor(['mage.fire', 'priest.holy', 'warrior.arms', 'rogue.subtlety'], dataset));

    assert.equal(common.oil, undefined);
  });

  it('is empty for an empty roster', () => {
    assert.deepEqual(commonSlots([]), {});
  });
});

describe('spill', () => {
  it('splits a roster too long for one field instead of dropping people', () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index} ${'x'.repeat(80)}`);
    const fields = spill('Raid', lines);

    assert.ok(fields.length > 1);
    for (const field of fields) assert.ok(field.value.length <= LIMITS.fieldValue);

    const joined = fields.map((field) => field.value).join('\n').split('\n');
    assert.deepEqual(joined, lines);
  });

  it('names the first field for the raid and continues the rest', () => {
    const fields = spill('Raid', Array.from({ length: 30 }, () => 'x'.repeat(100)));

    assert.equal(fields[0].name, 'Raid');
    for (const field of fields.slice(1)) assert.equal(field.name, '⤷');
  });

  it('never returns an empty field value', () => {
    assert.equal(spill('Raid', [])[0].value, '—');
  });
});

describe('buildBoardEmbed', () => {
  const config = (...raids) => ({ raids: Object.fromEntries(raids.map((entry) => [entry.id, entry])) });

  it('says nothing is on rather than listing every spec', () => {
    const json = buildBoardEmbed({ dataset: tier(), config: {} }).toJSON();

    assert.match(json.description, /Nothing is signed up/);
    assert.equal(json.fields ?? undefined, undefined);
  });

  it('gives each open raid its own field', () => {
    const json = buildBoardEmbed({
      dataset: tier(),
      config: config(
        raid({ id: 'a', title: 'First', signups: signups(['yes', 'mage.fire']) }),
        raid({
          id: 'b',
          title: 'Second',
          startsAt: new Date(Date.now() + 48 * HOUR).toISOString(),
          signups: signups(['yes', 'priest.holy']),
        }),
      ),
    }).toJSON();

    assert.deepEqual(json.fields.map((field) => field.name), ['First', 'Second']);
  });

  it('lists only the specs signed up', () => {
    const json = buildBoardEmbed({
      dataset: tier(),
      config: config(raid({ signups: signups(['yes', 'mage.fire']) })),
    }).toJSON();

    const text = json.fields.map((field) => field.value).join('\n');
    assert.match(text, /Fire Mage/);
    assert.ok(!text.includes('Blood Death Knight'));
  });

  it('stays inside every limit Discord enforces, at three full raids', () => {
    const everybody = signups(
      ...SPECS.map((spec) => ['yes', spec.key]),
      ...SPECS.map((spec) => ['yes', spec.key]),
    );

    const embed = buildBoardEmbed({
      dataset: tier(),
      config: config(
        // A title past Discord's field-name ceiling, on purpose.
        raid({ id: 'a', title: 'A'.repeat(400), signups: everybody }),
        raid({ id: 'b', title: 'B', startsAt: new Date(Date.now() + 48 * HOUR).toISOString(), signups: everybody }),
        raid({ id: 'c', title: 'C', startsAt: new Date(Date.now() + 72 * HOUR).toISOString(), signups: everybody }),
      ),
    });

    const json = embed.toJSON();
    assert.ok(json.fields.length <= LIMITS.fields, `${json.fields.length} fields`);
    assert.ok(embedSize(embed) <= LIMITS.total, `${embedSize(embed)} characters`);
    for (const field of json.fields) {
      assert.ok(field.name.length <= LIMITS.fieldName);
      assert.ok(field.value.length <= LIMITS.fieldValue);
    }
  });
});

describe('boardHash', () => {
  const withRoster = (...pairs) => ({
    dataset: tier(),
    config: { raids: { 'raid-1': raid({ signups: signups(...pairs) }) } },
  });

  it('is stable for the same state', () => {
    assert.equal(
      boardHash(buildBoardEmbed(withRoster(['yes', 'mage.fire']))),
      boardHash(buildBoardEmbed(withRoster(['yes', 'mage.fire']))),
    );
  });

  it('moves when somebody joins', () => {
    assert.notEqual(
      boardHash(buildBoardEmbed(withRoster(['yes', 'mage.fire']))),
      boardHash(buildBoardEmbed(withRoster(['yes', 'mage.fire'], ['yes', 'priest.holy']))),
    );
  });

  it('moves when a second person brings the same spec, because the count shows', () => {
    assert.notEqual(
      boardHash(buildBoardEmbed(withRoster(['yes', 'mage.fire']))),
      boardHash(buildBoardEmbed(withRoster(['yes', 'mage.fire'], ['yes', 'mage.fire']))),
    );
  });
});

describe('slot icons', () => {
  it('has one for every slot the board shows', () => {
    for (const slot of BOARD_SLOTS) assert.ok(SLOT_ICONS[slot], `no icon for ${slot}`);
  });

  it('marks every item on a row, so a wrapped line is still readable', () => {
    const line = rosterLine({
      spec: specByKey('mage.fire'),
      count: 1,
      resolved: resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: tier() }),
      slots: BOARD_SLOTS,
    });

    for (const slot of BOARD_SLOTS) assert.ok(line.includes(SLOT_ICONS[slot]), `${slot} is unmarked`);
  });

  it('does not reuse a role icon, which would make the two columns ambiguous', () => {
    const roles = ['\u{1F6E1}\uFE0F', '\u{1F49A}', '\u2694\uFE0F', '\u{1F3F9}'];

    for (const slot of BOARD_SLOTS) assert.ok(!roles.includes(SLOT_ICONS[slot]), `${slot} clashes with a role`);
  });

  it('explains each icon it used in the legend', () => {
    const json = buildBoardEmbed({
      dataset: tier(),
      config: { raids: { 'raid-1': raid({ signups: signups(['yes', 'mage.fire']) }) } },
    }).toJSON();

    const shown = `${json.description}\n${json.fields.map((field) => field.value).join('\n')}`;

    for (const slot of BOARD_SLOTS) {
      // Every icon that turns up in the body is named in the description.
      if (shown.includes(SLOT_ICONS[slot])) {
        assert.ok(json.description.includes(SLOT_ICONS[slot]), `${slot} is used but not in the legend`);
      }
    }
  });
});
