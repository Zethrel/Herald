import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  DEFAULT_LEAD_MINUTES,
  audienceFor,
  describeSchedule,
  dueReminders,
  formatLead,
  leadMinutesFor,
  markReminded,
  parseLeadMinutes,
} from '../src/raids/reminders.js';
import { applySignup, createRaid } from '../src/raids/model.js';
import { buildReminderMessage, createReminderScheduler } from '../src/raids/scheduler.js';
import { createStore } from '../src/store.js';
import { saveRaid } from '../src/raids/repository.js';

const START = '2026-08-20T18:00:00Z';
const startMs = Date.parse(START);
const minutesBefore = (minutes) => startMs - minutes * 60_000;

function raidWith(signups = [['u1', 'yes', 'mage.fire']], overrides = {}) {
  let raid = createRaid({
    id: 'raid-1',
    title: 'Heroic',
    startsAt: new Date(START),
    createdBy: 'gm',
    timeZone: 'UTC',
  });
  for (const [userId, status, specKey] of signups) {
    raid = applySignup(raid, { userId, status, specKey }).raid;
  }
  return { ...raid, ...overrides };
}

describe('parseLeadMinutes', () => {
  it('reads hours, minutes and bare numbers', () => {
    assert.deepEqual(parseLeadMinutes('24h, 1h').leadMinutes, [1440, 60]);
    assert.deepEqual(parseLeadMinutes('90m').leadMinutes, [90]);
    assert.deepEqual(parseLeadMinutes('1440 60').leadMinutes, [1440, 60]);
  });

  it('sorts furthest out first and drops duplicates', () => {
    assert.deepEqual(parseLeadMinutes('1h, 24h, 60m').leadMinutes, [1440, 60]);
  });

  it('understands turning them off', () => {
    assert.deepEqual(parseLeadMinutes('off').leadMinutes, []);
    assert.deepEqual(parseLeadMinutes('none').leadMinutes, []);
  });

  it('rejects nonsense and out-of-range values', () => {
    assert.match(parseLeadMinutes('soon').error, /cannot read/);
    assert.match(parseLeadMinutes('').error, /lead times/);
    assert.match(parseLeadMinutes('0m').error, /out of range/);
    assert.match(parseLeadMinutes('9999h').error, /out of range/);
  });
});

describe('formatLead and describeSchedule', () => {
  it('reads naturally', () => {
    assert.equal(formatLead(1440), '1 day');
    assert.equal(formatLead(2880), '2 days');
    assert.equal(formatLead(60), '1 hour');
    assert.equal(formatLead(90), '90 minutes');
    assert.equal(describeSchedule([1440, 60]), '1 day before, 1 hour before');
    assert.equal(describeSchedule([]), 'off');
  });
});

describe('leadMinutesFor', () => {
  it("prefers the raid's own schedule", () => {
    const raid = raidWith([], { reminders: { leadMinutes: [30], sent: [] } });
    assert.deepEqual(leadMinutesFor(raid, { reminders: { leadMinutes: [1440] } }), [30]);
  });

  it('falls back to the server, then to the default', () => {
    const raid = raidWith();
    assert.deepEqual(leadMinutesFor(raid, { reminders: { leadMinutes: [120] } }), [120]);
    assert.deepEqual(leadMinutesFor(raid, {}), DEFAULT_LEAD_MINUTES);
  });

  it('treats an empty list as deliberately off, not as unset', () => {
    const raid = raidWith([], { reminders: { leadMinutes: [], sent: [] } });
    assert.deepEqual(leadMinutesFor(raid, { reminders: { leadMinutes: [60] } }), []);
  });
});

