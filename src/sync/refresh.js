// Blizzard regenerates its hourly data at 20 minutes past the hour.
//
// That single fact decides three things, so it lives in one place rather than
// as a magic number in each of them:
//
//   * when a cached price set stops being the newest one available,
//   * when a scheduled sync should run (after the refresh, not before it),
//   * what to tell someone reading a price that is 55 minutes old.
//
// The prediction is never trusted over the truth: responses carry a
// Last-Modified header saying when the snapshot was actually generated, and
// that is what gets shown. This only decides when it is worth asking again.

export const REFRESH_MINUTE = 20;

/** A few minutes' grace, because "20 past" is when generation starts. */
export const REFRESH_GRACE_MINUTES = 5;

export function lastRefreshBefore(now = new Date()) {
  const at = new Date(now);
  at.setUTCMinutes(REFRESH_MINUTE, 0, 0);
  if (at > now) at.setUTCHours(at.getUTCHours() - 1);
  return at;
}

export function nextRefreshAfter(now = new Date()) {
  const at = new Date(now);
  at.setUTCMinutes(REFRESH_MINUTE, 0, 0);
  if (at <= now) at.setUTCHours(at.getUTCHours() + 1);
  return at;
}

/**
 * When a snapshot fetched now stops being the newest one available: the next
 * refresh plus grace. Asking again before that is a wasted ten-megabyte
 * download for data that has not changed.
 */
export function cacheExpiryFor(now = new Date()) {
  return new Date(nextRefreshAfter(now).getTime() + REFRESH_GRACE_MINUTES * 60_000);
}

export function minutesUntilNextRefresh(now = new Date()) {
  return Math.max(0, Math.round((nextRefreshAfter(now) - now) / 60_000));
}

/** Cron for a scheduled sync: after the refresh has landed, not on top of it. */
export const RECOMMENDED_CRON = `${REFRESH_MINUTE + REFRESH_GRACE_MINUTES} * * * *`;

/**
 * How to describe the age of a snapshot to someone about to spend gold on it.
 *
 * @param {Date|string|null} generatedAt from the response's Last-Modified
 */
export function describeAge(generatedAt, now = new Date()) {
  if (!generatedAt) {
    return { minutes: null, text: 'age unknown', stale: true };
  }

  const at = generatedAt instanceof Date ? generatedAt : new Date(generatedAt);
  if (Number.isNaN(at.getTime())) {
    return { minutes: null, text: 'age unknown', stale: true };
  }

  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  // A snapshot older than two refreshes means one was missed, not that prices
  // are quiet.
  const stale = minutes > 125;

  if (minutes < 1) return { minutes, text: 'just now', stale };
  if (minutes < 60) return { minutes, text: `${minutes} min ago`, stale };

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return {
    minutes,
    text: rest === 0 ? `${hours}h ago` : `${hours}h ${rest}m ago`,
    stale,
  };
}
