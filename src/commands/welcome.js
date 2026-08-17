import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { publishWelcome } from '../welcome.js';

export const data = new SlashCommandBuilder()
  .setName('welcome')
  .setDescription('Manage the welcome message members pick their rank on')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('post')
      .setDescription('Post the welcome message, or move it to another channel')
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Where to post it (default: the welcome channel from setup)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('refresh')
      .setDescription('Rebuild the existing message after changing ranks or emoji'),
  );

export async function execute(interaction, { store, client }) {
  const config = await store.get(interaction.guildId);
  const sub = interaction.options.getSubcommand();

  const requested = interaction.options.getChannel('channel');
  const channelId = requested?.id ?? config.welcome.channelId ?? config.channels.welcome;
  const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;

  if (!channel) {
    return interaction.reply({
      content:
        'No welcome channel yet. Pass one with `/welcome post channel:#welcome`, or run `/setup run` to create the whole set.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Moving the message to a different channel means the old one is no longer
  // the welcome message; drop the stale id so `publishWelcome` posts fresh
  // rather than trying to edit a message that lives somewhere else.
  const movingChannel = sub === 'post' && requested && requested.id !== config.welcome.channelId;
  const effective = movingChannel
    ? { ...config, welcome: { channelId: requested.id, messageId: null } }
    : config;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const message = await publishWelcome({ channel, config: effective, guild: interaction.guild, client });
  await store.update(interaction.guildId, {
    welcome: { channelId: channel.id, messageId: message.id },
  });

  return interaction.editReply({
    content: `Welcome message is live in <#${channel.id}>. ${message.url}`,
  });
}
