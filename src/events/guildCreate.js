import { ChannelType, EmbedBuilder, Events, PermissionFlagsBits } from 'discord.js';

import { BOT_NAME, BRAND_COLOR, FOOTER } from '../branding.js';
import { enforceGuildAccess } from '../access/guard.js';

export const name = Events.GuildCreate;

export async function execute(guild, context) {
  const { log } = context;
  log.info(`Added to ${guild.name} (${guild.id})`);

  // Anyone holding the invite link can add the bot to a server they own, so
  // this is the first thing that happens on arrival — before it introduces
  // itself, and before it does any work.
  const access = await enforceGuildAccess({ guild, isNew: true, ...context });
  if (!access.approved) return;

  const channel = firstWritableChannel(guild);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${BOT_NAME} is here`)
    .setDescription(
      [
        'Run `/setup run` to build the ranks, channels and welcome message.',
        'Try `/setup run dry_run:true` first if you want to see the list before anything is created.',
        '',
        'Nobody who is already on this server loses or changes a rank — setup only adds what is missing.',
      ].join('\n'),
    )
    .setFooter({ text: FOOTER });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

function firstWritableChannel(guild) {
  const canPost = (channel) =>
    channel?.type === ChannelType.GuildText &&
    channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages);

  if (canPost(guild.systemChannel)) return guild.systemChannel;
  return guild.channels.cache.find(canPost) ?? null;
}
