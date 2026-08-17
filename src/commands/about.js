import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';

import { BOT_NAME, BRAND_COLOR, FOOTER } from '../branding.js';

export const data = new SlashCommandBuilder()
  .setName('about')
  .setDescription(`What ${BOT_NAME} does`);

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(BOT_NAME)
    .setDescription(
      [
        `${BOT_NAME} sets up a raiding guild's Discord and keeps its ranks straight.`,
        '',
        '• `/setup run` — builds the ranks, categories and channels, then posts the welcome message.',
        '• New members get the default rank the moment they join.',
        '• The welcome message hands out **Raider** and **Social** by reaction.',
        '• Members who already have a rank are never touched.',
      ].join('\n'),
    )
    .setFooter({ text: FOOTER });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
