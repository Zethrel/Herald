// Which servers this bot is allowed to run in.
//
// The licence says who may use Herald; this is the half that enforces it at
// runtime. Anyone with the invite link can add a bot to a server they own --
// Discord offers no way to stop that — so the bot has to notice, report, and
// (by default) leave again.
//
// Pure on purpose: `approvedIds` is a plain Set, so the decisions can be tested
// without a gateway.

export const ACTIONS = {
  /** Report it and leave the server immediately. */
  leave: 'leave',
  /** Report it, stay, but refuse to do anything (commands are blocked). */
  report: 'report',
};

/**
 * The effective allowlist: the permanent one from the environment, plus
 * whatever was approved at runtime with `/guilds approve`.
 *
 * @param {object} input
 * @param {string[]} [input.envApproved] ids from APPROVED_GUILDS
 * @param {Record<string, object>} [input.storedApproved] the store's approvedGuilds map
 * @returns {Set<string>}
 */
export function approvedIds({ envApproved = [], storedApproved = {} }) {
  return new Set([...envApproved, ...Object.keys(storedApproved)]);
}

export function isApproved(guildId, approved) {
  // An empty allowlist means nothing has been approved yet, not "approve
  // everything". Failing open here would defeat the point of the list.
  return approved.has(guildId);
}

/**
 * What to do about one server the bot finds itself in.
 *
 * @param {object} input
 * @param {{id: string, name: string, memberCount?: number, ownerId?: string}} input.guild
 * @param {Set<string>} input.approved
 * @param {'leave'|'report'} [input.action] what unapproved servers get
 * @param {boolean} [input.isNew] true when this is a fresh invite rather than a startup sweep
 */
export function planGuildAccess({ guild, approved, action = ACTIONS.leave, isNew = false }) {
  if (isApproved(guild.id, approved)) {
    return { guildId: guild.id, approved: true, report: false, leave: false, isNew };
  }

  return {
    guildId: guild.id,
    approved: false,
    report: true,
    leave: action === ACTIONS.leave,
    isNew,
  };
}

/**
 * The same decision across every server the bot is currently in. Run at
 * startup, which is what catches a server the bot was added to while it was
 * offline -- no guildCreate event is waiting for it when it comes back.
 */
export function auditGuilds({ guilds, approved, action = ACTIONS.leave }) {
  const results = guilds.map((guild) => ({
    guild,
    ...planGuildAccess({ guild, approved, action }),
  }));

  return {
    approved: results.filter((result) => result.approved),
    unapproved: results.filter((result) => !result.approved),
  };
}

/** Server ids on the allowlist that the bot is not actually in. */
export function danglingApprovals({ approved, presentIds }) {
  const present = new Set(presentIds);
  return [...approved].filter((id) => !present.has(id));
}
