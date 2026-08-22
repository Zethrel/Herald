import { Events, MessageFlags } from 'discord.js';

import { BOT_NAME } from '../branding.js';
import { commandsByName } from '../commands/index.js';
import { currentApproved } from '../access/guard.js';
import { syncBoard } from '../consumables/board.js';
import { handleRaidComponent, isRaidComponent } from './raidComponents.js';

export const name = Events.InteractionCreate;

// Commands that can change what the consumables board says: the consumable data
// itself, and the raid rosters that decide which specs are marked. Anything
// else -- /about, /welcome, /guilds -- cannot, and re-rendering after them
// would spend an API call to discover nothing changed.
const BOARD_TOUCHING = new Set(['consumables', 'raid']);

/**
 * Bring the board back in line after something changed. Deliberately not
 * awaited: the board is a convenience, and it must never be the reason a
 * command appears to fail. `syncBoard` returns early when this server has no
 * board, and when the render is identical to what is already posted.
 */
function refreshBoard(interaction, context) {
  if (!interaction.guildId) return;

  syncBoard(interaction.guildId, context).catch((error) =>
    context.log.warn(`Consumables board refresh failed: ${error.message}`),
  );
}

export async function execute(interaction, context) {
  // Type-ahead. Discord gives three seconds and ignores a late reply, so this
  // runs before anything that touches the store or the network.
  if (interaction.isAutocomplete()) {
    const command = commandsByName.get(interaction.commandName);
    if (!command?.autocomplete) return;
    return command.autocomplete(interaction, context).catch((error) => {
      context.log.warn(`Autocomplete for /${interaction.commandName} failed: ${error.message}`);
    });
  }

  if (isRaidComponent(interaction)) {
    if (!(await inApprovedServer(interaction, context))) return;
    try {
      const handled = await handleRaidComponent(interaction, context);
      refreshBoard(interaction, context);
      return handled;
    } catch (error) {
      context.log.error(`Raid component failed: ${error.stack ?? error.message}`);
      const message = { content: `That did not work: ${error.message}`, flags: MessageFlags.Ephemeral };
      return (interaction.replied || interaction.deferred
        ? interaction.followUp(message)
        : interaction.reply(message)
      ).catch(() => {});
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commandsByName.get(interaction.commandName);
  if (!command) {
    context.log.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  if (!(await inApprovedServer(interaction, context))) return;

  try {
    await command.execute(interaction, context);
    if (BOARD_TOUCHING.has(interaction.commandName)) refreshBoard(interaction, context);
  } catch (error) {
    context.log.error(`/${interaction.commandName} failed: ${error.stack ?? error.message}`);

    const message = {
      content: `Something went wrong running that: ${error.message}`,
      flags: MessageFlags.Ephemeral,
    };

    // A deferred interaction has already been answered once, so the failure has
    // to go out as an edit or Discord rejects it.
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message).catch(() => {});
    } else {
      await interaction.reply(message).catch(() => {});
    }
  }
}

/**
 * What makes UNAPPROVED_SERVER_ACTION=report mean something: the bot stays in a
 * server it was not approved for, but does nothing there. Buttons are held to
 * the same rule as commands -- a signup post left behind in a server that lost
 * its approval must stop working too.
 */
async function inApprovedServer(interaction, context) {
  if (!interaction.inGuild()) return true;

  const approved = await currentApproved({ store: context.store, env: context.env });
  if (approved.has(interaction.guildId)) return true;

  context.log.warn(`Interaction blocked in unapproved server ${interaction.guildId}`);
  await interaction
    .reply({
      content: `${BOT_NAME} is not licensed for this server. Ask whoever runs it to approve the server first.`,
      flags: MessageFlags.Ephemeral,
    })
    .catch(() => {});

  return false;
}
