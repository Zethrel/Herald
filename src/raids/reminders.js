// When to ping the roster, and who.
//
// Pure. Two properties matter more than anything else here, and both are
// decided in this file rather than by the scheduler that calls it:
//
//   * a reminder is sent at most once, ever. The record of what has been sent
//     lives on the raid, so a restart -- or two bot instances -- cannot produce
//     a second ping.
//   * a reminder that is too late is dropped, not sent. A bot that was offline
//     for three hours must not wake up and announce a raid that already
//     started.

/** A day before, and an hour before. */
export const DEFAULT_LEAD_MINUTES = [1440, 60];

/** How late a reminder may be and still be worth sending. */
export const DEFAULT_GRACE_MINUTES = 30;

const WEEK_IN_MINUTES = 7 * 24 * 60;

/**
 * Read "1440,60", "24h, 1h", "90m" or "off".
 *
 * @returns {{leadMinutes: number[]}|{error: string}}
 */
export function parseLeadMinutes(text) {
  const trimmed = (text ?? '').trim().toLowerCase();
  if (!trimmed) return { error: 'Give me some lead times, e.g. `24h, 1h`.' };
  if (['off', 'none', 'no', '0'].includes(trimmed)) return { leadMinutes: [] };

  const minutes = [];
  for (const part of trimmed.split(/[\s,]+/).filter(Boolean)) {
    const match = part.match(/^(\d+)\s*([hm]?)$/);
    if (!match) return { error: `I cannot read "${part}". Use \`24h\`, \`90m\` or plain minutes.` };

    const value = Number(match[1]) * (match[2] === 'h' ? 60 : 1);
    if (value < 1 || value > WEEK_IN_MINUTES) {
      return { error: `${part} is out of range — between a minute and a week, please.` };
    }
    minutes.push(value);
  }

  // Furthest out first, so the reminders read in the order they will arrive.
  return { leadMinutes: [...new Set(minutes)].sort((a, b) => b - a) };
}

export function formatLead(minutes) {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '1 day' : `${days} days`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  return `${minutes} minutes`;
}

export function describeSchedule(leadMinutes) {
  if (!leadMinutes || leadMinutes.length === 0) return 'off';
  return leadMinutes.map((lead) => `${formatLead(lead)} before`).join(', ');
}

/** A raid's own schedule, or the server's if it has none of its own. */
export function leadMinutesFor(raid, guildConfig) {
  const own = raid?.reminders?.leadMinutes;
  if (Array.isArray(own)) return own;

  const guild = guildConfig?.reminders?.leadMinutes;
  return Array.isArray(guild) ? guild : DEFAULT_LEAD_MINUTES;
}

/**
 * Which reminders for one raid are due now, and which have gone past being
 * worth sending.
 *
 * `expired` matters as much as `due`: the caller records those as sent too, so
 * a reminder missed during downtime is closed out rather than firing the moment
 * the bot returns.
 *
 * `catchUp` is the exception. A raid announced two hours before it starts would
 * otherwise have every lead time already behind it and get no ping at all,
 * which is precisely backwards -- short notice is when people most need
 * telling. So: a raid that has never been reminded, has not started, and has
 * run out of lead times gets exactly one ping now. The same rule covers the bot
 * having been offline through every window; nobody was told, the raid is soon,
 * one ping is the right answer.
 *
 * @returns {{due: number[], expired: number[], catchUp: boolean}}
 */
export function dueReminders({ raid, leadMinutes, now = Date.now(), graceMinutes = DEFAULT_GRACE_MINUTES }) {
  const sent = new Set(raid?.reminders?.sent ?? []);
  const pending = (leadMinutes ?? []).filter((lead) => !sent.has(lead));
  const nothing = { due: [], expired: [], catchUp: false };

  // No lead times at all means reminders are off, and off means off.
  if (pending.length === 0) return nothing;

  // A cancelled raid is never announced -- but its reminders are closed out, so
  // they cannot fire if it is somehow reopened later.
  if (raid.cancelled) return { ...nothing, expired: pending };

  const startsAt = Date.parse(raid.startsAt);
  if (Number.isNaN(startsAt)) return { ...nothing, expired: pending };

  const due = [];
  const expired = [];

  for (const lead of pending) {
    const dueAt = startsAt - lead * 60_000;
    if (now < dueAt) continue; // Still in the future.

    // Never remind after the raid has started, however short the delay was.
    const windowEnds = Math.min(dueAt + graceMinutes * 60_000, startsAt);
    if (now < windowEnds) due.push(lead);
    else expired.push(lead);
  }

  const missedEverything =
    due.length === 0 && expired.length === pending.length && sent.size === 0 && now < startsAt;

  if (!missedEverything) return { due, expired, catchUp: false };

  // Ping against the nearest lead time and close out the rest. Which one it is
  // recorded under barely matters -- all of them are marked sent either way --
  // but the message must not claim to be the hour-before one when the raid is
  // twenty minutes away, so the caller is told this is a catch-up.
  const nearest = expired[expired.length - 1];
  return {
    due: [nearest],
    expired: expired.filter((lead) => lead !== nearest),
    catchUp: true,
  };
}

/** Record a reminder as dealt with, sent or not. */
export function markReminded(raid, leads) {
  if (leads.length === 0) return raid;

  const sent = new Set(raid.reminders?.sent ?? []);
  for (const lead of leads) sent.add(lead);

  return {
    ...raid,
    reminders: {
      ...(raid.reminders ?? {}),
      sent: [...sent].sort((a, b) => b - a),
      lastRemindedAt: new Date().toISOString(),
    },
  };
}

/**
 * Who gets pinged: everyone who said they are coming, including the late ones
 * -- being reminded is exactly what a late raider needs. Tentatives are pinged
 * too, but the message asks them to confirm rather than telling them to show up.
 *
 * @returns {{confirmed: string[], tentative: string[]}}
 */
export function audienceFor(raid) {
  const confirmed = [];
  const tentative = [];

  for (const [userId, signup] of Object.entries(raid.signups ?? {})) {
    if (signup.status === 'yes' || signup.status === 'late') confirmed.push(userId);
    else if (signup.status === 'tentative') tentative.push(userId);
  }

  return { confirmed, tentative };
}
