// The landing page: the first thing a new member sees, and the only thing they
// can see until they pick a rank on it.

import { EmbedBuilder } from 'discord.js';

import { BOT_NAME, BRAND_COLOR, FOOTER } from './branding.js';
import { rankByKey } from './blueprint.js';

/** The emoji to put on the welcome message, in the order they should appear. */
export function welcomeReactions(config) {
  return Object.entries(config.selfAssign ?? {})
    .filter(([, rankKey]) => Boolean(config.roles?.[rankKey]))
    .map(([emoji]) => emoji);
}

/**
 * @param {object} input
 * @param {string} input.guildName
 * @param {object} input.config the guild's stored config
 * @returns {import('discord.js').EmbedBuilder}
 */
export function buildWelcomeEmbed({ guildName, config }) {
  const choices = Object.entries(config.selfAssign ?? {})
    .filter(([, rankKey]) => Boolean(config.roles?.[rankKey]))
    .map(([emoji, rankKey]) => {
      const rank = rankByKey(rankKey);
      return {
        name: `${emoji}  ${rank?.selfAssign?.label ?? rank?.name ?? rankKey}`,
        value: rank?.selfAssign?.description ?? `Take the ${rank?.name ?? rankKey} rank.`,
        inline: false,
      };
    });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`Welcome to ${guildName}`)
    .setDescription(
      [
        'Pick a rank below and the rest of the server opens up.',
        '',
        'React with the matching emoji to take a rank. Remove your reaction to give it back.',
      ].join('\n'),
    )
    .setFooter({ text: FOOTER });

  if (choices.length > 0) {
    embed.addFields(choices);
  } else {
    embed.addFields({
      name: 'Not set up yet',
      value: `No self-assignable ranks are configured. An officer can run \`/setup run\` to finish setting ${BOT_NAME} up.`,
    });
  }

  if (config.exclusiveRanks && choices.length > 1) {
    embed.addFields({
      name: '​',
      value: '_Ranks are exclusive — picking one hands the other back._',
    });
  }

  return embed;
}

/**
 * Post the welcome message, or edit the one already there, and make sure it
 * carries exactly the reactions it should.
 *
 * @returns {Promise<import('discord.js').Message>}
 */
export async function publishWelcome({ channel, config, guild, client }) {
  const embed = buildWelcomeEmbed({ guildName: guild.name, config });

  let message = null;
  if (config.welcome?.messageId && config.welcome?.channelId === channel.id) {
    // Editing keeps the reactions -- and everyone who already reacted -- intact.
    message = await channel.messages.fetch(config.welcome.messageId).catch(() => null);
  }

  if (message && message.author.id === client.user.id) {
    await message.edit({ embeds: [embed] });
  } else {
    message = await channel.send({ embeds: [embed] });
  }

  await syncReactions(message, welcomeReactions(config), client.user.id);
  return message;
}

/** Add any missing reactions; leave the ones already there alone. */
export async function syncReactions(message, emojis, botUserId) {
  const present = new Set(
    message.reactions.cache.filter((reaction) => reaction.me || reaction.users.cache.has(botUserId)).map(
      (reaction) => reaction.emoji.name,
    ),
  );

  for (const emoji of emojis) {
    if (present.has(emoji)) continue;
    await message.react(emoji);
  }
}
