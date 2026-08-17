// Who gets the default rank.
//
// The rule the guild asked for, and the reason this is its own module: a member
// who already holds a rank is never touched. New arrivals get the default rank;
// the roster you already have keeps exactly what it has, whether the bot is
// reacting to a join or sweeping the whole member list.

/** Every role id the bot considers a guild rank, in blueprint order. */
export function rankRoleIds(config) {
  return Object.values(config.roles ?? {}).filter(Boolean);
}

export function holdsARank(memberRoleIds, config) {
  const ranks = new Set(rankRoleIds(config));
  return memberRoleIds.some((roleId) => ranks.has(roleId));
}

/**
 * @param {object} input
 * @param {boolean} input.isBot
 * @param {string[]} input.memberRoleIds
 * @param {object} input.config
 * @returns {{assign: string|null, reason: string}}
 */
export function planJoin({ isBot, memberRoleIds, config }) {
  if (isBot) return { assign: null, reason: 'bot' };

  const defaultRoleId = config.roles?.[config.defaultRankKey];
  if (!defaultRoleId) return { assign: null, reason: 'no-default-rank' };

  // Rejoins and Discord's role-restore can bring a member back already ranked.
  if (holdsARank(memberRoleIds, config)) return { assign: null, reason: 'already-ranked' };

  return { assign: defaultRoleId, reason: 'new-member' };
}

/**
 * The same rule applied to the existing roster, for a server that adds the bot
 * years in. Only members with no rank at all come out of this; everyone else is
 * left alone.
 *
 * @param {Array<{id: string, isBot: boolean, roleIds: string[]}>} members
 * @param {object} config
 */
export function planBackfill(members, config) {
  const defaultRoleId = config.roles?.[config.defaultRankKey];
  if (!defaultRoleId) {
    return { defaultRoleId: null, assign: [], skipped: { bots: 0, alreadyRanked: 0 } };
  }

  const assign = [];
  const skipped = { bots: 0, alreadyRanked: 0 };

  for (const member of members) {
    if (member.isBot) {
      skipped.bots += 1;
      continue;
    }
    if (holdsARank(member.roleIds, config)) {
      skipped.alreadyRanked += 1;
      continue;
    }
    assign.push(member.id);
  }

  return { defaultRoleId, assign, skipped };
}
