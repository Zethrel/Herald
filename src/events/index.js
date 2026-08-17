import * as clientReady from './clientReady.js';
import * as guildCreate from './guildCreate.js';
import * as guildMemberAdd from './guildMemberAdd.js';
import * as interactionCreate from './interactionCreate.js';
import * as messageReactionAdd from './messageReactionAdd.js';
import * as messageReactionRemove from './messageReactionRemove.js';

export const events = [
  clientReady,
  guildCreate,
  guildMemberAdd,
  interactionCreate,
  messageReactionAdd,
  messageReactionRemove,
];
