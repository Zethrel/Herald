import { Events } from 'discord.js';

import { planReactionRemove } from '../ranks/selfAssign.js';
import { applyRankPlan, resolveReaction } from './reactionRoles.js';

export const name = Events.MessageReactionRemove;

export async function execute(reaction, user, context) {
  const resolved = await resolveReaction(reaction, user, context);
  if (!resolved) return;

  const { config, member, message, emoji } = resolved;
  const plan = planReactionRemove({
    emoji,
    config,
    memberRoleIds: [...member.roles.cache.keys()],
  });

  if (!plan.ok) return;

  await applyRankPlan({
    plan,
    member,
    message,
    log: context.log,
    auditReason: 'Rank handed back from the welcome message',
  });

  context.log.info(`${member.user.tag} dropped ${plan.rankKey} in ${resolved.guild.name}`);
}
