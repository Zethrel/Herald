// Reading and writing raids, with the one guarantee the buttons need: a
// read-modify-write cannot lose an update.
//
// Twenty people press "Signed up" the moment the post goes live. The store
// serialises the writes themselves, but two handlers that both read the raid
// map, add their own signup and write it back would leave one of them missing.
// So every mutation runs inside a per-guild lock.

/** @type {Map<string, Promise<unknown>>} */
const locks = new Map();

export function withGuildLock(guildId, work) {
  const previous = locks.get(guildId) ?? Promise.resolve();
  const next = previous.then(work, work);
  // Swallow the rejection on the chain only -- the caller still sees it.
  locks.set(
    guildId,
    next.catch(() => {}),
  );
  return next;
}

export async function getRaid(store, guildId, raidId) {
  const config = await store.get(guildId);
  return config.raids?.[raidId] ?? null;
}

export async function listRaids(store, guildId, { includeClosed = true } = {}) {
  const config = await store.get(guildId);
  return Object.values(config.raids ?? {})
    .filter((raid) => includeClosed || (!raid.closed && !raid.cancelled))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** Raids that have not happened yet, soonest first. */
export async function upcomingRaids(store, guildId, now = Date.now()) {
  const raids = await listRaids(store, guildId);
  return raids.filter((raid) => !raid.cancelled && Date.parse(raid.startsAt) > now);
}

export async function saveRaid(store, guildId, raid) {
  return withGuildLock(guildId, async () => {
    const config = await store.get(guildId);
    await store.update(guildId, { raids: { ...(config.raids ?? {}), [raid.id]: raid } });
    return raid;
  });
}

/**
 * Read, change, write -- atomically for this guild.
 *
 * @param {(raid: object) => object|{raid: object, error: string|null}} mutate
 * @returns {Promise<{raid: object|null, error: string|null}>}
 */
export async function updateRaid(store, guildId, raidId, mutate) {
  return withGuildLock(guildId, async () => {
    const config = await store.get(guildId);
    const raid = config.raids?.[raidId];
    if (!raid) return { raid: null, error: 'That raid no longer exists.' };

    const outcome = mutate(raid);
    const next = outcome?.raid ?? outcome;
    const error = outcome?.error ?? null;

    if (error) return { raid, error };

    await store.update(guildId, { raids: { ...(config.raids ?? {}), [raidId]: next } });
    return { raid: next, error: null };
  });
}

export async function deleteRaid(store, guildId, raidId) {
  return withGuildLock(guildId, async () => {
    const config = await store.get(guildId);
    const raids = { ...(config.raids ?? {}) };
    delete raids[raidId];
    await store.update(guildId, { raids });
  });
}

/** The spec someone last signed up as, so the next raid is a single click. */
export async function getMain(store, guildId, userId) {
  const config = await store.get(guildId);
  return config.mains?.[userId] ?? null;
}

export async function setMain(store, guildId, userId, specKey) {
  return withGuildLock(guildId, async () => {
    const config = await store.get(guildId);
    await store.update(guildId, { mains: { ...(config.mains ?? {}), [userId]: specKey } });
  });
}