describe('dueReminders', () => {
  const leadMinutes = [1440, 60];

  it('sends nothing before the first lead time', () => {
    const { due, expired } = dueReminders({
      raid: raidWith(),
      leadMinutes,
      now: minutesBefore(2000),
    });

    assert.deepEqual(due, []);
    assert.deepEqual(expired, []);
  });

  it('sends the day-before reminder when it comes due', () => {
    const { due } = dueReminders({ raid: raidWith(), leadMinutes, now: minutesBefore(1439) });
    assert.deepEqual(due, [1440]);
  });

  it('never sends the same reminder twice', () => {
    const raid = raidWith([['u1', 'yes', 'mage.fire']], { reminders: { leadMinutes: null, sent: [1440] } });
    const { due } = dueReminders({ raid, leadMinutes, now: minutesBefore(1439) });

    assert.deepEqual(due, []);
  });

  it('still sends a reminder that is a few minutes late', () => {
    const { due } = dueReminders({ raid: raidWith(), leadMinutes, now: minutesBefore(45) });
    assert.deepEqual(due, [60]);
  });

  it('drops a late reminder when an earlier one already went out', () => {
    // The day-before ping was sent, then the bot was down through the
    // hour-before window. That one is no longer useful and the roster has
    // already been told about the raid, so it is closed out rather than sent.
    const raid = raidWith([['u1', 'yes', 'mage.fire']], { reminders: { leadMinutes: null, sent: [1440] } });
    const { due, expired, catchUp } = dueReminders({ raid, leadMinutes, now: minutesBefore(20) });

    assert.deepEqual(due, []);
    assert.deepEqual(expired, [60]);
    assert.equal(catchUp, false);
  });

  it('pings once for a raid announced at short notice', () => {
    // Posted twenty minutes before the pull: every lead time is already behind
    // it. Saying nothing would be exactly backwards -- short notice is when
    // people most need telling.
    const { due, expired, catchUp } = dueReminders({ raid: raidWith(), leadMinutes, now: minutesBefore(20) });

    assert.equal(catchUp, true);
    assert.deepEqual(due, [60]);
    // The rest are closed out in the same pass, so this fires exactly once.
    assert.deepEqual(expired, [1440]);
  });

  it('pings once when the bot was offline through every window', () => {
    // Nobody was ever told and the raid is soon: same answer, same rule.
    const { due, catchUp } = dueReminders({
      raid: raidWith(),
      leadMinutes: [1440, 120],
      now: minutesBefore(10),
    });

    assert.equal(catchUp, true);
    assert.deepEqual(due, [120]);
  });

  it('does not catch up on a raid that has already started', () => {
    const { due, expired, catchUp } = dueReminders({
      raid: raidWith(),
      leadMinutes,
      now: startMs + 60_000,
    });

    assert.deepEqual(due, []);
    assert.deepEqual(expired, [1440, 60]);
    assert.equal(catchUp, false);
  });

  it('does not catch up when reminders are off', () => {
    const raid = raidWith([['u1', 'yes', 'mage.fire']], { reminders: { leadMinutes: [], sent: [] } });
    const { due, catchUp } = dueReminders({ raid, leadMinutes: [], now: minutesBefore(5) });

    assert.deepEqual(due, []);
    assert.equal(catchUp, false);
  });

  it('never announces a raid that has already started', () => {
    const { due, expired } = dueReminders({
      raid: raidWith(),
      leadMinutes: [15],
      now: startMs + 60_000,
    });

    assert.deepEqual(due, []);
    assert.deepEqual(expired, [15]);
  });

  it('closes out both reminders when the raid is already over', () => {
    const { due, expired, catchUp } = dueReminders({
      raid: raidWith(),
      leadMinutes,
      now: startMs + 3_600_000,
    });

    assert.deepEqual(due, []);
    assert.deepEqual(expired, [1440, 60]);
    assert.equal(catchUp, false);
  });

  it('never pings for a cancelled raid, and closes its reminders out', () => {
    const raid = raidWith([['u1', 'yes', 'mage.fire']], { cancelled: true });
    const { due, expired, catchUp } = dueReminders({ raid, leadMinutes, now: minutesBefore(59) });

    assert.deepEqual(due, []);
    assert.deepEqual(expired, [1440, 60]);
    assert.equal(catchUp, false);
  });

  it('does nothing when reminders are off', () => {
    assert.deepEqual(dueReminders({ raid: raidWith(), leadMinutes: [], now: startMs }), {
      due: [],
      expired: [],
      catchUp: false,
    });
  });
});

describe('markReminded', () => {
  it('records what has been dealt with', () => {
    const raid = markReminded(raidWith(), [60]);
    assert.deepEqual(raid.reminders.sent, [60]);
    assert.ok(raid.reminders.lastRemindedAt);
  });

  it('adds without losing what was there, and does not mutate', () => {
    const first = markReminded(raidWith(), [1440]);
    const second = markReminded(first, [60]);

    assert.deepEqual(second.reminders.sent, [1440, 60]);
    assert.deepEqual(first.reminders.sent, [1440]);
  });
});

describe('audienceFor', () => {
  it('pings the people who said they are coming, late ones included', () => {
    const raid = raidWith([
      ['yes1', 'yes', 'mage.fire'],
      ['late1', 'late', 'priest.holy'],
      ['maybe1', 'tentative', 'rogue.outlaw'],
      ['bench1', 'bench', 'mage.frost'],
      ['away1', 'no', null],
    ]);

    const { confirmed, tentative } = audienceFor(raid);

    assert.deepEqual(confirmed, ['yes1', 'late1']);
    assert.deepEqual(tentative, ['maybe1']);
  });
});

