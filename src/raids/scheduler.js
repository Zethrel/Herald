// The clock that sends the reminders.
//
// A minute ticker rather than a timer per raid: timers do not survive a
// restart, and a raid posted three weeks out would need one held for three
// weeks. Everything a tick needs is in the store, so the process can stop and
// start whenever and the answer stays the same.

import { EmbedBuilder } from 'discord.js';

import { BRAND_COLOR, FOOTER } from '../branding.js';
import { audienceFor, dueReminders, formatLead, leadMinutesFor, markReminded } from './reminders.js';
import { currentApproved } from '../access/guard.js';
import { discordTime } from './time.js';
import { updateRaid } from './repository.js';

export const TICK_MS = 60_000;

export function buildReminderMessage(raid, lead) {
  const { confirmed, tentative } = audienceFor(raid);
  const startsAt = new Date(raid.startsAt);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${raid.title} — ${formatLead(lead)} to go`)
    .setDescription(
      [
        `${discordTime(startsAt, 'F')} · ${discordTime(startsAt, 'R')}`,
        raid.description ?? null,
        confirmed.length > 0 ? `**${confirmed.length}** on the roster.` : null,
        tentative.length > 0
          ? `${tentative.length} still tentative — please confirm on the signup.`
          : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: `${raid.id} · ${FOOTER}` });

  const mentions = [...confirmed, ...tentative].map((userId) => `<@${userId}>`).join(' ');

  return {
    content: mentions,
    embeds: [embed],
    // Only the people actually signed up. No @everyone, no role sweeps, however
    // the description or title happens to be worded.
    allowedMentions: { users: [...confirmed, ...tentative], parse: [] },
  };
}

export function createReminderScheduler({ client, store, env, log, now = () => Date.now() }) {
  let timer = null;
  let running = false;

  async function sendReminder(guildId, raid, lead) {
    if (!raid.channelId) return false;

    const { confirmed, tentative } = audienceFor(raid);
    if (confirmed.length === 0 && tentative.length === 0) {
      // Nobody to ping. Still recorded as done, so it does not retry every
      // minute for the rest of the raid's life.
      log.debug(`${raid.id}: ${formatLead(lead)} reminder skipped, nobody signed up`);
      return false;
    }

    const channel = await client.channels.fetch(raid.channelId);
    const message = await channel.send(buildReminderMessage(raid, lead));

    // Threading the reminder under the signup post keeps the channel readable
    // when several raids are open at once.
    log.info(
      `${raid.id}: pinged ${confirmed.length + tentative.length} raider(s), ${formatLead(lead)} before`,
    );
    return message;
  }

  async function tickGuild(guildId, config) {
    if (config.reminders?.enabled === false) return;

    const raids = Object.values(config.raids ?? {});
    const at = now();

    for (const raid of raids) {
      const leadMinutes = leadMinutesFor(raid, config);
      const { due, expired } = dueReminders({ raid, leadMinutes, now: at });
      if (due.length === 0 && expired.length === 0) continue;

      for (const lead of expired) {
        log.debug(`${raid.id}: ${formatLead(lead)} reminder missed its window, closing it out`);
      }

      // Record before sending. A crash between the two costs one reminder; the
      // other order costs everyone a duplicate ping every minute until it
      // succeeds, which is worse.
      const handled = [...due, ...expired];
      await updateRaid(store, guildId, raid.id, (current) => markReminded(current, handled));

      for (const lead of due) {
        try {
          await sendReminder(guildId, raid, lead);
        } catch (error) {
          log.warn(`${raid.id}: could not send the ${formatLead(lead)} reminder — ${error.message}`);
        }
      }
    }
  }

  async function tick() {
    // A slow tick must not overlap the next one.
    if (running) return;
    running = true;

    try {
      const approved = await currentApproved({ store, env });
      const guilds = await store.all();

      for (const [guildId, config] of guilds) {
        // Reminders are the bot working; an unapproved server gets none.
        if (!approved.has(guildId)) continue;
        await tickGuild(guildId, config);
      }
    } catch (error) {
      log.error(`Reminder tick failed: ${error.stack ?? error.message}`);
    } finally {
      running = false;
    }
  }

  return {
    tick,

    start() {
      if (timer) return;
      // Once on startup, so a reminder that came due during a restart is
      // caught (or closed out) immediately rather than up to a minute later.
      void tick();
      timer = setInterval(() => void tick(), TICK_MS);
      timer.unref?.();
      log.info('Raid reminders are running');
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
