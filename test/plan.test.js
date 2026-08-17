import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PermissionFlagsBits as P } from 'discord.js';

import { RANK_KEYS } from '../src/blueprint.js';
import { overwritesFor, planChannels } from '../src/plan/channels.js';
import { planRoles, summarizePlan } from '../src/plan/roles.js';

describe('planRoles', () => {
  it('creates every rank on an empty server', () => {
    const { steps } = planRoles({ existingRoles: [], boundRoleIds: {} });

    assert.deepEqual(
      steps.map((step) => step.key),
      RANK_KEYS,
    );
    assert.equal(summarizePlan(steps).create, RANK_KEYS.length);
  });

  it('adopts a role that already has the rank name, rather than making a second one', () => {
    const { steps } = planRoles({
      existingRoles: [{ id: '1', name: 'Raider' }],
      boundRoleIds: {},
    });

    const raider = steps.find((step) => step.key === 'raider');
    assert.equal(raider.action, 'adopt');
    assert.equal(raider.roleId, '1');
  });

  it('matches names case- and whitespace-insensitively', () => {
    const { steps } = planRoles({
      existingRoles: [{ id: '1', name: '  guild master ' }],
      boundRoleIds: {},
    });

    assert.equal(steps.find((step) => step.key === 'guildMaster').action, 'adopt');
  });

  it('keeps a binding that is already recorded', () => {
    const { steps } = planRoles({
      existingRoles: [{ id: '99', name: 'Vets' }],
      boundRoleIds: { raider: '99' },
    });

    const raider = steps.find((step) => step.key === 'raider');
    assert.equal(raider.action, 'keep');
    assert.equal(raider.roleId, '99');
    assert.equal(raider.name, 'Vets');
  });

  it('re-creates a rank whose bound role has been deleted', () => {
    const { steps } = planRoles({ existingRoles: [], boundRoleIds: { social: 'gone' } });

    assert.equal(steps.find((step) => step.key === 'social').action, 'create');
  });

  it('never adopts an integration-managed role', () => {
    const { steps } = planRoles({
      existingRoles: [{ id: '1', name: 'Raider', managed: true }],
      boundRoleIds: {},
    });

    assert.equal(steps.find((step) => step.key === 'raider').action, 'create');
  });

  it('proposes nothing destructive', () => {
    const { steps } = planRoles({
      existingRoles: [{ id: '1', name: 'Ancient Guild Role' }],
      boundRoleIds: {},
    });

    assert.ok(steps.every((step) => ['keep', 'adopt', 'create'].includes(step.action)));
  });
});

describe('planChannels', () => {
  it('creates the whole tree on an empty server', () => {
    const { categorySteps, channelSteps } = planChannels({ existing: [] });

    assert.ok(categorySteps.every((step) => step.action === 'create'));
    assert.ok(channelSteps.every((step) => step.action === 'create'));
    assert.ok(channelSteps.some((step) => step.key === 'welcome'));
  });

  it('adopts a category and the channels already inside it', () => {
    const { categorySteps, channelSteps } = planChannels({
      existing: [
        { id: 'cat', name: '📜 Information', type: 'category', parentId: null },
        { id: 'chan', name: 'welcome', type: 'text', parentId: 'cat' },
      ],
    });

    assert.equal(categorySteps.find((step) => step.key === 'information').action, 'adopt');
    const welcome = channelSteps.find((step) => step.key === 'welcome');
    assert.equal(welcome.action, 'adopt');
    assert.equal(welcome.channelId, 'chan');
  });

  it('does not adopt a same-named channel that lives somewhere else', () => {
    const { channelSteps } = planChannels({
      existing: [
        { id: 'cat', name: '💬 Guild', type: 'category', parentId: null },
        { id: 'elsewhere', name: 'general', type: 'text', parentId: 'other-category' },
      ],
    });

    assert.equal(channelSteps.find((step) => step.key === 'general').action, 'create');
  });

  it('compares text channel names the way Discord stores them', () => {
    const { channelSteps } = planChannels({
      existing: [
        { id: 'cat', name: '🗡️ Raid', type: 'category', parentId: null },
        { id: 'chan', name: 'Logs and Parses', type: 'text', parentId: 'cat' },
      ],
    });

    assert.equal(channelSteps.find((step) => step.key === 'logs').action, 'adopt');
  });

  it('does not confuse a voice channel with a text channel of the same name', () => {
    const { channelSteps } = planChannels({
      existing: [
        { id: 'cat', name: '💬 Guild', type: 'category', parentId: null },
        { id: 'chan', name: 'Guild Hall', type: 'text', parentId: 'cat' },
      ],
    });

    assert.equal(channelSteps.find((step) => step.key === 'guildHall').action, 'create');
  });
});

describe('overwritesFor', () => {
  const roleIds = { social: 'role-social', raider: 'role-raider', officer: null };
  const everyoneRoleId = 'everyone';

  it('lets everyone read a public category but not post in it', () => {
    const [everyone] = overwritesFor({
      category: { everyone: 'read', ranks: [] },
      roleIds,
      everyoneRoleId,
    });

    assert.ok(everyone.allow.includes(P.ViewChannel));
    assert.ok(everyone.deny.includes(P.SendMessages));
  });

  it('lets members click the welcome reactions but not add their own', () => {
    const [everyone] = overwritesFor({
      category: { everyone: 'read', ranks: [] },
      channel: { type: 'text', lockReactions: true },
      roleIds,
      everyoneRoleId,
    });

    assert.ok(everyone.deny.includes(P.AddReactions));
    assert.ok(!everyone.allow.includes(P.AddReactions));
    // Clicking an existing reaction needs only these two.
    assert.ok(everyone.allow.includes(P.ViewChannel));
    assert.ok(everyone.allow.includes(P.ReadMessageHistory));
  });

  it('hides a ranked category from everyone else', () => {
    const overwrites = overwritesFor({
      category: { everyone: 'hidden', ranks: ['social'] },
      roleIds,
      everyoneRoleId,
    });

    assert.deepEqual(overwrites[0], { id: 'everyone', allow: [], deny: [P.ViewChannel, P.Connect] });
    assert.ok(overwrites[1].allow.includes(P.SendMessages));
    assert.equal(overwrites[1].id, 'role-social');
  });

  it('grants voice permissions on voice channels', () => {
    const overwrites = overwritesFor({
      category: { everyone: 'hidden', ranks: ['raider'] },
      channel: { type: 'voice' },
      roleIds,
      everyoneRoleId,
    });

    assert.ok(overwrites[1].allow.includes(P.Connect));
    assert.ok(!overwrites[1].allow.includes(P.SendMessages));
  });

  it('skips ranks that are not bound to a role yet', () => {
    const overwrites = overwritesFor({
      category: { everyone: 'hidden', ranks: ['officer', 'social'] },
      roleIds,
      everyoneRoleId,
    });

    assert.equal(overwrites.length, 2);
    assert.ok(overwrites.every((overwrite) => overwrite.id !== null));
  });
});
