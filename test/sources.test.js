import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compareSpec, consensusFor, disagreements, mergeReports, tally } from '../src/sources/compare.js';
import { SOURCE_IDS, sourceById, sourceName } from '../src/sources/registry.js';
import { normalizeDataset } from '../src/consumables/dataset.js';
import { resolveSpecConsumables } from '../src/consumables/resolve.js';
import { specByKey } from '../src/game/specs.js';

const FIRE = specByKey('mage.fire');

function datasetWith(reports, extra = {}) {
  return normalizeDataset({
    items: {
      'flask-a': { name: 'Flask A', itemId: 1 },
      'flask-b': { name: 'Flask B', itemId: 2 },
      'flask-c': { name: 'Flask C', itemId: 3 },
      'feast-a': { name: 'Feast A', itemId: 4 },
    },
    reports,
    ...extra,
  });
}

const report = (specs, fetchedAt = '2026-08-01T00:00:00Z') => ({ fetchedAt, specs });

describe('the source registry', () => {
  it('knows the three guides and the guild itself', () => {
    assert.deepEqual(SOURCE_IDS, ['icy-veins', 'wowhead', 'method', 'guild']);
    assert.equal(sourceName('icy-veins'), 'Icy Veins');
    assert.equal(sourceById('method').homepage, 'https://www.method.gg/');
    assert.equal(sourceName('nonsense'), 'nonsense');
  });
});

describe('mergeReports', () => {
  it("layers a server's recorded reports over the shipped ones", () => {
    const merged = mergeReports(
      { 'icy-veins': report({ 'mage.fire': { flask: 'flask-a' } }) },
      { 'icy-veins': { specs: { 'mage.fire': { flask: 'flask-b' } } } },
    );

    assert.equal(merged['icy-veins'].specs['mage.fire'].flask, 'flask-b');
  });

  it('keeps specs the overlay does not mention', () => {
    const merged = mergeReports(
      {
        'icy-veins': report({
          'mage.fire': { flask: 'flask-a' },
          'priest.holy': { flask: 'flask-c' },
        }),
      },
      { 'icy-veins': { specs: { 'mage.fire': { flask: 'flask-b' } } } },
    );

    assert.equal(merged['icy-veins'].specs['priest.holy'].flask, 'flask-c');
  });

  it('merges slot by slot rather than replacing a spec entry', () => {
    const merged = mergeReports(
      { wowhead: report({ 'mage.fire': { flask: 'flask-a', food: 'feast-a' } }) },
      { wowhead: { specs: { 'mage.fire': { flask: 'flask-b' } } } },
    );

    assert.equal(merged.wowhead.specs['mage.fire'].flask, 'flask-b');
    assert.equal(merged.wowhead.specs['mage.fire'].food, 'feast-a');
  });

  it('takes a source that only one side has', () => {
    const merged = mergeReports(
      { 'icy-veins': report({ 'mage.fire': { flask: 'flask-a' } }) },
      { method: { specs: { 'mage.fire': { flask: 'flask-b' } } } },
    );

    assert.deepEqual(Object.keys(merged).sort(), ['icy-veins', 'method']);
  });
});

