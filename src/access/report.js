// Telling you about it. An unapproved invite is worth knowing about even when
// the bot handled it itself, so every alert goes out by DM to the owners and,
// if one is configured, to a webhook as well.

import { AuditLogEvent, EmbedBuilder, WebhookClient } from 'discord.js';

import { BOT_NAME, FOOTER } from '../branding.js';

const ALERT_COLOR = 0xc0392b;
const INFO_COLOR = 0xc8a44a;

/**
 * Who added the bot, from the server's audit log. Best effort: it needs View
 * Audit Log, which an unapproved server has no reason to have granted.
 *
 * @returns {Promise<import('discord.js').User|null>}
 */
export async function findInviter(guild, clientUserId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs.entries.find((candidate) => candidate.target?.id === clientUserId);
    return entry?.executor ?? null;
  } catch {
    return null;
  }
}

export function buildUnapprovedEmbed({ guild, inviter, left, isNew }) {
  const lines = [
    `**Server:** ${guild.name}`,
    `**ID:** \`${guild.id}\``,
    `**Members:** ${guild.memberCount ?? 'unknown'}`,
    `**Server owner:** ${guild.ownerId ? `<@${guild.ownerId}> (\`${guild.ownerId}\`)` : 'unknown'}`,
    `**Added by:** ${inviter ? `${inviter.tag} (\`${inviter.id}\`)` : 'unknown — no audit log access'}`,
  ];

  return new EmbedBuilder()
    .setColor(ALERT_COLOR)
    .setTitle(isNew ? '⚠️ Added to an unapproved server' : '⚠️ Found in an unapproved server')
    .setDescription(lines.join('\n'))
    .addFields({
      name: 'What happened',
      value: left
        ? `${BOT_NAME} left the server immediately. Approve it with \`/guilds approve ${guild.id}\` and it can be invited again.`
        : `${BOT_NAME} stayed but every command is blocked there. Approve it with \`/guilds approve ${guild.id}\`, or remove it with \`/guilds leave ${guild.id}\`.`,
    })
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

export function buildInfoEmbed({ title, description }) {
  return new EmbedBuilder()
    .setColor(INFO_COLOR)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

/**
 * Send an alert to every owner and to the webhook, if either is configured.
 * Failures are logged, never thrown: a report that cannot be delivered must not
 * take down the handler that raised it.
 */
export async function alert({ client, embed, owners = [], webhookUrl = null, log }) {
  if (owners.length === 0 && !webhookUrl) {
    log.warn('An alert was raised but no OWNER_IDS or ALERT_WEBHOOK_URL is set — nobody was told.');
    return;
  }

  for (const ownerId of owners) {
    try {
      const owner = await client.users.fetch(ownerId);
      await owner.send({ embeds: [embed] });
    } catch (error) {
      // Owners with DMs closed are the usual cause.
      log.warn(`Could not DM owner ${ownerId}: ${error.message}`);
    }
  }

  if (!webhookUrl) return;

  const webhook = new WebhookClient({ url: webhookUrl });
  try {
    await webhook.send({ embeds: [embed], username: BOT_NAME });
  } catch (error) {
    log.warn(`Could not post to the alert webhook: ${error.message}`);
  } finally {
    webhook.destroy();
  }
}
