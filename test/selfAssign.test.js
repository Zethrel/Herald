import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeEmoji, planReactionAdd, planReactionRemove } from '../src/ranks/selfAssign.js';

const RAIDER = 'role-raider';
const SOCIAL = 'role-social';
const NEWCOMER = 'role-newcomer';

function config(overrides = {}) {
  return {
    roles: { raider: RAIDER, social: SOCIAL, newcomer: NEWCOMER, officer: 'role-officer' },
    selfAssign: { '⚔️': 'raider', '🍺': 'social' },
    defaultRankKey: 'newcomer',
    exclusiveRanks: true,
    removeDefaultOnPick: true,
    ...overrides,
  };
}

describe('normalizeEmoji', () => {
  it('treats an emoji with and without its variation selector as the same', () => {
    assert.equal(normalizeEmoji('⚔️'), normalizeEmoji('⚔'));
  });

  it('survives being handed nothing', () => {
    assert.equal(normalizeEmoji(undefined), '');
  });
});

describe('planReactionAdd', () => {
  it('gives the rank and takes the default one back', () => {
    const plan = planReactionAdd({ emoji: '⚔️', config: config(), memberRoleIds: [NEWCOMER] });

    assert.equal(plan.ok, true);
    assert.equal(plan.rankKey, 'raider');
    assert.deepEqual(plan.add, [RAIDER]);
    assert.deepEqual(plan.remove, [NEWCOMER]);
  });

  it('matches an emoji sent without its variation selector', () => {
    const plan = planReactionAdd({ emoji: '⚔', config: config(), memberRoleIds: [] });
    assert.deepEqual(plan.add, [RAIDER]);
  });

  it('swaps the other rank out when ranks are exclusive', () => {
    const plan = planReactionAdd({ emoji: '⚔️', config: config(), memberRoleIds: [SOCIAL] });

    assert.deepEqual(plan.add, [RAIDER]);
    assert.deepEqual(plan.remove, [SOCIAL]);
    assert.deepEqual(plan.clearReactions, ['🍺']);
  });

  it('leaves the other rank alone when ranks are not exclusive', () => {
    const plan = planReactionAdd({
      emoji: '⚔️',
      config: config({ exclusiveRanks: false }),
      memberRoleIds: [SOCIAL],
    });

    assert.deepEqual(plan.add, [RAIDER]);
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.clearReactions, []);
  });

  it('keeps the default rank when the guild asked for that', () => {
    const plan = planReactionAdd({
      emoji: '🍺',
      config: config({ removeDefaultOnPick: false }),
      memberRoleIds: [NEWCOMER],
    });

    assert.deepEqual(plan.add, [SOCIAL]);
    assert.deepEqual(plan.remove, []);
  });

  it('does not re-add a rank the member already holds', () => {
    const plan = planReactionAdd({ emoji: '🍺', config: config(), memberRoleIds: [SOCIAL] });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.add, []);
  });

  it('ignores an emoji that means nothing', () => {
    const plan = planReactionAdd({ emoji: '🐔', config: config(), memberRoleIds: [] });

    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'unmapped-emoji');
    assert.deepEqual(plan.add, []);
  });

  it('does nothing when the rank has no role bound to it', () => {
    const plan = planReactionAdd({
      emoji: '⚔️',
      config: config({ roles: { raider: null, social: SOCIAL, newcomer: NEWCOMER } }),
      memberRoleIds: [],
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'rank-not-configured');
  });
});

describe('planReactionRemove', () => {
  it('takes the rank back and falls back to the default one', () => {
    const plan = planReactionRemove({ emoji: '⚔️', config: config(), memberRoleIds: [RAIDER] });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.remove, [RAIDER]);
    assert.deepEqual(plan.add, [NEWCOMER]);
  });

  it('does not fall back while another self-serve rank is still held', () => {
    const plan = planReactionRemove({
      emoji: '⚔️',
      config: config({ exclusiveRanks: false }),
      memberRoleIds: [RAIDER, SOCIAL],
    });

    assert.deepEqual(plan.remove, [RAIDER]);
    assert.deepEqual(plan.add, []);
  });

  it('is a no-op when the member does not hold the rank', () => {
    // This is the case that keeps the bot from fighting itself: when an
    // exclusive pick pulls the member's stale reaction, the resulting remove
    // event must not hand anything back.
    const plan = planReactionRemove({ emoji: '🍺', config: config(), memberRoleIds: [RAIDER] });

    assert.equal(plan.ok, false);
    assert.equal(plan.reason, 'already-absent');
    assert.deepEqual(plan.remove, []);
    assert.deepEqual(plan.add, []);
  });

  it('ignores unmapped emoji', () => {
    const plan = planReactionRemove({ emoji: '🐔', config: config(), memberRoleIds: [RAIDER] });
    assert.equal(plan.ok, false);
  });
});
