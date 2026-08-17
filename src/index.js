import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';

import { createLogger } from './logger.js';
import { createReminderScheduler } from './raids/scheduler.js';
import { createStore } from './store.js';
import { events } from './events/index.js';
import { loadDataset } from './consumables/dataset.js';
import { priceServiceFromEnv } from './prices/service.js';
import { readEnv } from './env.js';

let env;
try {
  env = readEnv();
} catch (error) {
  console.error(`\n${error.message}\n`);
  process.exit(1);
}

const log = createLogger(env.logLevel);
const store = createStore(env.dataFile);

// Read once at startup: it is a hand-edited file, and a raid night is not the
// time to discover it stopped parsing. Editing it means a restart, which is the
// same cost as editing .env.
const dataset = await loadDataset(env.tierFile);
log.info(
  `Tier data: ${dataset.tier.name ?? 'unnamed'} (${Object.keys(dataset.specs).length} spec entries, ${
    Object.keys(dataset.recipes).length
  } recipes)`,
);

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

const prices = priceServiceFromEnv({ env, log });
log.info(
  prices.available
    ? `Commodity prices enabled (${env.blizzard.region.toUpperCase()}), refreshed hourly at 20 past`
    : 'Commodity prices disabled — set BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET to turn them on',
);

// Started once the gateway is ready, not here: it posts messages.
const reminders = createReminderScheduler({ client, store, env, log });

const context = { store, log, client, env, dataset, prices, reminders };

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
    reminders.stop();
    client.destroy().finally(() => process.exit(0));
  });
}

await client.login(env.token);
