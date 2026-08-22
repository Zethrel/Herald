import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

import { convertTable, isFatal, parseTable, toTierText } from '../src/consumables/table.js';
import { SPECS } from '../src/game/specs.js';
import { parseTierText } from '../src/consumables/import.js';

/** One class heading and one row, in the escaped form a chat export produces. */
const table = (className, rows) =>
  [
    `\\### ${className}`,
    '',
    '| Specialization | Consumables |',
    '| -------------- | ----------- |',
    ...rows.map(([spec, text]) => `| \\*\\*${spec}\\*\\*  | ${text} |`),
  ].join('\n\n');

function convert(className, rows) {
  const { entries, problems } = convertTable(parseTable(table(className, rows)));
  return { entry: entries[0], entries, problems };
}

describe('parseTable', () => {
  it('reads a class heading and its rows through the escaping', () => {
    const rows = parseTable(
      table('Mage', [
        ['Fire', 'Harandar Celebration; Flask of the Magisters'],
        ['Frost', 'Harandar Celebration; Flask of the Shattered Sun'],
      ]),
    );

    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => `${row.specName} ${row.className}`),
      ['Fire Mage', 'Frost Mage'],
    );
  });

  it('drops the footnote markers the tables are pasted in with', () => {
    const { entry } = convert('Mage', [['Fire', 'Flask of the Magisters  ]\\[18])']]);

    assert.deepEqual(entry.slots.flask, ['Flask of the Magisters']);
  });
});

describe('working out which slot an item belongs in', () => {
  it('files each family where it belongs', () => {
    const { entry } = convert('Mage', [
      [
        'Fire',
        'Harandar Celebration; Flask of the Magisters; Potion of Recklessness; ' +
          'Concentrated Silvermoon Health Potion; Thalassian Phoenix Oil; Void-Touched Augment Rune',
      ],
    ]);

    assert.deepEqual(entry.slots, {
      food: ['Harandar Celebration'],
      flask: ['Flask of the Magisters'],
      potion: ['Potion of Recklessness'],
      healthPotion: ['Concentrated Silvermoon Health Potion'],
      oil: ['Thalassian Phoenix Oil'],
      rune: ['Void-Touched Augment Rune'],
    });
  });

  it('keeps a mana potion out of the combat potion slot', () => {
    // Both are potions. Only one of them is the one you drink on pull.
    const { entry } = convert('Priest', [['Holy', 'Lightfused Mana Potion']]);

    assert.deepEqual(entry.slots, { manaPotion: ['Lightfused Mana Potion'] });
  });

  it('reads the order of alternatives as the source wrote them', () => {
    const { entry } = convert('Mage', [['Fire', 'Flask of the Magisters / Flask of the Blood Knights']]);

    assert.deepEqual(entry.slots.flask, ['Flask of the Magisters', 'Flask of the Blood Knights']);
  });

  it('spells out a shorthand alternative from the full name elsewhere in the document', () => {
    // "Flask of the Magisters / Blood Knights" is one flask and one abbreviation
    // of another, and "Blood Knights" is not something anyone can buy. The long
    // form is taken from another row -- nothing is invented, it only finds a
    // name the document already spells out.
    const { entries } = convert('Druid', [
      ['Feral', 'Flask of the Magisters / Blood Knights / Thalassian Resistance'],
      ['Guardian', 'Flask of the Blood Knights'],
      ['Balance', 'Flask of Thalassian Resistance'],
    ]);

    assert.deepEqual(entries[0].slots.flask, [
      'Flask of the Magisters',
      'Flask of the Blood Knights',
      'Flask of Thalassian Resistance',
    ]);
  });

  it('leaves a shorthand alone when the document never spells it out', () => {
    const { entry, problems } = convert('Druid', [['Feral', 'Flask of the Magisters / Blood Knights']]);

    // Better a name someone recognises and can correct than a guess at which
    // flask "Blood Knights" was short for.
    assert.deepEqual(entry.slots.flask, ['Flask of the Magisters', 'Blood Knights']);
    assert.deepEqual(problems, []);
  });

  it('says so rather than filing a name it does not recognise', () => {
    const { entries, problems } = convert('Mage', [['Fire', 'Bag of Mystery']]);

    assert.equal(entries[0].slots.flask, undefined);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /no idea which slot/);
    assert.equal(isFatal(problems[0]), true);
  });

  it('reports a spec it has never heard of instead of dropping the row', () => {
    const { problems } = convert('Tinker', [['Tinkering', 'Flask of the Magisters']]);

    assert.equal(problems.length, 1);
    assert.equal(isFatal(problems[0]), true);
  });

  it('flags a field whose alternatives are not the same kind of thing', () => {
    const { entry, problems } = convert('Druid', [
      ['Restoration', "Lightfused Mana Potion / Light's Potential"],
    ]);

    // Filed under the first, because that is the order the source wrote them --
    // but a human should look at it, so it is not filed silently.
    assert.deepEqual(entry.slots.manaPotion, ['Lightfused Mana Potion', "Light's Potential"]);
    assert.match(problems[0], /mixes slots/);
    assert.equal(isFatal(problems[0]), false);
  });
});

