// Shared plumbing for the two reaction events. The decisions live in
// `src/ranks/selfAssign.js`; this file only resolves partials, applies the
// result, and stays quiet about anything that is not the welcome message.

import { normalizeEmoji } from '../ranks/selfAssign.js';

/**
 * Resolve the event into everything a handler needs, or null when the event is
 * not about the welcome message.
 */
export async function resolveReaction(reaction, user, { store, log }) {
  // The user arrives partial too, so `user.bot` can be undefined. The id check
  // is what reliably keeps the bot from reacting to its own reactions.
  if (user.id === reaction.client.user.id || user.bot) return null;

  try {
    // Reactions on messages from before the bot started up arrive partial, and
    // the message has to be resolved as well -- `clearReactions` reads its
    // reaction cache, which a partial message does not have.
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
  } catch (error) {
    log.warn(`Could not fetch a reaction: ${error.message}`);
    return null;
  }

  const message = reaction.message;
  if (!message.guildId) return null;

  const config = await store.get(message.guildId);
  if (!config.welcome.messageId || config.welcome.messageId !== message.id) return null;

  const guild = message.guild ?? (await reaction.client.guilds.fetch(message.guildId));
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return null;

  return { config, guild, member, message, emoji: reaction.emoji.name };
}

/** Apply a plan from `planReactionAdd` / `planReactionRemove`. */
export async function applyRankPlan({ plan, member, message, log, auditReason }) {
  for (const roleId of plan.add) {
    await member.roles.add(roleId, auditReason).catch((error) => {
      log.warn(`Could not add ${roleId} to ${member.user.tag}: ${error.message}`);
    });
  }

  for (const roleId of plan.remove) {
    await member.roles.remove(roleId, auditReason).catch((error) => {
      log.warn(`Could not remove ${roleId} from ${member.user.tag}: ${error.message}`);
    });
  }

  // Roles first, reactions second, and deliberately so: pulling a stale
  // reaction fires messageReactionRemove for that emoji, and by then the member
  // no longer holds the role, so the remove handler is a no-op instead of
  // undoing what we just did.
  for (const emoji of plan.clearReactions ?? []) {
    const reaction = message.reactions.cache.find(
      (candidate) => normalizeEmoji(candidate.emoji.name) === normalizeEmoji(emoji),
    );
    if (!reaction) continue;
    await reaction.users.remove(member.id).catch(() => {});
  }
}
