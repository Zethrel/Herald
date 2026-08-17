// A raid and its signups, as pure state.
//
// Every change returns a new raid rather than mutating one, so the command and
// button handlers can read-modify-write against the store without two clicks in
// the same second losing one of themselves.

import { ROLES, specByKey } from '../game/specs.js';

export const STATUSES = {
  yes: { label: 'Signed up', emoji: '✅', inRoster: true, order: 0 },
  late: { label: 'Late', emoji: '🕗', inRoster: true, order: 1 },
  tentative: { label: 'Tentative', emoji: '❓', inRoster: false, order: 2 },
  bench: { label: 'Bench', emoji: '🪑', inRoster: false, order: 3 },
  no: { label: 'Absent', emoji: '❌', inRoster: false, order: 4 },
};

export const STATUS_KEYS = Object.keys(STATUSES);

/** Statuses that mean "bring consumables": late still needs a flask. */
export const ROSTER_STATUSES = STATUS_KEYS.filter((key) => STATUSES[key].inRoster);

export function nextRaidId(existing = {}) {
  const numbers = Object.keys(existing)
    .map((id) => Number.parseInt(id.replace(/^raid-/, ''), 10))
    .filter((value) => Number.isInteger(value));
  return `raid-${Math.max(0, ...numbers) + 1}`;
}

export function createRaid({ id, title, startsAt, description = null, createdBy, timeZone }) {
  return {
    id,
    title,
    // ISO, so the store round-trips it as a string.
    startsAt: startsAt instanceof Date ? startsAt.toISOString() : startsAt,
    timeZone,
    description,
    createdBy,
    createdAt: new Date().toISOString(),
    channelId: null,
    messageId: null,
    closed: false,
    cancelled: false,
    /** userId -> { status, specKey, at } */
    signups: {},
  };
}

/**
 * Record one person's answer.
 *
 * A signup with no spec is still a signup -- someone clicking "Absent" should
 * not be made to pick a class first -- but the roster and the shopping list can
 * only count the ones that have one.
 */
export function applySignup(raid, { userId, status, specKey = undefined }) {
  if (!STATUSES[status]) return { raid, error: `Unknown status: ${status}` };
  if (raid.closed) return { raid, error: 'Signups for that raid are closed.' };
  if (raid.cancelled) return { raid, error: 'That raid was cancelled.' };

  const existing = raid.signups[userId] ?? {};

  return {
    raid: {
      ...raid,
      signups: {
        ...raid.signups,
        [userId]: {
          status,
          // `undefined` keeps whatever spec they signed up with last time;
          // passing null clears it deliberately.
          specKey: specKey === undefined ? existing.specKey ?? null : specKey,
          at: new Date().toISOString(),
        },
      },
    },
    error: null,
  };
}

export function withdraw(raid, userId) {
  if (!raid.signups[userId]) return { raid, changed: false };
  const signups = { ...raid.signups };
  delete signups[userId];
  return { raid: { ...raid, signups }, changed: true };
}

export function setSpec(raid, userId, specKey) {
  const existing = raid.signups[userId];
  if (!existing) return raid;
  return {
    ...raid,
    signups: { ...raid.signups, [userId]: { ...existing, specKey } },
  };
}

const ROLE_ORDER = [ROLES.tank, ROLES.healer, ROLES.melee, ROLES.ranged];

/**
 * Group the signups the way a raid leader reads them: roster by role first,
 * then everyone else by status.
 *
 * @param {object} raid
 * @param {(key: string) => object|null} [lookup] injectable for tests
 */
export function buildRoster(raid, lookup = specByKey) {
  const roster = { tank: [], healer: [], melee: [], ranged: [], unknown: [] };
  const other = { late: [], tentative: [], bench: [], no: [] };

  for (const [userId, signup] of Object.entries(raid.signups ?? {})) {
    const spec = signup.specKey ? lookup(signup.specKey) : null;
    const entry = { userId, spec, specKey: signup.specKey ?? null, at: signup.at, status: signup.status };

    if (signup.status === 'yes') {
      if (spec) roster[spec.role].push(entry);
      else roster.unknown.push(entry);
      continue;
    }

    // Late players are in the roster for consumables but listed separately, so
    // nobody plans the first pull around them.
    if (other[signup.status]) other[signup.status].push(entry);
  }

  // Signup order within a group: first come, first listed.
  for (const group of [...Object.values(roster), ...Object.values(other)]) {
    group.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
  }

  const counts = {
    tank: roster.tank.length,
    healer: roster.healer.length,
    melee: roster.melee.length,
    ranged: roster.ranged.length,
    unknown: roster.unknown.length,
    late: other.late.length,
    tentative: other.tentative.length,
    bench: other.bench.length,
    no: other.no.length,
  };
  counts.confirmed = counts.tank + counts.healer + counts.melee + counts.ranged + counts.unknown;
  counts.total = counts.confirmed + counts.late;

  return { roster, other, counts, roleOrder: ROLE_ORDER };
}

/**
 * The roster in the shape `buildShoppingList` wants: one entry per spec with a
 * head count. Only signups that will actually be in the raid and that named a
 * spec -- an unknown spec cannot be given a flask.
 */
export function rosterForShopping(raid, lookup = specByKey) {
  const counts = new Map();
  const unknown = [];

  for (const [userId, signup] of Object.entries(raid.signups ?? {})) {
    if (!ROSTER_STATUSES.includes(signup.status)) continue;

    const spec = signup.specKey ? lookup(signup.specKey) : null;
    if (!spec) {
      unknown.push(userId);
      continue;
    }

    counts.set(spec.key, { spec, count: (counts.get(spec.key)?.count ?? 0) + 1 });
  }

  return { roster: [...counts.values()], unknown };
}