describe('tally', () => {
  const opinion = (sourceId, name) => ({ sourceId, item: { slug: name, name } });

  it('calls a single answer single, not unanimous', () => {
    assert.equal(tally([opinion('wowhead', 'flask-a')]).agreement, 'single');
  });

  it('calls it unanimous when everyone says the same', () => {
    const result = tally([opinion('a', 'flask-a'), opinion('b', 'flask-a'), opinion('c', 'flask-a')]);

    assert.equal(result.agreement, 'unanimous');
    assert.equal(result.consensus.slug, 'flask-a');
  });

  it('takes a real majority', () => {
    const result = tally([opinion('a', 'flask-a'), opinion('b', 'flask-a'), opinion('c', 'flask-b')]);

    assert.equal(result.agreement, 'majority');
    assert.equal(result.consensus.slug, 'flask-a');
  });

  it('refuses to break a tie', () => {
    // Two against two decides nothing. Picking one would be a coin toss
    // presented as advice.
    const result = tally([
      opinion('a', 'flask-a'),
      opinion('b', 'flask-a'),
      opinion('c', 'flask-b'),
      opinion('d', 'flask-b'),
    ]);

    assert.equal(result.agreement, 'split');
    assert.equal(result.consensus, null);
  });

  it('treats a three-way disagreement as split', () => {
    const result = tally([opinion('a', 'flask-a'), opinion('b', 'flask-b'), opinion('c', 'flask-c')]);

    assert.equal(result.agreement, 'split');
    assert.equal(result.consensus, null);
  });

  it('matches free-text names case-insensitively', () => {
    const result = tally([
      { sourceId: 'a', item: { slug: null, name: 'Flask of Testing' } },
      { sourceId: 'b', item: { slug: null, name: 'flask of testing ' } },
    ]);

    assert.equal(result.agreement, 'unanimous');
  });

  it('says nothing when nobody has an opinion', () => {
    assert.deepEqual(tally([]), { agreement: 'none', consensus: null, groups: [] });
  });
});

describe('compareSpec', () => {
  const dataset = datasetWith({
    'icy-veins': report({ 'mage.fire': { flask: 'flask-a', food: 'feast-a', url: 'https://iv.invalid/fire' } }),
    wowhead: report({ 'mage.fire': { flask: 'flask-b' } }),
    method: report({ 'mage.fire': { flask: 'flask-a' } }),
  });

  it('lists every guide with its attribution', () => {
    const { slots, sources } = compareSpec({ dataset, spec: FIRE });

    assert.deepEqual(sources, ['icy-veins', 'wowhead', 'method']);
    const flask = slots.flask;
    assert.equal(flask.opinions.length, 3);
    assert.equal(flask.opinions[0].name, 'Icy Veins');
    assert.equal(flask.opinions[0].url, 'https://iv.invalid/fire');
    assert.equal(flask.opinions[0].fetchedAt, '2026-08-01T00:00:00Z');
  });

  it('resolves the majority across guides', () => {
    const { slots } = compareSpec({ dataset, spec: FIRE });

    assert.equal(slots.flask.agreement, 'majority');
    assert.equal(slots.flask.consensus.name, 'Flask A');
  });

  it('reports a slot only one guide covers', () => {
    const { slots } = compareSpec({ dataset, spec: FIRE });

    assert.equal(slots.food.agreement, 'single');
    assert.equal(slots.food.opinions.length, 1);
  });

  it('reports a slot nobody covers', () => {
    const { slots } = compareSpec({ dataset, spec: FIRE });

    assert.equal(slots.potion.agreement, 'none');
    assert.deepEqual(slots.potion.opinions, []);
  });

  it('has nothing to say about a spec no guide mentions', () => {
    const { sources } = compareSpec({ dataset, spec: specByKey('rogue.outlaw') });
    assert.deepEqual(sources, []);
  });
});

describe('consensusFor', () => {
  it('offers an answer where the guides agree', () => {
    const dataset = datasetWith({
      'icy-veins': report({ 'mage.fire': { flask: 'flask-a' } }),
      method: report({ 'mage.fire': { flask: 'flask-a' } }),
    });

    const consensus = consensusFor({ dataset, spec: FIRE });

    assert.equal(consensus.flask.item.name, 'Flask A');
    assert.equal(consensus.flask.agreement, 'unanimous');
    assert.deepEqual(consensus.flask.sourceIds, ['icy-veins', 'method']);
  });

  it('offers nothing where they split', () => {
    const dataset = datasetWith({
      'icy-veins': report({ 'mage.fire': { flask: 'flask-a' } }),
      method: report({ 'mage.fire': { flask: 'flask-b' } }),
    });

    assert.deepEqual(consensusFor({ dataset, spec: FIRE }), {});
  });
});

