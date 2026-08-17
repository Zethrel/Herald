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
  it('follows Method, plus the guild itself', () => {
    // Icy Veins and Wowhead mint a new URL every tier, so there is no stable
    // page to follow and they are not tracked.
    assert.deepEqual(SOURCE_IDS, ['method', 'guild']);
    assert.equal(sourceName('method'), 'Method');
    assert.equal(sourceById('method').homepage, 'https://www.method.gg/');
    assert.equal(sourceName('nonsense'), 'nonsense');
  });

  it('ignores a report from a source it does not track', () => {
    const dataset = datasetWith({
      'some-old-site': report({ 'mage.fire': { flask: 'flask-b' } }),
      method: report({ 'mage.fire': { flask: 'flask-a' } }),
    });

    const { sources, slots } = compareSpec({ dataset, spec: FIRE });

    assert.deepEqual(sources, ['method']);
    assert.equal(slots.flask.consensus.name, 'Flask A');
  });
});

describe('mergeReports', () => {
  it("layers a server's recorded reports over the shipped ones", () => {
    const merged = mergeReports(
      { method: report({ 'mage.fire': { flask: 'flask-a' } }) },
      { method: { specs: { 'mage.fire': { flask: 'flask-b' } } } },
    );

    assert.equal(merged.method.specs['mage.fire'].flask, 'flask-b');
  });

  it('keeps specs the overlay does not mention', () => {
    const merged = mergeReports(
      {
        method: report({
          'mage.fire': { flask: 'flask-a' },
          'priest.holy': { flask: 'flask-c' },
        }),
      },
      { method: { specs: { 'mage.fire': { flask: 'flask-b' } } } },
    );

    assert.equal(merged.method.specs['priest.holy'].flask, 'flask-c');
  });

  it('merges slot by slot rather than replacing a spec entry', () => {
    const merged = mergeReports(
      { method: report({ 'mage.fire': { flask: 'flask-a', food: 'feast-a' } }) },
      { method: { specs: { 'mage.fire': { flask: 'flask-b' } } } },
    );

    assert.equal(merged.method.specs['mage.fire'].flask, 'flask-b');
    assert.equal(merged.method.specs['mage.fire'].food, 'feast-a');
  });

  it('takes a source that only one side has', () => {
    const merged = mergeReports(
      { method: report({ 'mage.fire': { flask: 'flask-a' } }) },
      { guild: { specs: { 'mage.fire': { flask: 'flask-b' } } } },
    );

    assert.deepEqual(Object.keys(merged).sort(), ['guild', 'method']);
  });
});

describe('tally', () => {
  const opinion = (sourceId, name) => ({ sourceId, item: { slug: name, name } });

  it('calls a single answer single, not unanimous', () => {
    assert.equal(tally([opinion('method', 'flask-a')]).agreement, 'single');
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
    method: report({
      'mage.fire': { flask: 'flask-a', food: 'feast-a', url: 'https://www.method.gg/guides/fire-mage/x' },
    }),
  });

  it("lists Method's answer with its attribution", () => {
    const { slots, sources } = compareSpec({ dataset, spec: FIRE });

    assert.deepEqual(sources, ['method']);
    assert.equal(slots.flask.opinions.length, 1);
    assert.equal(slots.flask.opinions[0].name, 'Method');
    assert.equal(slots.flask.opinions[0].url, 'https://www.method.gg/guides/fire-mage/x');
    assert.equal(slots.flask.opinions[0].fetchedAt, '2026-08-01T00:00:00Z');
  });

  it('takes a lone answer as the answer', () => {
    // With one guide tracked, "single" is the normal case rather than a
    // degenerate one -- it still resolves.
    const { slots } = compareSpec({ dataset, spec: FIRE });

    assert.equal(slots.flask.agreement, 'single');
    assert.equal(slots.flask.consensus.name, 'Flask A');
  });

  it('agrees with itself when the guild records the same answer', () => {
    const agreed = datasetWith({
      method: report({ 'mage.fire': { flask: 'flask-a' } }),
      guild: report({ 'mage.fire': { flask: 'flask-a' } }),
    });

    assert.equal(compareSpec({ dataset: agreed, spec: FIRE }).slots.flask.agreement, 'unanimous');
  });

  it('shows a guild disagreement as a split rather than picking a side', () => {
    const disputed = datasetWith({
      method: report({ 'mage.fire': { flask: 'flask-a' } }),
      guild: report({ 'mage.fire': { flask: 'flask-b' } }),
    });

    const { slots } = compareSpec({ dataset: disputed, spec: FIRE });

    assert.equal(slots.flask.agreement, 'split');
    assert.equal(slots.flask.consensus, null);
  });

  it('reports a slot nobody covers', () => {
    const { slots } = compareSpec({ dataset, spec: FIRE });

    assert.equal(slots.potion.agreement, 'none');
    assert.deepEqual(slots.potion.opinions, []);
  });

  it('has nothing to say about a spec the guide does not mention', () => {
    const { sources } = compareSpec({ dataset, spec: specByKey('rogue.outlaw') });
    assert.deepEqual(sources, []);
  });
});

