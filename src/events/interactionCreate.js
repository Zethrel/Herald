import { Events, MessageFlags } from 'discord.js';

import { commandsByName } from '../commands/index.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, context) {
  if (!interaction.isChatInputCommand()) return;

  const command = commandsByName.get(interaction.commandName);
  if (!command) {
    context.log.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction, context);
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
