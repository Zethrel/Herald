import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { holdsARank, planBackfill, planJoin } from '../src/ranks/membership.js';

const config = {
  roles: {
    guildMaster: 'role-gm',
    officer: 'role-officer',
    raider: 'role-raider',
    social: 'role-social',
    newcomer: 'role-newcomer',
    trial: null,
  },
  defaultRankKey: 'newcomer',
};

describe('planJoin', () => {
  it('gives a new member the default rank', () => {
    const plan = planJoin({ isBot: false, memberRoleIds: [], config });

    assert.equal(plan.assign, 'role-newcomer');
    assert.equal(plan.reason, 'new-member');
  });

  it('leaves bots alone', () => {
    const plan = planJoin({ isBot: true, memberRoleIds: [], config });
    assert.equal(plan.assign, null);
    assert.equal(plan.reason, 'bot');
  });

  it('leaves a returning member who still holds a rank alone', () => {
    const plan = planJoin({ isBot: false, memberRoleIds: ['role-raider'], config });

    assert.equal(plan.assign, null);
    assert.equal(plan.reason, 'already-ranked');
  });

  it('does nothing when no default rank is bound', () => {
    const plan = planJoin({
      isBot: false,
      memberRoleIds: [],
      config: { ...config, roles: { ...config.roles, newcomer: null } },
    });

    assert.equal(plan.assign, null);
    assert.equal(plan.reason, 'no-default-rank');
  });
});

describe('holdsARank', () => {
  it('ignores roles that are not guild ranks', () => {
    assert.equal(holdsARank(['role-colour-purple'], config), false);
  });

  it('counts any bound rank, not just the self-serve ones', () => {
    assert.equal(holdsARank(['role-officer'], config), true);
  });
});

describe('planBackfill', () => {
  const roster = [
    { id: 'gm', isBot: false, roleIds: ['role-gm'] },
    { id: 'veteran-raider', isBot: false, roleIds: ['role-raider'] },
    { id: 'lurker', isBot: false, roleIds: [] },
    { id: 'decorative-role-only', isBot: false, roleIds: ['role-colour-purple'] },
    { id: 'some-bot', isBot: true, roleIds: [] },
  ];

  it('only touches members with no rank at all', () => {
    const plan = planBackfill(roster, config);

    assert.deepEqual(plan.assign, ['lurker', 'decorative-role-only']);
    assert.equal(plan.skipped.alreadyRanked, 2);
    assert.equal(plan.skipped.bots, 1);
    assert.equal(plan.defaultRoleId, 'role-newcomer');
  });

  it('refuses to do anything without a default rank', () => {
    const plan = planBackfill(roster, { ...config, roles: { ...config.roles, newcomer: null } });

    assert.equal(plan.defaultRoleId, null);
    assert.deepEqual(plan.assign, []);
  });
});
