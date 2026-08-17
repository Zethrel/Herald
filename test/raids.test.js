import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  ROSTER_STATUSES,
  applySignup,
  buildRoster,
  createRaid,
  nextRaidId,
  rosterForShopping,
  setSpec,
  withdraw,
} from '../src/raids/model.js';
import { discordTime, isValidTimeZone, parseWhen, zonedTimeToUtc } from '../src/raids/time.js';
import { getMain, saveRaid, setMain, updateRaid, upcomingRaids } from '../src/raids/repository.js';
import {
  buildClassSelect,
  buildRaidButtons,
  buildRaidEmbed,
  buildSpecSelect,
  customId,
  parseCustomId,
} from '../src/raids/render.js';
import { buildReminderMessage } from '../src/raids/scheduler.js';
import { SPECS, specByKey } from '../src/game/specs.js';
import { createStore } from '../src/store.js';

const raidAt = (iso = '2026-08-20T18:00:00Z') =>
  createRaid({ id: 'raid-1', title: 'Heroic', startsAt: new Date(iso), createdBy: 'gm', timeZone: 'UTC' });

describe('parseWhen', () => {
  it('reads a wall-clock time in the given zone', () => {
    // 20:00 in Oslo in August is CEST, two hours ahead of UTC.
    const { date } = parseWhen('2026-08-20 20:00', 'Europe/Oslo');
    assert.equal(date.toISOString(), '2026-08-20T18:00:00.000Z');
  });

  it('handles a winter date in the same zone', () => {
    // CET in January: one hour ahead. Getting this wrong puts a raid an hour out
    // for half the year.
    const { date } = parseWhen('2026-01-20 20:00', 'Europe/Oslo');
    assert.equal(date.toISOString(), '2026-01-20T19:00:00.000Z');
  });

  it('handles a zone on the other side of UTC', () => {
    const { date } = parseWhen('2026-08-20 20:00', 'America/New_York');
    assert.equal(date.toISOString(), '2026-08-21T00:00:00.000Z');
  });

  it('accepts a raw epoch, for anyone pasting from a timestamp generator', () => {
    const { date } = parseWhen('1787260800', 'UTC');
    assert.equal(date.getTime(), 1787260800000);
  });

  it('rejects a malformed time, an impossible date and an unknown zone', () => {
    assert.match(parseWhen('next tuesday', 'UTC').error, /YYYY-MM-DD/);
    assert.match(parseWhen('2026-02-31 20:00', 'UTC').error, /does not exist/);
    assert.match(parseWhen('2026-08-20 25:00', 'UTC').error, /does not exist|YYYY-MM-DD/);
    assert.match(parseWhen('2026-08-20 20:00', 'Middle/Earth').error, /not a timezone/);
  });

  it('agrees with itself across the DST boundary', () => {
    // The clocks go back in Europe on the last Sunday of October.
    const before = zonedTimeToUtc({ year: 2026, month: 10, day: 24, hour: 20, minute: 0 }, 'Europe/Oslo');
    const afterChange = zonedTimeToUtc({ year: 2026, month: 10, day: 26, hour: 20, minute: 0 }, 'Europe/Oslo');

    assert.equal(before.toISOString(), '2026-10-24T18:00:00.000Z');
    assert.equal(afterChange.toISOString(), '2026-10-26T19:00:00.000Z');
  });

  it('knows a valid zone from a made-up one', () => {
    assert.equal(isValidTimeZone('Europe/Oslo'), true);
    assert.equal(isValidTimeZone('Nowhere/Nothing'), false);
  });

  it('renders a Discord timestamp so each reader sees their own clock', () => {
    assert.equal(discordTime(new Date('2026-08-20T18:00:00Z')), '<t:1787248800:F>');
  });
});

describe('nextRaidId', () => {
  it('counts up, and does not reuse an id after a deletion', () => {
    assert.equal(nextRaidId({}), 'raid-1');
    assert.equal(nextRaidId({ 'raid-1': {}, 'raid-2': {} }), 'raid-3');
    assert.equal(nextRaidId({ 'raid-7': {} }), 'raid-8');
  });
});

