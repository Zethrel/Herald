// Per-guild settings, persisted as one JSON file.
//
// A raiding guild's Discord is a handful of servers at most, and the data is a
// few dozen snowflake IDs per server, so a JSON file is the honest size of the
// problem. The interface is narrow enough (`get` / `update`) that swapping in
// SQLite later would not reach outside this module.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { DEFAULT_RANK_KEY, RANK_KEYS, SELF_ASSIGN_RANKS, allChannels, CATEGORIES } from './blueprint.js';

export const STORE_VERSION = 1;

// Installation-wide settings. `approvedGuilds` is the allowlist: server id ->
// { name, approvedBy, approvedAt, note }. Servers approved through the
// APPROVED_GUILDS environment variable are not written here -- env is the
// permanent list, this is the one that changes at runtime.
export function defaultAppConfig() {
  return { approvedGuilds: {} };
}

// A fresh server's settings: every slot the blueprint knows about, all unbound.
// `/setup` fills them in, and `/config set` can rebind any of them by hand for a
// server that already had its own roles before the bot arrived.
export function defaultGuildConfig() {
  return {
    roles: Object.fromEntries(RANK_KEYS.map((key) => [key, null])),
    categories: Object.fromEntries(CATEGORIES.map((category) => [category.key, null])),
    channels: Object.fromEntries(allChannels().map((channel) => [channel.key, null])),
    defaultRankKey: DEFAULT_RANK_KEY,
    // emoji -> rank key. Stored rather than read from the blueprint so a guild
    // can re-map a reaction without a redeploy.
    selfAssign: Object.fromEntries(SELF_ASSIGN_RANKS.map((rank) => [rank.selfAssign.emoji, rank.key])),
    // Picking Raider drops Social and vice versa: they are alternatives, not a
    // menu. Set false to let members hold both.
    exclusiveRanks: true,
    // The default rank is a holding pen, so it comes off once a rank is chosen.
    removeDefaultOnPick: true,
    welcome: { channelId: null, messageId: null },
    setupAt: null,
    // This server's departures from the tier file: spec key -> { flask, food,
    // potion, source, updatedAt, setBy }.
    consumables: { overrides: {} },
    // raid id -> raid, and user id -> the spec they last signed up as.
    raids: {},
    mains: {},
    // Used to read the times typed into /raid create. IANA name.
    timeZone: 'UTC',
  };
}

// Shallow-merge a patch into a config, one level deep for the nested objects so
// `{roles: {social: id}}` binds one rank instead of replacing the whole map.
export function mergeConfig(existing, patch) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    merged[key] = isPlainObject ? { ...(existing[key] ?? {}), ...value } : value;
  }
  return merged;
}

export function createStore(filePath) {
  /** @type {Map<string, object>} */
  let guilds = new Map();
  // Settings that belong to the installation rather than to any one server --
  // which servers are approved to run it at all.
  let app = defaultAppConfig();
  let loaded = false;
  // Serialises writes: two commands finishing at once must not interleave a
  // read-modify-write and lose one of the two updates.
  let writeChain = Promise.resolve();

  async function load() {
    if (loaded) return;
    try {
      const raw = JSON.parse(await readFile(filePath, 'utf8'));
      for (const [guildId, config] of Object.entries(raw.guilds ?? {})) {
        guilds.set(guildId, mergeConfig(defaultGuildConfig(), config));
      }
      app = mergeConfig(defaultAppConfig(), raw.app ?? {});
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // No file yet: first run.
    }
    loaded = true;
  }

  async function flush() {
    const payload = {
      version: STORE_VERSION,
      app,
      guilds: Object.fromEntries(guilds),
    };
    await mkdir(dirname(filePath), { recursive: true });
    const temp = `${filePath}.tmp`;
    // Write-then-rename, so a crash mid-write leaves the previous file intact
    // rather than a truncated one the bot would refuse to start on.
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(temp, filePath);
  }

  return {
    async get(guildId) {
      await load();
      return guilds.get(guildId) ?? defaultGuildConfig();
    },

    async update(guildId, patch) {
      await load();
      const next = mergeConfig(guilds.get(guildId) ?? defaultGuildConfig(), patch);
      guilds.set(guildId, next);
      writeChain = writeChain.then(flush, flush);
      await writeChain;
      return next;
    },

    async forget(guildId) {
      await load();
      guilds.delete(guildId);
      writeChain = writeChain.then(flush, flush);
      await writeChain;
    },

    async all() {
      await load();
      return new Map(guilds);
    },

    async getApp() {
      await load();
      return app;
    },

    async updateApp(patch) {
      await load();
      app = mergeConfig(app, patch);
      writeChain = writeChain.then(flush, flush);
      await writeChain;
      return app;
    },

    /**
     * Replaces the allowlist wholesale. `updateApp` merges one level deep,
     * which cannot express a removal -- a patch missing a key leaves that key
     * exactly where it was.
     */
    async setApprovedGuilds(approvedGuilds) {
      await load();
      app = { ...app, approvedGuilds };
      writeChain = writeChain.then(flush, flush);
      await writeChain;
      return app;
    },
  };
}
