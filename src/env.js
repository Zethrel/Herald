// Environment is read once, here, and validated loudly. A bot that starts and
// then dies on the first API call because a token was missing is worse than one
// that refuses to start.
//
// `npm start` passes --env-file-if-exists=.env, so no dotenv dependency.

import { resolve } from 'node:path';

import { ACTIONS } from './access/approval.js';

/** Comma- or whitespace-separated ids, tolerant of trailing commas and spaces. */
export function parseIdList(value) {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

export function readEnv(env = process.env) {
  const missing = [];

  const token = env.DISCORD_TOKEN?.trim();
  if (!token) missing.push('DISCORD_TOKEN');

  const clientId = env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) missing.push('DISCORD_CLIENT_ID');

  const ownerIds = parseIdList(env.OWNER_IDS);
  if (ownerIds.length === 0) missing.push('OWNER_IDS');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. Copy .env.example to .env and fill it in.`,
    );
  }

  const unapprovedAction = env.UNAPPROVED_SERVER_ACTION?.trim() || ACTIONS.leave;
  if (!Object.values(ACTIONS).includes(unapprovedAction)) {
    throw new Error(
      `UNAPPROVED_SERVER_ACTION must be one of: ${Object.values(ACTIONS).join(', ')} (got "${unapprovedAction}").`,
    );
  }

  return {
    token,
    clientId,
    // Set this while developing: guild commands appear instantly, global ones
    // can take up to an hour to propagate.
    devGuildId: env.DISCORD_GUILD_ID?.trim() || null,
    dataFile: resolve(env.DATA_FILE?.trim() || 'data/guilds.json'),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    // Who may run /guilds, and who gets told about an unapproved invite.
    ownerIds,
    // The permanent half of the allowlist. /guilds approve adds to the store
    // instead, so this file stays the record of what was decided deliberately.
    approvedGuilds: parseIdList(env.APPROVED_GUILDS),
    unapprovedAction,
    alertWebhookUrl: env.ALERT_WEBHOOK_URL?.trim() || null,
  };
}