describe('applySignup', () => {
  it('records a signup with a spec', () => {
    const { raid } = applySignup(raidAt(), { userId: 'u1', status: 'yes', specKey: 'mage.fire' });

    assert.equal(raid.signups.u1.status, 'yes');
    assert.equal(raid.signups.u1.specKey, 'mage.fire');
  });

  it('does not mutate the raid it was given', () => {
    const original = raidAt();
    applySignup(original, { userId: 'u1', status: 'yes' });
    assert.deepEqual(original.signups, {});
  });

  it('keeps the known spec when the status changes', () => {
    const first = applySignup(raidAt(), { userId: 'u1', status: 'yes', specKey: 'mage.fire' }).raid;
    const second = applySignup(first, { userId: 'u1', status: 'late' }).raid;

    assert.equal(second.signups.u1.status, 'late');
    assert.equal(second.signups.u1.specKey, 'mage.fire');
  });

  it('allows an absence with no spec at all', () => {
    const { raid, error } = applySignup(raidAt(), { userId: 'u1', status: 'no', specKey: null });

    assert.equal(error, null);
    assert.equal(raid.signups.u1.specKey, null);
  });

  it('refuses a closed or cancelled raid', () => {
    const closed = { ...raidAt(), closed: true };
    assert.match(applySignup(closed, { userId: 'u1', status: 'yes' }).error, /closed/);

    const cancelled = { ...raidAt(), cancelled: true };
    assert.match(applySignup(cancelled, { userId: 'u1', status: 'yes' }).error, /cancelled/);
  });

  it('rejects a status it does not know', () => {
    assert.match(applySignup(raidAt(), { userId: 'u1', status: 'maybe-ish' }).error, /Unknown status/);
  });
});

describe('withdraw and setSpec', () => {
  it('removes a signup', () => {
    const signed = applySignup(raidAt(), { userId: 'u1', status: 'yes' }).raid;
    const { raid, changed } = withdraw(signed, 'u1');

    assert.equal(changed, true);
    assert.deepEqual(raid.signups, {});
  });

  it('says when there was nothing to remove', () => {
    assert.equal(withdraw(raidAt(), 'nobody').changed, false);
  });

  it('changes a spec without touching the status', () => {
    const signed = applySignup(raidAt(), { userId: 'u1', status: 'late', specKey: 'mage.fire' }).raid;
    const changed = setSpec(signed, 'u1', 'priest.holy');

    assert.equal(changed.signups.u1.specKey, 'priest.holy');
    assert.equal(changed.signups.u1.status, 'late');
  });

  it('does nothing for someone who never signed up', () => {
    const raid = raidAt();
    assert.equal(setSpec(raid, 'ghost', 'mage.fire'), raid);
  });
});

describe('buildRoster', () => {
  function populated() {
    let raid = raidAt();
    const signups = [
      ['tank1', 'yes', 'warrior.protection'],
      ['healer1', 'yes', 'priest.holy'],
      ['healer2', 'yes', 'druid.restoration'],
      ['melee1', 'yes', 'rogue.outlaw'],
      ['ranged1', 'yes', 'mage.fire'],
      ['nospec', 'yes', null],
      ['latecomer', 'late', 'hunter.beastmastery'],
      ['maybe', 'tentative', 'monk.windwalker'],
      ['benched', 'bench', 'warlock.affliction'],
      ['away', 'no', null],
    ];
    for (const [userId, status, specKey] of signups) {
      raid = applySignup(raid, { userId, status, specKey }).raid;
    }
    return raid;
  }

  it('groups the roster by role', () => {
    const { roster, counts } = buildRoster(populated());

    assert.deepEqual(roster.tank.map((entry) => entry.userId), ['tank1']);
    assert.equal(counts.healer, 2);
    assert.equal(counts.melee, 1);
    assert.equal(counts.ranged, 1);
    assert.equal(counts.confirmed, 6);
  });

  it('keeps a signup with no spec visible rather than dropping it', () => {
    const { roster, counts } = buildRoster(populated());

    assert.deepEqual(roster.unknown.map((entry) => entry.userId), ['nospec']);
    assert.equal(counts.unknown, 1);
  });

  it('lists late, tentative, bench and absent separately', () => {
    const { other, counts } = buildRoster(populated());

    assert.deepEqual(other.late.map((entry) => entry.userId), ['latecomer']);
    assert.equal(counts.tentative, 1);
    assert.equal(counts.bench, 1);
    assert.equal(counts.no, 1);
    // Late players count towards the raid, tentative ones do not.
    assert.equal(counts.total, 7);
  });

  it('orders a group by who signed up first', () => {
    let raid = raidAt();
    raid = applySignup(raid, { userId: 'second', status: 'yes', specKey: 'mage.fire' }).raid;
    raid.signups.second.at = '2026-08-19T10:00:00Z';
    raid = applySignup(raid, { userId: 'first', status: 'yes', specKey: 'mage.frost' }).raid;
    raid.signups.first.at = '2026-08-18T10:00:00Z';

    const { roster } = buildRoster(raid);
    assert.deepEqual(roster.ranged.map((entry) => entry.userId), ['first', 'second']);
  });
});