describe('buildReminderMessage', () => {
  it('mentions only the people signed up', () => {
    const raid = raidWith([
      ['yes1', 'yes', 'mage.fire'],
      ['maybe1', 'tentative', 'rogue.outlaw'],
      ['away1', 'no', null],
    ]);

    const message = buildReminderMessage(raid, 60);

    assert.equal(message.content, '<@yes1> <@maybe1>');
    // parse: [] is what stops a stray @everyone in a raid title from pinging
    // the server.
    assert.deepEqual(message.allowedMentions, { users: ['yes1', 'maybe1'], parse: [] });
    assert.match(message.embeds[0].data.title, /1 hour to go/);
  });

  it('asks the tentatives to confirm', () => {
    const raid = raidWith([['maybe1', 'tentative', 'rogue.outlaw']]);
    assert.match(buildReminderMessage(raid, 60).embeds[0].data.description, /still tentative/);
  });
});

describe('the reminder scheduler', () => {
  async function harness({ now, raid, guildId = 'g1', approved = ['g1'] }) {
    const dir = await mkdtemp(join(tmpdir(), 'herald-reminders-'));
    const store = createStore(join(dir, 'guilds.json'));
    await saveRaid(store, guildId, { ...raid, channelId: 'c1', messageId: 'm1' });

    const sent = [];
    const client = {
      channels: {
        async fetch() {
          return {
            async send(payload) {
              sent.push(payload);
              return { id: 'msg' };
            },
          };
        },
      },
    };

    const scheduler = createReminderScheduler({
      client,
      store,
      env: { approvedGuilds: approved },
      log: { info() {}, warn() {}, debug() {}, error() {} },
      now: () => now,
    });

    return { scheduler, store, sent, guildId, cleanup: () => rm(dir, { recursive: true, force: true }) };
  }

  it('pings the roster when a reminder comes due', async () => {
    const { scheduler, sent, store, guildId, cleanup } = await harness({
      now: minutesBefore(59),
      raid: raidWith(),
    });

    await scheduler.tick();

    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, '<@u1>');
    // Recorded, so the next tick is quiet. The day-before reminder is closed
    // out in the same pass: this raid was posted less than a day ahead, so it
    // was never going to fire.
    const config = await store.get(guildId);
    assert.deepEqual(config.raids['raid-1'].reminders.sent, [1440, 60]);

    await cleanup();
  });

  it('does not ping twice, however often it ticks', async () => {
    const { scheduler, sent, cleanup } = await harness({ now: minutesBefore(59), raid: raidWith() });

    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    assert.equal(sent.length, 1);
    await cleanup();
  });

  it('sends one catch-up ping for a short-notice raid, and only one', async () => {
    const { scheduler, sent, store, guildId, cleanup } = await harness({
      now: minutesBefore(5),
      raid: raidWith(),
    });

    await scheduler.tick();
    await scheduler.tick();

    assert.equal(sent.length, 1);
    // Not "1 hour to go" -- the raid is five minutes away.
    assert.match(sent[0].embeds[0].data.title, /starting soon/);

    const config = await store.get(guildId);
    assert.deepEqual(config.raids['raid-1'].reminders.sent, [1440, 60]);

    await cleanup();
  });

  it('does not catch up once the raid has started', async () => {
    const { scheduler, sent, store, guildId, cleanup } = await harness({
      now: startMs + 60_000,
      raid: raidWith(),
    });

    await scheduler.tick();

    assert.equal(sent.length, 0);
    const config = await store.get(guildId);
    assert.deepEqual(config.raids['raid-1'].reminders.sent, [1440, 60]);

    await cleanup();
  });

  it('sends nothing for a raid nobody signed up to', async () => {
    const { scheduler, sent, cleanup } = await harness({
      now: minutesBefore(59),
      raid: raidWith([]),
    });

    await scheduler.tick();

    assert.equal(sent.length, 0);
    await cleanup();
  });

  it('stays silent in a server that is not approved', async () => {
    const { scheduler, sent, cleanup } = await harness({
      now: minutesBefore(59),
      raid: raidWith(),
      approved: ['some-other-guild'],
    });

    await scheduler.tick();

    assert.equal(sent.length, 0);
    await cleanup();
  });

  it('survives a channel that has been deleted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'herald-reminders-'));
    const store = createStore(join(dir, 'guilds.json'));
    await saveRaid(store, 'g1', { ...raidWith(), channelId: 'gone', messageId: 'm1' });

    const scheduler = createReminderScheduler({
      client: {
        channels: {
          async fetch() {
            throw new Error('Unknown Channel');
          },
        },
      },
      store,
      env: { approvedGuilds: ['g1'] },
      log: { info() {}, warn() {}, debug() {}, error() {} },
      now: () => minutesBefore(59),
    });

    await scheduler.tick();

    // Marked as handled regardless, so it does not retry every minute forever.
    const config = await store.get('g1');
    assert.deepEqual(config.raids['raid-1'].reminders.sent, [1440, 60]);

    await rm(dir, { recursive: true, force: true });
  });
});
