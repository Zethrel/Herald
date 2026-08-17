import { Events } from 'discord.js';

import { alert, buildInfoEmbed } from '../access/report.js';
import { currentApproved } from '../access/guard.js';

export const name = Events.GuildDelete;

export async function execute(guild, { client, store, env, log }) {
  // Fired for an outage too, not only for a removal. `available: false` means
  // Discord lost the server, not that the bot was kicked out of it.
  if (!guild.available) {
    log.warn(`${guild.name ?? guild.id} is unavailable (Discord outage)`);
    return;
  }

  log.info(`Removed from ${guild.name ?? 'a server'} (${guild.id})`);

  const approved = await currentApproved({ store, env });
  if (!approved.has(guild.id)) return; // Almost certainly the bot leaving one itself.

  await alert({
    client,
    embed: buildInfoEmbed({
      title: 'Removed from an approved server',
      description: [
        `**Server:** ${guild.name ?? 'unknown'}`,
        `**ID:** \`${guild.id}\``,
        '',
        `It is still on the allowlist. Drop it with \`/guilds revoke ${guild.id}\` if that was deliberate.`,
      ].join('\n'),
    }),
    owners: env.ownerIds,
    webhookUrl: env.alertWebhookUrl,
    log,
  });
}
