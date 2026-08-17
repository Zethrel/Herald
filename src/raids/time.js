// Turning "2026-08-20 20:00" plus a timezone into an instant.
//
// No dependency: Intl already knows every zone and every DST rule, it just
// will not do this conversion directly. The trick below asks it what a given
// UTC instant looks like in the target zone, and uses the difference as the
// offset. Run twice, because the offset at the guessed instant can differ from
// the offset at the real one -- which is exactly what happens on the two days a
// year a raid is scheduled across a DST change.
//
// Discord renders <t:epoch:F> in each viewer's own timezone, so this only has
// to be right once, at creation.

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;

export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** What `utcMillis` reads as on the wall clock in `timeZone`, as UTC millis. */
function wallClockAsUtc(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(new Date(utcMillis))
    .reduce((all, part) => ({ ...all, [part.type]: part.value }), {});

  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl writes midnight as 24 in some locales.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
}

export function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute);

  let utc = naive - (wallClockAsUtc(naive, timeZone) - naive);
  // Second pass: settles the DST-boundary case, where the first offset came
  // from the wrong side of the change.
  utc = naive - (wallClockAsUtc(utc, timeZone) - utc);

  return new Date(utc);
}

/**
 * @param {string} text "2026-08-20 20:00", or a unix timestamp in seconds
 * @param {string} timeZone IANA name, e.g. "Europe/Oslo"
 * @returns {{date: Date}|{error: string}}
 */
export function parseWhen(text, timeZone) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { error: 'No date given.' };

  if (!isValidTimeZone(timeZone)) {
    return { error: `"${timeZone}" is not a timezone I know. Use an IANA name like Europe/Oslo.` };
  }

  // A raw epoch, which is what someone pasting from a timestamp generator has.
  if (/^\d{9,11}$/.test(trimmed)) {
    return { date: new Date(Number(trimmed) * 1000) };
  }

  const match = trimmed.match(PATTERN);
  if (!match) {
    return { error: 'Write the time as `YYYY-MM-DD HH:MM`, e.g. `2026-08-20 20:00`.' };
  }

  const [, year, month, day, hour, minute] = match.map(Number);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { error: 'That date does not exist.' };
  }

  const date = zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);

  // Catches 31 February, which Date.UTC rolls forward rather than rejecting.
  const readBack = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit' }).format(date);
  if (Number(readBack) !== day) {
    return { error: 'That date does not exist.' };
  }

  return { date };
}

/** Discord renders these in the reader's own timezone, which is the point. */
export function discordTime(date, style = 'F') {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}
