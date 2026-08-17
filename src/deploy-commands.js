// Registers the slash commands with Discord. Run once after changing any
// command definition -- the gateway client does not do this on startup, because
// re-registering on every restart burns a rate limit for nothing.
//
//   npm run deploy                       (global: up to an hour to appear)
//   DISCORD_GUILD_ID=... npm run deploy  (one server: instant, for development)

import { REST, Routes } from 'discord.js';

import { commandPayload } from './commands/index.js';
import { createLogger } from './logger.js';
import { readEnv } from './env.js';

const env = readEnv();
const log = createLogger(env.logLevel);
const body = commandPayload();

const rest = new REST().setToken(env.token);

const route = env.devGuildId
  ? Routes.applicationGuildCommands(env.clientId, env.devGuildId)
  : Routes.applicationCommands(env.clientId);

const registered = await rest.put(route, { body });

log.info(
  `Registered ${registered.length} command(s) ${env.devGuildId ? `to guild ${env.devGuildId}` : 'globally'}: ${registered
    .map((command) => `/${command.name}`)
    .join(', ')}`,
);
