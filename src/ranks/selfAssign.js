// What clicking (or un-clicking) a reaction on the welcome message should do to
// a member's roles. Pure functions over a role-id list, so every branch --
// exclusivity, the default rank coming off and going back on, unmapped emoji --
// is testable without a live server.

// Discord echoes reactions back with whatever the client sent, and ⚔️ travels
// either bare or with a U+FE0F variation selector. Comparing raw strings makes
// the bot ignore half the clicks it receives, so both sides get normalized.
export function normalizeEmoji(emoji) {
  return (emoji ?? '').replace(/️/g, '').trim();
}

function emojiToRank(config) {
  return new Map(
    Object.entries(config.selfAssign ?? {}).map(([emoji, rankKey]) => [normalizeEmoji(emoji), rankKey]),
  );
}

// Role ids for every rank that can be self-assigned, whichever emoji maps to it.
function selfAssignableRoleIds(config) {
  const ids = new Map(); // roleId -> emoji
  for (const [emoji, rankKey] of Object.entries(config.selfAssign ?? {})) {
    const roleId = config.roles?.[rankKey];
    if (roleId) ids.set(roleId, emoji);
  }
  return ids;
}

const NOTHING = { ok: false, add: [], remove: [], clearReactions: [] };

/**
 * @param {object} input
 * @param {string} input.emoji the emoji reacted with
 * @param {object} input.config the guild's stored config
 * @param {string[]} input.memberRoleIds role ids the member holds right now
 */
export function planReactionAdd({ emoji, config, memberRoleIds }) {
  const rankKey = emojiToRank(config).get(normalizeEmoji(emoji));
  if (!rankKey) return { ...NOTHING, reason: 'unmapped-emoji' };

  const roleId = config.roles?.[rankKey];
  if (!roleId) return { ...NOTHING, reason: 'rank-not-configured' };

  const held = new Set(memberRoleIds);
  const add = held.has(roleId) ? [] : [roleId];
  const remove = [];
  const clearReactions = [];

  if (config.exclusiveRanks) {
    // Raider and Social are alternatives. Take the other one back, and pull the
    // member's stale reaction off the message so it keeps telling the truth
    // about who holds what.
    for (const [otherRoleId, otherEmoji] of selfAssignableRoleIds(config)) {
      if (otherRoleId === roleId) continue;
      if (held.has(otherRoleId)) remove.push(otherRoleId);
      clearReactions.push(otherEmoji);
    }
  }

  const defaultRoleId = config.roles?.[config.defaultRankKey];
  if (config.removeDefaultOnPick && defaultRoleId && held.has(defaultRoleId)) {
    remove.push(defaultRoleId);
  }

  return { ok: true, rankKey, add, remove, clearReactions, reason: 'picked' };
}

/**
 * Un-reacting gives the rank back. A member who ends up with no rank at all
 * falls back to the default one, so nobody is left able to see nothing.
 */
export function planReactionRemove({ emoji, config, memberRoleIds }) {
  const rankKey = emojiToRank(config).get(normalizeEmoji(emoji));
  if (!rankKey) return { ...NOTHING, reason: 'unmapped-emoji' };

  const roleId = config.roles?.[rankKey];
  if (!roleId) return { ...NOTHING, reason: 'rank-not-configured' };

  const held = new Set(memberRoleIds);
  if (!held.has(roleId)) return { ...NOTHING, reason: 'already-absent' };

  held.delete(roleId);

  const add = [];
  const stillRanked = [...selfAssignableRoleIds(config).keys()].some((id) => held.has(id));
  const defaultRoleId = config.roles?.[config.defaultRankKey];
  if (!stillRanked && defaultRoleId && !held.has(defaultRoleId)) {
    add.push(defaultRoleId);
  }

  return { ok: true, rankKey, add, remove: [roleId], clearReactions: [], reason: 'dropped' };
}
