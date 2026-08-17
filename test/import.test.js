import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyImport, applyImportAsReport, parseTierText } from '../src/consumables/import.js';
import { normalizeDataset } from '../src/consumables/dataset.js';
import { resolveSpecConsumables } from '../src/consumables/resolve.js';
import { specByKey } from '../src/game/specs.js';

describe('parseTierText', () => {
  it('reads a default line', () => {
    const parsed = parseTierText('intellect: flask = Flask of X; food = Feast of Y; potion = Potion of Z');

    assert.deepEqual(parsed.defaults.intellect, {
      flask: 'flask-of-x',
      food: 'feast-of-y',
      potion: 'potion-of-z',
    });
    assert.deepEqual(parsed.items['flask-of-x'], { name: 'Flask of X', craft: true });
    assert.equal(parsed.errors.length, 0);
  });

  it('reads a spec line, in whatever form the spec was written', () => {
    const parsed = parseTierText(
      ['fire mage: potion = Potion A', 'boomkin: flask = Flask B', 'mage.frost: food = Food C'].join('\n'),
    );

    assert.deepEqual(parsed.specs['mage.fire'], { potion: 'potion-a' });
    assert.deepEqual(parsed.specs['druid.balance'], { flask: 'flask-b' });
    assert.deepEqual(parsed.specs['mage.frost'], { food: 'food-c' });
  });

  it('takes roles as defaults too', () => {
    const parsed = parseTierText('healer: food = Healer Food\ntank: food = Tank Food');

    assert.equal(parsed.defaults.healer.food, 'healer-food');
    assert.equal(parsed.defaults.tank.food, 'tank-food');
  });

  it('accepts the slot aliases people actually type', () => {
    const parsed = parseTierText('intellect: phial = P; feast = F; pot = Q');

    assert.deepEqual(parsed.defaults.intellect, { flask: 'p', food: 'f', potion: 'q' });
  });

  it('accepts a colon as well as an equals', () => {
    assert.equal(parseTierText('intellect: flask: Flask of X').defaults.intellect.flask, 'flask-of-x');
  });

  it('keeps a comma inside an item name', () => {
    // Semicolons separate assignments precisely so this works.
    const parsed = parseTierText('intellect: food = Feast of the Divine, Second Course');

    assert.equal(parsed.items['feast-of-the-divine-second-course'].name, 'Feast of the Divine, Second Course');
  });

  it('ignores comments, blank lines and unfilled blanks', () => {
    const parsed = parseTierText(
      ['# a comment', '', 'intellect: flask = Flask of X  # trailing note', 'agility: flask = -'].join('\n'),
    );

    assert.equal(parsed.defaults.intellect.flask, 'flask-of-x');
    assert.equal(parsed.defaults.agility, undefined);
    assert.equal(parsed.lines, 1);
    assert.equal(parsed.errors.length, 0);
  });

  it('reports a line it cannot read and keeps going', () => {
    const parsed = parseTierText(
      ['intellect: flask = Flask of X', 'this line makes no sense', 'agility: flask = Flask of Y'].join('\n'),
    );

    assert.equal(parsed.errors.length, 1);
    assert.equal(parsed.errors[0].line, 2);
    // The good lines still landed.
    assert.equal(parsed.defaults.intellect.flask, 'flask-of-x');
    assert.equal(parsed.defaults.agility.flask, 'flask-of-y');
  });

  it('names the offending key when it is not a stat, role or spec', () => {
    const parsed = parseTierText('bard: flask = Flask of X');

    assert.equal(parsed.errors.length, 1);
    assert.match(parsed.errors[0].reason, /not a stat, role or spec/);
  });

  it('refuses an ambiguous spec rather than guessing', () => {
    // "frost" is a Mage and a Death Knight.
    const parsed = parseTierText('frost: flask = Flask of X');

    assert.equal(parsed.errors.length, 1);
    assert.deepEqual(parsed.specs, {});
  });

  it('names an unknown slot', () => {
    const parsed = parseTierText('intellect: enchant = Something');

    assert.match(parsed.errors[0].reason, /unknown slot/);
  });

  it('merges two lines for the same key', () => {
    const parsed = parseTierText('intellect: flask = Flask of X\nintellect: food = Feast of Y');

    assert.deepEqual(parsed.defaults.intellect, { flask: 'flask-of-x', food: 'feast-of-y' });
  });
});

