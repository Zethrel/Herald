// Environment is read once, here, and validated loudly. A bot that starts and
// then dies on the first API call because a token was missing is worse than one
// that refuses to start.
//
// `npm start` passes --env-file-if-exists=.env, so no dotenv dependency.

import { resolve } from 'node:path';

export function readEnv(env = process.env) {
  const missing = [];

  const token = env.DISCORD_TOKEN?.trim();
  if (!token) missing.push('DISCORD_TOKEN');

  const clientId = env.DISCORD_CLIENT_ID?.trim();
  if (!clientId) missing.push('DISCORD_CLIENT_ID');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. Copy .env.example to .env and fill it in.`,
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
  };
}
