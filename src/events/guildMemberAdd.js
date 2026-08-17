import { Events } from 'discord.js';

import { planJoin } from '../ranks/membership.js';

export const name = Events.GuildMemberAdd;

export async function execute(member, { store, log }) {
  const config = await store.get(member.guild.id);

  const { assign, reason } = planJoin({
    isBot: member.user.bot,
    memberRoleIds: [...member.roles.cache.keys()],
    config,
  });

  if (!assign) {
    log.debug(`${member.user.tag} joined ${member.guild.name}: no default rank applied (${reason})`);
    return;
  }

  try {
    await member.roles.add(assign, 'Default rank on join');
    log.info(`Gave the default rank to ${member.user.tag} in ${member.guild.name}`);
  } catch (error) {
    log.warn(`Could not give ${member.user.tag} the default rank in ${member.guild.name}: ${error.message}`);
  }
}
