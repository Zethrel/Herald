import { Events } from 'discord.js';

import { BOT_NAME } from '../branding.js';
import { currentApproved, enforceGuildAccess } from '../access/guard.js';
import { danglingApprovals } from '../access/approval.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client, context) {
  const { store, log, env, reminders } = context;
  log.info(`${BOT_NAME} is online as ${client.user.tag}, in ${client.guilds.cache.size} server(s)`);

  // The startup sweep. guildCreate covers invites that happen while the bot is
  // running; this is what catches a server it was added to while it was down,
  // because no join event is waiting for it when it comes back.
  for (const guild of [...client.guilds.cache.values()]) {
    await enforceGuildAccess({ guild, isNew: false, ...context });
  }

  const approved = await currentApproved({ store, env });
  const dangling = danglingApprovals({ approved, presentIds: [...client.guilds.cache.keys()] });
  if (dangling.length > 0) {
    log.info(`Approved but not joined: ${dangling.join(', ')}`);
  }

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

  // Last, so its first tick runs against an approved, cached client. Anything
  // that came due while the bot was down is either sent now or closed out.
  reminders?.start();
}