describe('rosterForShopping', () => {
  it('counts heads per spec for the people who will be there', () => {
    let raid = raidAt();
    for (const [userId, status, specKey] of [
      ['a', 'yes', 'mage.fire'],
      ['b', 'yes', 'mage.fire'],
      ['c', 'late', 'priest.holy'],
      ['d', 'tentative', 'mage.fire'],
      ['e', 'bench', 'mage.fire'],
      ['f', 'no', 'mage.fire'],
    ]) {
      raid = applySignup(raid, { userId, status, specKey }).raid;
    }

    const { roster } = rosterForShopping(raid);
    const counts = Object.fromEntries(roster.map((entry) => [entry.spec.key, entry.count]));

    // Late needs a flask; tentative, bench and absent do not.
    assert.deepEqual(counts, { 'mage.fire': 2, 'priest.holy': 1 });
    assert.deepEqual(ROSTER_STATUSES, ['yes', 'late']);
  });

  it('reports the people who never set a spec instead of under-counting silently', () => {
    const raid = applySignup(raidAt(), { userId: 'mystery', status: 'yes', specKey: null }).raid;
    const { roster, unknown } = rosterForShopping(raid);

    assert.deepEqual(roster, []);
    assert.deepEqual(unknown, ['mystery']);
  });

  it('produces exactly what buildShoppingList expects', () => {
    const raid = applySignup(raidAt(), { userId: 'a', status: 'yes', specKey: 'mage.fire' }).raid;
    const { roster } = rosterForShopping(raid);

    assert.equal(roster[0].spec, specByKey('mage.fire'));
    assert.equal(roster[0].count, 1);
  });
});

describe('component custom ids', () => {
  it('round-trip', () => {
    assert.deepEqual(parseCustomId(customId('raid-1', 'status', 'yes')), {
      raidId: 'raid-1',
      action: 'status',
      argument: 'yes',
    });
    assert.deepEqual(parseCustomId(customId('raid-1', 'changespec')), {
      raidId: 'raid-1',
      action: 'changespec',
      argument: null,
    });
  });

  it('ignores anything that is not ours', () => {
    assert.equal(parseCustomId('something:else:entirely'), null);
    assert.equal(parseCustomId(''), null);
    assert.equal(parseCustomId(undefined), null);
  });
});