describe('consensusFor', () => {
  it("offers Method's answer", () => {
    const dataset = datasetWith({ method: report({ 'mage.fire': { flask: 'flask-a' } }) });
    const consensus = consensusFor({ dataset, spec: FIRE });

    assert.equal(consensus.flask.item.name, 'Flask A');
    assert.equal(consensus.flask.agreement, 'single');
    assert.deepEqual(consensus.flask.sourceIds, ['method']);
  });

  it('offers nothing where the guild has recorded a disagreement', () => {
    const dataset = datasetWith({
      method: report({ 'mage.fire': { flask: 'flask-a' } }),
      guild: report({ 'mage.fire': { flask: 'flask-b' } }),
    });

    assert.deepEqual(consensusFor({ dataset, spec: FIRE }), {});
  });
});

describe('Method in the resolution chain', () => {
  const reports = { method: report({ 'mage.fire': { flask: 'flask-a' } }) };

  it('beats the generic stat default', () => {
    // A guide that looked at this exact spec is better than "all intellect
    // casters use X".
    const dataset = datasetWith(reports, { defaults: { intellect: { flask: 'flask-c' } } });
    const resolved = resolveSpecConsumables({ spec: FIRE, dataset });

    assert.equal(resolved.slots.flask.item.name, 'Flask A');
    assert.equal(resolved.slots.flask.via, 'sources');
    assert.deepEqual(resolved.slots.flask.sourceIds, ['method']);
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

  it('falls through to the defaults when a recorded guild view disagrees', () => {
    // Recording a disagreement marks it; it does not decide it. Deciding is
    // what /consumables set is for, and that outranks everything.
    const dataset = datasetWith(
      {
        method: report({ 'mage.fire': { flask: 'flask-a' } }),
        guild: report({ 'mage.fire': { flask: 'flask-b' } }),
      },
      { defaults: { intellect: { flask: 'flask-c' } } },
    );

    const resolved = resolveSpecConsumables({ spec: FIRE, dataset });

    assert.equal(resolved.slots.flask.item.name, 'Flask C');
    assert.equal(resolved.slots.flask.via, 'default:intellect');
  });

  it('leaves the slot empty when nothing else answers either', () => {
    const dataset = datasetWith({
      method: report({ 'mage.fire': { flask: 'flask-a' } }),
      guild: report({ 'mage.fire': { flask: 'flask-b' } }),
    });

    const resolved = resolveSpecConsumables({ spec: FIRE, dataset });

    assert.equal(resolved.slots.flask.item, null);
    assert.equal(resolved.slots.flask.via, null);
  });

  it("uses a server's recorded report when one is passed in", () => {
    const dataset = datasetWith({});
    const resolved = resolveSpecConsumables({
      spec: FIRE,
      dataset,
      reports: mergeReports({}, { method: { specs: { 'mage.fire': { flask: 'flask-b' } } } }),
    });

    assert.equal(resolved.slots.flask.item.name, 'Flask B');
    assert.equal(resolved.slots.flask.via, 'sources');
  });
});

describe('disagreements', () => {
  it('finds every spec where a recorded guild view differs from the guide', () => {
    const dataset = datasetWith({
      method: report({
        'mage.fire': { flask: 'flask-a' },
        'priest.holy': { flask: 'flask-a' },
      }),
      guild: report({
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
