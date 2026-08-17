import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  METHOD_CONFIRMED,
  METHOD_OVERRIDES,
  allMethodGuides,
  guideSlug,
  guideUrl,
  isConfirmed,
  methodGuideUrl,
} from '../src/sources/urls.js';
import { SPECS, specByKey } from '../src/game/specs.js';

describe('guideSlug', () => {
  it('is the spec then the class, lowercased and hyphenated', () => {
    assert.equal(guideSlug(specByKey('deathknight.blood')), 'blood-death-knight');
    assert.equal(guideSlug(specByKey('druid.restoration')), 'restoration-druid');
  });

  it('handles a two-word spec name', () => {
    assert.equal(guideSlug(specByKey('hunter.beastmastery')), 'beast-mastery-hunter');
  });
});

describe('methodGuideUrl', () => {
  // The four URLs checked by hand against the live site. If the pattern is ever
  // wrong, it is wrong here first.
  it('reproduces the known URLs exactly', () => {
    const expected = {
      'deathknight.blood': 'https://www.method.gg/guides/blood-death-knight/stats-races-and-consumables',
      'deathknight.frost': 'https://www.method.gg/guides/frost-death-knight/stats-races-and-consumables',
      'deathknight.unholy': 'https://www.method.gg/guides/unholy-death-knight/stats-races-and-consumables',
      'druid.restoration': 'https://www.method.gg/guides/restoration-druid/stats-races-and-consumables',
    };

    for (const [key, url] of Object.entries(expected)) {
      assert.equal(methodGuideUrl(specByKey(key)), url, key);
    }
  });

  it('builds a URL for every spec in the catalogue', () => {
    const urls = SPECS.map((spec) => methodGuideUrl(spec));

    assert.equal(urls.length, 39);
    assert.equal(new Set(urls).size, 39, 'every spec should get its own URL');
    assert.ok(urls.every((url) => url.startsWith('https://www.method.gg/guides/')));
  });

  it('lets an override replace a slug that breaks the pattern', () => {
    METHOD_OVERRIDES['mage.fire'] = 'fire-mage-something-else';
    try {
      assert.equal(
        methodGuideUrl(specByKey('mage.fire')),
        'https://www.method.gg/guides/fire-mage-something-else/stats-races-and-consumables',
      );
    } finally {
      delete METHOD_OVERRIDES['mage.fire'];
    }
  });
});

describe('isConfirmed', () => {
  it('covers every spec, all checked against the live site', () => {
    assert.equal(isConfirmed('method', specByKey('deathknight.blood')), true);
    assert.equal(isConfirmed('method', specByKey('mage.fire')), true);
    assert.equal(METHOD_CONFIRMED.size, 39);
  });

  it('leaves a spec added later unconfirmed until someone checks it', () => {
    // The guard this list exists for: a derived URL is not a verified one.
    assert.equal(
      METHOD_CONFIRMED.has(guideSlug({ name: 'Tinkering', className: 'Tinker' })),
      false,
    );
  });

  it('claims nothing for a source with no pattern', () => {
    assert.equal(isConfirmed('guild', specByKey('deathknight.blood')), false);
  });
});

describe('guideUrl', () => {
  it('answers for Method', () => {
    assert.match(guideUrl('method', specByKey('mage.fire')), /method\.gg/);
  });

  it("offers nothing for the guild's own call, which has no page", () => {
    assert.equal(guideUrl('guild', specByKey('mage.fire')), null);
  });

  it('is null for a source it has never heard of', () => {
    assert.equal(guideUrl('nonsense', specByKey('mage.fire')), null);
  });
});

describe('allMethodGuides', () => {
  it('has a checked URL for every spec in the catalogue', () => {
    const all = allMethodGuides();
    const unchecked = all.filter((entry) => !entry.confirmed);

    assert.equal(all.length, 39);
    assert.deepEqual(
      unchecked.map((entry) => entry.slug),
      [],
      'a spec has no verified Method URL — run `npm run check-guides` and add its slug to METHOD_CONFIRMED',
    );
  });
});