describe('the raid repository', () => {
  let dir;
  let store;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'herald-raids-'));
    store = createStore(join(dir, 'guilds.json'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('saves and reads a raid back', async () => {
    await saveRaid(store, 'g1', raidAt());
    const config = await store.get('g1');

    assert.equal(config.raids['raid-1'].title, 'Heroic');
  });

  it('does not lose a signup when twenty people click at once', async () => {
    // The reason updateRaid takes a lock: a plain read-modify-write would keep
    // only the last of these.
    await saveRaid(store, 'g2', raidAt());

    await Promise.all(
      Array.from({ length: 20 }, (unused, index) =>
        updateRaid(store, 'g2', 'raid-1', (raid) =>
          applySignup(raid, { userId: `u${index}`, status: 'yes', specKey: 'mage.fire' }),
        ),
      ),
    );

    const config = await store.get('g2');
    assert.equal(Object.keys(config.raids['raid-1'].signups).length, 20);
  });

  it('reports a raid that is gone rather than throwing', async () => {
    const { error } = await updateRaid(store, 'g2', 'raid-404', (raid) => raid);
    assert.match(error, /no longer exists/);
  });

  it('passes a mutation error through without writing', async () => {
    await saveRaid(store, 'g3', { ...raidAt(), closed: true });

    const { error } = await updateRaid(store, 'g3', 'raid-1', (raid) =>
      applySignup(raid, { userId: 'u1', status: 'yes' }),
    );

    assert.match(error, /closed/);
    assert.deepEqual((await store.get('g3')).raids['raid-1'].signups, {});
  });

  it('remembers what someone plays, per server', async () => {
    await setMain(store, 'g1', 'u1', 'mage.fire');

    assert.equal(await getMain(store, 'g1', 'u1'), 'mage.fire');
    assert.equal(await getMain(store, 'g2', 'u1'), null);
  });

  it('lists upcoming raids soonest first, without cancelled ones', async () => {
    await saveRaid(store, 'g4', { ...raidAt('2026-09-01T18:00:00Z'), id: 'raid-2' });
    await saveRaid(store, 'g4', { ...raidAt('2026-08-25T18:00:00Z'), id: 'raid-1' });
    await saveRaid(store, 'g4', { ...raidAt('2026-08-26T18:00:00Z'), id: 'raid-3', cancelled: true });
    await saveRaid(store, 'g4', { ...raidAt('2020-01-01T18:00:00Z'), id: 'raid-4' });

    const upcoming = await upcomingRaids(store, 'g4', Date.parse('2026-08-20T00:00:00Z'));

    assert.deepEqual(
      upcoming.map((raid) => raid.id),
      ['raid-1', 'raid-2'],
    );
  });
});

describe('a full raid stays inside Discord limits', () => {
  // Discord rejects a message rather than truncating it, so the biggest
  // realistic post is worth asserting rather than discovering on raid night.
  function fullRaid(size) {
    let raid = raidAt();
    for (let index = 0; index < size; index += 1) {
      // Real 18-digit snowflakes as strings: building them with arithmetic
      // silently collapses past Number.MAX_SAFE_INTEGER.
      const userId = String(100000000000000000n + BigInt(index));
      raid = applySignup(raid, { userId, status: 'yes', specKey: SPECS[index % SPECS.length].key }).raid;
    }
    return raid;
  }

  it('renders a 40-signup post within the embed limits', () => {
    const embed = buildRaidEmbed(fullRaid(40)).toJSON();

    assert.ok(embed.fields.length <= 25, `${embed.fields.length} fields`);
    assert.ok(JSON.stringify(embed).length < 6000, 'embed under 6000 characters');
    for (const field of embed.fields) {
      assert.ok(field.value.length <= 1024, `field "${field.name}" is ${field.value.length} characters`);
      assert.ok(field.name.length <= 256, `field name "${field.name}" too long`);
    }
  });

  it('keeps every button and select inside its own limits', () => {
    const raid = fullRaid(40);
    const rows = buildRaidButtons(raid);

    assert.ok(rows.length <= 5, 'at most five action rows');
    for (const row of rows) {
      const json = row.toJSON();
      assert.ok(json.components.length <= 5, 'at most five components per row');
      for (const component of json.components) {
        assert.ok(component.custom_id.length <= 100, `custom_id ${component.custom_id.length} characters`);
      }
    }

    assert.ok(buildClassSelect(raid.id, 'yes').toJSON().components[0].options.length <= 25);
    for (const className of new Set(SPECS.map((spec) => spec.className))) {
      const options = buildSpecSelect(raid.id, 'yes', className).toJSON().components[0].options;
      assert.ok(options.length > 0 && options.length <= 25, `${className}: ${options.length} options`);
    }
  });

  it('keeps a 40-raider reminder ping under the message limit', () => {
    const message = buildReminderMessage(fullRaid(40), 60);

    assert.equal(message.allowedMentions.users.length, 40);
    assert.ok(message.content.length <= 2000, `${message.content.length} characters of mentions`);
  });
});