describe('the guides in the resolution chain', () => {
  const reports = {
    'icy-veins': report({ 'mage.fire': { flask: 'flask-a' } }),
    method: report({ 'mage.fire': { flask: 'flask-a' } }),
  };

  it('beats the generic stat default', () => {
    // A guide that looked at this exact spec is better than "all intellect
    // casters use X".
    const dataset = datasetWith(reports, { defaults: { intellect: { flask: 'flask-c' } } });
    const resolved = resolveSpecConsumables({ spec: FIRE, dataset });

    assert.equal(resolved.slots.flask.item.name, 'Flask A');
    assert.equal(resolved.slots.flask.via, 'sources');
    assert.deepEqual(resolved.slots.flask.sourceIds, ['icy-veins', 'method']);
  });

  it("never beats the tier file's own entry for the spec", () => {
    const dataset = datasetWith(reports, { specs: { 'mage.fire': { flask: 'flask-c' } } });
    const resolved = resolveSpecConsumables({ spec: FIRE, dataset });

    assert.equal(resolved.slots.flask.item.name, 'Flask C');
    assert.equal(resolved.slots.flask.via, 'spec');
  });

  it("never beats the guild's own decision", () => {
    const dataset = datasetWith(reports);
    const resolved = resolveSpecConsumables({
      spec: FIRE,
      dataset,
      overrides: { 'mage.fire': { flask: 'Our Own Choice' } },
    });

    assert.equal(resolved.slots.flask.item.name, 'Our Own Choice');
    assert.equal(resolved.slots.flask.via, 'guild');
  });

  it('falls through to the defaults when the guides disagree', () => {
    const dataset = datasetWith(
      {
        'icy-veins': report({ 'mage.fire': { flask: 'flask-a' } }),
        method: report({ 'mage.fire': { flask: 'flask-b' } }),
      },
      { defaults: { intellect: { flask: 'flask-c' } } },
    );

    const resolved = resolveSpecConsumables({ spec: FIRE, dataset });

    assert.equal(resolved.slots.flask.item.name, 'Flask C');
    assert.equal(resolved.slots.flask.via, 'default:intellect');
  });

  it('leaves the slot empty when the guides disagree and nothing else answers', () => {
    const dataset = datasetWith({
      'icy-veins': report({ 'mage.fire': { flask: 'flask-a' } }),
      method: report({ 'mage.fire': { flask: 'flask-b' } }),
    });

    const resolved = resolveSpecConsumables({ spec: FIRE, dataset });

    assert.equal(resolved.slots.flask.item, null);
    assert.equal(resolved.slots.flask.via, null);
  });

  it("uses a server's recorded reports when they are passed in", () => {
    const dataset = datasetWith({});
    const resolved = resolveSpecConsumables({
      spec: FIRE,
      dataset,
      reports: mergeReports({}, { wowhead: { specs: { 'mage.fire': { flask: 'flask-b' } } } }),
    });

    assert.equal(resolved.slots.flask.item.name, 'Flask B');
    assert.equal(resolved.slots.flask.via, 'sources');
  });
});

describe('disagreements', () => {
  it('finds every spec the guides split on', () => {
    const dataset = datasetWith({
      'icy-veins': report({
        'mage.fire': { flask: 'flask-a' },
        'priest.holy': { flask: 'flask-a' },
      }),
      method: report({
        'mage.fire': { flask: 'flask-b' },
        'priest.holy': { flask: 'flask-a' },
      }),
    });

    const found = disagreements({ dataset, specs: [FIRE, specByKey('priest.holy')] });

    assert.deepEqual(
      found.map((entry) => entry.spec.key),
      ['mage.fire'],
    );
    assert.deepEqual(found[0].slots, ['flask']);
  });
});
