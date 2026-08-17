// Environment is read once, here, and validated loudly. A bot that starts and
// then dies on the first API call because a token was missing is worse than one
// that refuses to start.
//
// `npm start` passes --env-file-if-exists=.env, so no dotenv dependency.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ACTIONS } from './access/approval.js';

// Files people end up with instead of `.env`. The first is by far the most
// common: Windows hides known extensions, so Notepad's "Save as .env" quietly
// writes `.env.txt` and File Explorer shows it as `.env`.
const LOOKALIKES = ['.env.txt', '.env.env', 'env', 'env.txt', '.env.local', '.ENV'];

/**
 * Why the variables are missing, in the terms someone can act on: which folder
 * was looked in, whether a file is there at all, and -- if it is -- which keys
 * it defines. Never the values: a token in a log is a leaked token.
 */
export function diagnoseEnvFile(cwd = process.cwd()) {
  const path = resolve(cwd, '.env');

  if (!existsSync(path)) {
    const found = LOOKALIKES.filter((name) => existsSync(resolve(cwd, name)));

    return [
      `No .env file in ${cwd}`,
      found.length > 0
        ? `Found ${found.join(', ')} instead — rename it to exactly \`.env\`. (Windows hides known extensions, so Notepad writes .env.txt while Explorer shows ".env".)`
        : 'Either you are in the wrong folder — it must be the one containing package.json — or the file was saved under another name.',
      'Create it with: cp .env.example .env',
    ];
  }

  let keys = [];
  try {
    keys = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('=')[0].trim())
      .filter(Boolean);
  } catch (error) {
    return [`Found ${path} but could not read it: ${error.message}`];
  }

  return [
    `Found ${path}, defining: ${keys.join(', ') || '(nothing)'}`,
    keys.length === 0
      ? 'Every line is blank or commented out — the values go after the `=`, with no `#` in front.'
      : 'A key listed above with nothing after its `=` counts as unset.',
  ];
}

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
      [
        `Missing required environment variable(s): ${missing.join(', ')}`,
        '',
        ...diagnoseEnvFile(),
        '',
        'DISCORD_TOKEN is the Bot token — Developer Portal → your app → Bot → Reset Token.',
        'It is not the Application ID and not the Public Key.',
      ].join('\n'),
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
    // The tier's consumables, edited by hand and read at startup.
    tierFile: resolve(env.TIER_FILE?.trim() || 'tiers/current.json'),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    // Who may run /guilds, and who gets told about an unapproved invite.
    ownerIds,
    // The permanent half of the allowlist. /guilds approve adds to the store
    // instead, so this file stays the record of what was decided deliberately.
    approvedGuilds: parseIdList(env.APPROVED_GUILDS),
    unapprovedAction,
    alertWebhookUrl: env.ALERT_WEBHOOK_URL?.trim() || null,
    // Optional. Present: the shopping list can price itself off the commodity
    // auction house. Absent: everything else works exactly as before.
    blizzard: readOptionalBlizzard(env),
  };
}

function readOptionalBlizzard(env) {
  const clientId = env.BLIZZARD_CLIENT_ID?.trim();
  const clientSecret = env.BLIZZARD_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  return {
    clientId,
    clientSecret,
    region: env.BLIZZARD_REGION?.trim() || 'eu',
    locale: env.BLIZZARD_LOCALE?.trim() || 'en_GB',
  };
}
