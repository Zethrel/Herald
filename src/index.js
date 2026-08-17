import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

import { createLogger } from './logger.js';
import { createStore } from './store.js';
import { events } from './events/index.js';
import { readEnv } from './env.js';

const env = readEnv();
const log = createLogger(env.logLevel);
const store = createStore(env.dataFile);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Privileged: needed for the default rank on join. Turn "Server Members
    // Intent" on in the Developer Portal or the bot will never see a join.
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageReactions,
  ],
  // The welcome message is long-lived, so reactions on it arrive uncached after
  // a restart. Without these partials those events are dropped silently.
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

const context = { store, log, client, env };

for (const event of events) {
  const handler = (...args) =>
    Promise.resolve(event.execute(...args, context)).catch((error) => {
      log.error(`${event.name} handler failed: ${error.stack ?? error.message}`);
    });

  if (event.once) client.once(event.name, handler);
  else client.on(event.name, handler);
}

client.on(Events.Error, (error) => log.error(`Client error: ${error.message}`));
client.rest.on('rateLimited', (info) => log.warn(`Rate limited on ${info.route} for ${info.timeToReset}ms`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log.info(`${signal} — shutting down`);
    client.destroy().finally(() => process.exit(0));
  });
}

await client.login(env.token);