describe('the qualifiers around an item', () => {
  it('keeps a parenthesised condition as a note against the item it qualifies', () => {
    const { entry } = convert('Shaman', [
      ['Elemental', 'Thalassian Phoenix Oil \\*(only without Flametongue Weapon talent)\\*'],
    ]);

    assert.deepEqual(entry.slots.oil, ['Thalassian Phoenix Oil']);
    assert.deepEqual(entry.notes, ['Thalassian Phoenix Oil: only without Flametongue Weapon talent']);
  });

  it('keeps a quantity without repeating the name twice', () => {
    const { entry } = convert('Demon Hunter', [['Havoc', '\\*\\*2× Thalassian Phoenix Oil\\*\\*']]);

    assert.deepEqual(entry.slots.oil, ['Thalassian Phoenix Oil']);
    assert.deepEqual(entry.notes, ['2× Thalassian Phoenix Oil']);
  });

  it('turns "no weapon oil" into an explicit none, and keeps what replaces it', () => {
    const { entry } = convert('Shaman', [
      ['Enhancement', '\\*\\*no weapon oil\\*\\* — uses Windfury Weapon + Flametongue Weapon'],
    ]);

    assert.equal(entry.slots.oil, 'none');
    assert.deepEqual(entry.notes, ['no weapon oil — uses Windfury Weapon + Flametongue Weapon']);
  });

  it('takes the named default out of a vague recommendation', () => {
    const { entry } = convert('Druid', [
      ['Feral', 'any main-stat feast, default Harandar Celebration'],
    ]);

    assert.deepEqual(entry.slots.food, ['Harandar Celebration']);
    assert.deepEqual(entry.notes, ['Harandar Celebration: any main-stat feast']);
  });

  it('records "any feast" without inventing an item to buy', () => {
    // A real statement, and not something with a name or a price. The slot is
    // left for the tier file's own default to answer.
    const { entry } = convert('Rogue', [['Assassination', 'Any primary-stat Feast']]);

    assert.equal(entry.slots.food, undefined);
    assert.deepEqual(entry.notes, ['any primary-stat feast']);
  });
});

describe('what comes out the other end', () => {
  it('is a line the ordinary importer reads without complaint', () => {
    const { entries } = convert('Paladin', [
      [
        'Protection',
        'Harandar Celebration / Silvermoon Parade; Flask of the Blood Knights; ' +
          'Thalassian Phoenix Oil \\*(Templar)\\* / Rite of Sanctification \\*(Lightsmith)\\*',
      ],
    ]);

    const parsed = parseTierText(toTierText(entries));

    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.specs['paladin.protection'].flask, 'flask-of-the-blood-knights');
    assert.deepEqual(parsed.specs['paladin.protection'].oil, [
      'thalassian-phoenix-oil',
      'rite-of-sanctification',
    ]);
    assert.match(parsed.specs['paladin.protection'].note, /Templar/);
  });

  it('never lets a note swallow the assignments after it', () => {
    // Semicolons separate assignments, so one inside a note would end the line.
    const { entries } = convert('Mage', [
      ['Fire', 'Flask of the Magisters \\*(one; then another)\\*'],
    ]);

    const text = toTierText(entries);
    const parsed = parseTierText(text);

    assert.deepEqual(parsed.errors, []);
    assert.match(parsed.specs['mage.fire'].note, /one, then another/);
  });
});

describe("the guild's own table, as shipped", () => {
  it('converts every row with nothing left unplaced', async () => {
    const rows = parseTable(await readFile(new URL('../tiers/sources/spec-consumables.md', import.meta.url), 'utf8'));
    const { entries, problems } = convertTable(rows);

    assert.equal(rows.length, SPECS.length);
    assert.equal(entries.length, SPECS.length, 'every row should map to a spec');
    assert.deepEqual(problems.filter(isFatal), []);
    assert.deepEqual(
      [...new Set(entries.map((entry) => entry.spec.key))].length,
      SPECS.length,
      'no spec should be written twice',
    );
  });

  it('reads back into the tier file format cleanly', async () => {
    const text = await readFile(new URL('../tiers/current.txt', import.meta.url), 'utf8');
    const parsed = parseTierText(text);

    assert.deepEqual(parsed.errors, []);
    assert.equal(Object.keys(parsed.specs).length, SPECS.length);
    // Every spec names its own flask, so none of them depends on the fallback.
    assert.ok(SPECS.every((spec) => parsed.specs[spec.key]?.flask));
  });
});
