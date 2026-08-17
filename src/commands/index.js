import * as about from './about.js';
import * as config from './config.js';
import * as rank from './rank.js';
import * as setup from './setup.js';
import * as welcome from './welcome.js';

export const commands = [setup, welcome, config, rank, about];

/** name -> module, for the interaction handler. */
export const commandsByName = new Map(commands.map((command) => [command.data.name, command]));

/** The payload the Discord API wants when registering slash commands. */
export function commandPayload() {
  return commands.map((command) => command.data.toJSON());
}
