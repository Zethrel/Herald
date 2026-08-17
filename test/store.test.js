import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createStore, defaultGuildConfig, mergeConfig } from '../src/store.js';

describe('mergeConfig', () => {
  it('merges nested objects one level deep instead of replacing them', () => {
    const merged = mergeConfig({ roles: { a: '1', b: '2' } }, { roles: { b: '3' } });
    assert.deepEqual(merged.roles, { a: '1', b: '3' });
  });

  it('replaces scalars outright', () => {
    assert.equal(mergeConfig({ exclusiveRanks: true }, { exclusiveRanks: false }).exclusiveRanks, false);
  });

  it('does not mutate the config it was given', () => {
    const original = { roles: { a: '1' } };
    mergeConfig(original, { roles: { a: '2' } });
    assert.equal(original.roles.a, '1');
  });
});

describe('defaultGuildConfig', () => {
  it('starts with every rank unbound and the blueprint defaults set', () => {
    const config = defaultGuildConfig();

    assert.equal(config.defaultRankKey, 'newcomer');
    assert.equal(config.roles.raider, null);
    assert.equal(config.exclusiveRanks, true);
    assert.deepEqual(config.selfAssign, { '⚔️': 'raider', '🍺': 'social' });
  });
});

describe('createStore', () => {
  let dir;
  let file;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'guild-bot-store-'));
    file = join(dir, 'nested', 'guilds.json');
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns defaults for a server it has never seen', async () => {
    const store = createStore(file);
    assert.deepEqual(await store.get('unknown'), defaultGuildConfig());
  });

  it('persists an update and reloads it from disk', async () => {
    const store = createStore(file);
    await store.update('guild-1', { roles: { raider: 'role-raider' } });

    const reopened = createStore(file);
    const config = await reopened.get('guild-1');

    assert.equal(config.roles.raider, 'role-raider');
    // The rest of the shape survives a round trip.
    assert.equal(config.defaultRankKey, 'newcomer');
    assert.equal(config.roles.social, null);
  });

  it('keeps servers separate', async () => {
    const store = createStore(file);
    await store.update('guild-1', { welcome: { channelId: 'c1', messageId: 'm1' } });
    await store.update('guild-2', { welcome: { channelId: 'c2', messageId: 'm2' } });

    assert.equal((await store.get('guild-1')).welcome.messageId, 'm1');
    assert.equal((await store.get('guild-2')).welcome.messageId, 'm2');
  });

  it('does not lose a write when two updates land at once', async () => {
    const store = createStore(file);
    await Promise.all([
      store.update('guild-3', { roles: { raider: 'r' } }),
      store.update('guild-3', { roles: { social: 's' } }),
      store.update('guild-3', { roles: { newcomer: 'n' } }),
    ]);

    const written = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(
      { ...written.guilds['guild-3'].roles },
      { ...(await store.get('guild-3')).roles },
    );
    assert.equal(written.guilds['guild-3'].roles.raider, 'r');
    assert.equal(written.guilds['guild-3'].roles.social, 's');
    assert.equal(written.guilds['guild-3'].roles.newcomer, 'n');
  });

  it('forgets a server on request', async () => {
    const store = createStore(file);
    await store.update('guild-4', { roles: { raider: 'r' } });
    await store.forget('guild-4');

    assert.equal((await createStore(file).get('guild-4')).roles.raider, null);
  });
});