describe('applyImport', () => {
  const dataset = normalizeDataset({
    items: { 'flask-of-x': { name: 'Flask of X', itemId: 4242 } },
    defaults: { intellect: { food: 'kept-food' } },
    specs: { 'mage.fire': { potion: 'kept-potion' } },
  });

  it('adds without dropping what was there', () => {
    const parsed = parseTierText('intellect: flask = Flask of X\nfire mage: flask = Flask of X');
    const next = applyImport(dataset, parsed);

    assert.equal(next.defaults.intellect.flask, 'flask-of-x');
    assert.equal(next.defaults.intellect.food, 'kept-food', 'the existing slot survives');
    assert.equal(next.specs['mage.fire'].potion, 'kept-potion');
  });

  it('keeps an item id already looked up', () => {
    // Re-importing the same names must not throw away a sync-tier run.
    const next = applyImport(dataset, parseTierText('intellect: flask = Flask of X'));

    assert.equal(next.items['flask-of-x'].itemId, 4242);
  });

  it('stamps the update time', () => {
    const next = applyImport(dataset, parseTierText('intellect: flask = Flask of X'), {
      now: () => '2026-08-17T00:00:00Z',
    });

    assert.equal(next.updatedAt, '2026-08-17T00:00:00Z');
  });

  it('produces a dataset the resolver can answer from', () => {
    // The point of the whole exercise: five lines in, every spec answered.
    const filled = applyImport(
      normalizeDataset({}),
      parseTierText(
        [
          'all: food = Feast A; oil = Oil A',
          'intellect: flask = Flask I; potion = Potion I',
          'agility: flask = Flask A; potion = Potion A',
          'strength: flask = Flask S; potion = Potion S',
          'fire mage: potion = Potion Fire',
        ].join('\n'),
      ),
    );

    const mage = resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: filled });
    assert.equal(mage.slots.flask.item.name, 'Flask I');
    assert.equal(mage.slots.flask.via, 'default:intellect');
    assert.equal(mage.slots.potion.item.name, 'Potion Fire');
    assert.equal(mage.slots.potion.via, 'spec');

    const rogue = resolveSpecConsumables({ spec: specByKey('rogue.outlaw'), dataset: filled });
    assert.equal(rogue.slots.flask.item.name, 'Flask A');
    assert.equal(rogue.complete, true);
  });
});

describe('applyImportAsReport', () => {
  it("records spec lines as a source's answer, with the guide URL", () => {
    const next = applyImportAsReport(normalizeDataset({}), parseTierText('fire mage: flask = Flask of X'), {
      sourceId: 'method',
      urlFor: () => 'https://www.method.gg/guides/fire-mage/stats-races-and-consumables',
      now: () => '2026-08-17T00:00:00Z',
    });

    assert.equal(next.reports.method.specs['mage.fire'].flask, 'flask-of-x');
    assert.match(next.reports.method.specs['mage.fire'].url, /method\.gg/);
    assert.equal(next.reports.method.specs['mage.fire'].fetchedAt, '2026-08-17T00:00:00Z');
  });

  it('leaves the guild data alone', () => {
    const dataset = normalizeDataset({ defaults: { intellect: { flask: 'ours' } } });
    const next = applyImportAsReport(dataset, parseTierText('fire mage: flask = Theirs'), {
      sourceId: 'method',
    });

    assert.deepEqual(next.defaults, dataset.defaults);
    assert.deepEqual(next.specs, {});
  });

  it('feeds the resolver through the sources rung', () => {
    const next = applyImportAsReport(normalizeDataset({}), parseTierText('fire mage: flask = Flask of X'), {
      sourceId: 'method',
    });

    const resolved = resolveSpecConsumables({ spec: specByKey('mage.fire'), dataset: next });
    assert.equal(resolved.slots.flask.item.name, 'Flask of X');
    assert.equal(resolved.slots.flask.via, 'sources');
  });
});

describe('the corrected consumable model', () => {
  it('reads a secondary declaration as a stat, not an item', () => {
    const parsed = parseTierText('fire mage: secondary = mastery');

    assert.deepEqual(parsed.specs['mage.fire'], { secondary: 'mastery' });
    // It must not turn up in the shopping list as something to buy.
    assert.deepEqual(parsed.items, {});
  });

  it('accepts the ways people write the secondaries', () => {
    const parsed = parseTierText('fire mage: secondary = Critical Strike\nfrost mage: secondary = vers');

    assert.equal(parsed.specs['mage.fire'].secondary, 'crit');
    assert.equal(parsed.specs['mage.frost'].secondary, 'versatility');
  });

  it('names an unknown secondary rather than accepting it', () => {
    const parsed = parseTierText('fire mage: secondary = spellpower');

    assert.match(parsed.errors[0].reason, /unknown secondary/);
    assert.deepEqual(parsed.specs, {});
  });

  it('takes the secondary-stat and `all` blocks as defaults', () => {
    const parsed = parseTierText(
      ['all: food = Feast; potion = Main Potion', 'crit: flask = Crit Flask; oil = Crit Oil'].join('\n'),
    );

    assert.deepEqual(parsed.defaults.all, { food: 'feast', potion: 'main-potion' });
    assert.deepEqual(parsed.defaults.crit, { flask: 'crit-flask', oil: 'crit-oil' });
  });

  it('reads the weapon oil slot', () => {
    assert.equal(parseTierText('all: weapon oil = Some Oil').defaults.all.oil, 'some-oil');
  });
});
