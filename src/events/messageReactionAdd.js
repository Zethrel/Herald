import { Events } from 'discord.js';

import { planReactionAdd } from '../ranks/selfAssign.js';
import { applyRankPlan, resolveReaction } from './reactionRoles.js';

export const name = Events.MessageReactionAdd;

export async function execute(reaction, user, context) {
  const resolved = await resolveReaction(reaction, user, context);
  if (!resolved) return;

  const { config, member, message, emoji } = resolved;
  const plan = planReactionAdd({
    emoji,
    config,
    memberRoleIds: [...member.roles.cache.keys()],
  });

  if (!plan.ok) {
    if (plan.reason === 'unmapped-emoji') {
      // Someone put an emoji on the welcome message that means nothing. Take it
      // back off so the message keeps showing only the choices that work.
      await reaction.users.remove(user.id).catch(() => {});
    }
    return;
  }

  await applyRankPlan({
    plan,
    member,
    message,
    log: context.log,
    auditReason: 'Self-assigned from the welcome message',
  });

  context.log.info(`${member.user.tag} picked ${plan.rankKey} in ${resolved.guild.name}`);
}
