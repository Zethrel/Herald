import { Events } from 'discord.js';

import { BOT_NAME } from '../branding.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client, { store, log }) {
  log.info(`${BOT_NAME} is online as ${client.user.tag}, in ${client.guilds.cache.size} server(s)`);

  // Reaction roles work off a message that may be months old. Discord only
  // delivers reaction events for messages the client has cached, so each
  // welcome message gets fetched once at startup to put it back in the cache.
  for (const [guildId, guild] of client.guilds.cache) {
    const config = await store.get(guildId);
    const { channelId, messageId } = config.welcome;
    if (!channelId || !messageId) continue;

    try {
      const channel = await client.channels.fetch(channelId);
      await channel.messages.fetch(messageId);
      log.debug(`Watching the welcome message in ${guild.name}`);
    } catch (error) {
      log.warn(`Welcome message for ${guild.name} could not be fetched: ${error.message}`);
    }
  }
}
