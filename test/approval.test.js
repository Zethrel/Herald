import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  ACTIONS,
  approvedIds,
  auditGuilds,
  danglingApprovals,
  isApproved,
  planGuildAccess,
} from '../src/access/approval.js';
import { diagnoseEnvFile, parseIdList, readEnv } from '../src/env.js';

const guild = (id, name = `server ${id}`) => ({ id, name, memberCount: 10, ownerId: 'owner' });

describe('approvedIds', () => {
  it('combines the environment list with the stored one', () => {
    const approved = approvedIds({
      envApproved: ['1'],
      storedApproved: { 2: { note: 'a friend' } },
    });

    assert.deepEqual([...approved].sort(), ['1', '2']);
  });

  it('is empty when nothing has been approved', () => {
    assert.equal(approvedIds({}).size, 0);
  });
});

describe('isApproved', () => {
  it('fails closed on an empty allowlist', () => {
    // The whole point of the list: no entries means nothing is allowed, not
    // everything.
    assert.equal(isApproved('any', new Set()), false);
  });
});

describe('planGuildAccess', () => {
  const approved = new Set(['approved-id']);

  it('leaves an approved server alone', () => {
    const plan = planGuildAccess({ guild: guild('approved-id'), approved });

    assert.deepEqual(plan, {
      guildId: 'approved-id',
      approved: true,
      report: false,
      leave: false,
      isNew: false,
    });
  });

  it('reports and leaves an unapproved server by default', () => {
    const plan = planGuildAccess({ guild: guild('stranger'), approved, isNew: true });

    assert.equal(plan.approved, false);
    assert.equal(plan.report, true);
    assert.equal(plan.leave, true);
    assert.equal(plan.isNew, true);
  });

  it('reports but stays when the action is report', () => {
    const plan = planGuildAccess({ guild: guild('stranger'), approved, action: ACTIONS.report });

    assert.equal(plan.report, true);
    assert.equal(plan.leave, false);
  });
});

describe('auditGuilds', () => {
  it('splits the servers the bot is in', () => {
    const { approved, unapproved } = auditGuilds({
      guilds: [guild('a'), guild('b'), guild('c')],
      approved: new Set(['a', 'c']),
    });

    assert.deepEqual(
      approved.map((entry) => entry.guildId),
      ['a', 'c'],
    );
    assert.deepEqual(
      unapproved.map((entry) => entry.guildId),
      ['b'],
    );
    assert.ok(unapproved.every((entry) => entry.report));
  });

  it('reports every server when nothing is approved', () => {
    const { unapproved } = auditGuilds({ guilds: [guild('a')], approved: new Set() });
    assert.equal(unapproved.length, 1);
  });
});

describe('danglingApprovals', () => {
  it('finds allowlist entries the bot is not in', () => {
    const dangling = danglingApprovals({
      approved: new Set(['a', 'b']),
      presentIds: ['a'],
    });

    assert.deepEqual(dangling, ['b']);
  });
});

describe('parseIdList', () => {
  it('handles commas, spaces and trailing separators', () => {
    assert.deepEqual(parseIdList('1, 2 3,'), ['1', '2', '3']);
  });

  it('treats missing and empty as no ids', () => {
    assert.deepEqual(parseIdList(undefined), []);
    assert.deepEqual(parseIdList('  '), []);
  });
});

describe('readEnv', () => {
  const base = { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c', OWNER_IDS: '1' };

  it('refuses to start without owners to report to', () => {
    assert.throws(
      () => readEnv({ DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'c' }),
      /OWNER_IDS/,
    );
  });

  it('defaults unapproved servers to being left', () => {
    assert.equal(readEnv(base).unapprovedAction, ACTIONS.leave);
  });

  it('rejects an action it does not understand', () => {
    assert.throws(
      () => readEnv({ ...base, UNAPPROVED_SERVER_ACTION: 'ignore' }),
      /UNAPPROVED_SERVER_ACTION/,
    );
  });

  it('reads the allowlist and the owners', () => {
    const env = readEnv({ ...base, OWNER_IDS: '1,2', APPROVED_GUILDS: '10 11' });

    assert.deepEqual(env.ownerIds, ['1', '2']);
    assert.deepEqual(env.approvedGuilds, ['10', '11']);
  });
});

describe('diagnoseEnvFile', () => {
  // The error people actually hit first. It has to name the folder, the file
  // and the fix -- and never the token itself.
  let dir;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'herald-env-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('says which folder it looked in when there is no file', () => {
    const lines = diagnoseEnvFile(dir).join('\n');

    assert.match(lines, new RegExp(`No .env file in ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(lines, /wrong folder/);
  });

  it('spots the Notepad .env.txt trap by name', async () => {
    await writeFile(join(dir, '.env.txt'), 'DISCORD_TOKEN=x\n');
    const lines = diagnoseEnvFile(dir).join('\n');

    assert.match(lines, /Found \.env\.txt instead/);
    assert.match(lines, /hides known extensions/);
    await rm(join(dir, '.env.txt'));
  });

  it('lists the keys a real file defines, and none of their values', async () => {
    await writeFile(join(dir, '.env'), '# a comment\nDISCORD_TOKEN=super.secret.value\nOWNER_IDS=123\n');
    const lines = diagnoseEnvFile(dir).join('\n');

    assert.match(lines, /defining: DISCORD_TOKEN, OWNER_IDS/);
    assert.ok(!lines.includes('super.secret.value'), 'the token must never appear in an error');
    await rm(join(dir, '.env'));
  });

  it('says so when every line is commented out', async () => {
    await writeFile(join(dir, '.env'), '# DISCORD_TOKEN=x\n\n');
    assert.match(diagnoseEnvFile(dir).join('\n'), /blank or commented out/);
    await rm(join(dir, '.env'));
  });
});
