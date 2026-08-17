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
  it('separates the four checked by hand from the derived rest', () => {
    assert.equal(isConfirmed('method', specByKey('deathknight.blood')), true);
    assert.equal(isConfirmed('method', specByKey('mage.fire')), false);
    assert.equal(METHOD_CONFIRMED.size, 4);
  });

  it('claims nothing for the guides whose pattern is unknown', () => {
    assert.equal(isConfirmed('icy-veins', specByKey('deathknight.blood')), false);
  });
});

describe('guideUrl', () => {
  it('answers for Method', () => {
    assert.match(guideUrl('method', specByKey('mage.fire')), /method\.gg/);
  });

  it('offers nothing for the guides whose pattern has not been checked', () => {
    // Better no link than one that might 404: these two organise their guides
    // differently and neither pattern has been verified.
    assert.equal(guideUrl('icy-veins', specByKey('mage.fire')), null);
    assert.equal(guideUrl('wowhead', specByKey('mage.fire')), null);
    assert.equal(guideUrl('guild', specByKey('mage.fire')), null);
  });

  it('is null for a source it has never heard of', () => {
    assert.equal(guideUrl('nonsense', specByKey('mage.fire')), null);
  });
});

describe('allMethodGuides', () => {
  it('reports which slugs are confirmed and which are derived', () => {
    const all = allMethodGuides();

    assert.equal(all.length, 39);
    assert.equal(all.filter((entry) => entry.confirmed).length, 4);
  });
});
