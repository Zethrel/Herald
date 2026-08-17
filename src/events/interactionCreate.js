import { Events, MessageFlags } from 'discord.js';

import { BOT_NAME } from '../branding.js';
import { commandsByName } from '../commands/index.js';
import { currentApproved } from '../access/guard.js';

export const name = Events.InteractionCreate;

export async function execute(interaction, context) {
  if (!interaction.isChatInputCommand()) return;

  const command = commandsByName.get(interaction.commandName);
  if (!command) {
    context.log.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  // This is what makes UNAPPROVED_SERVER_ACTION=report mean something: the bot
  // stays in a server it was not approved for, but does nothing there.
  if (interaction.inGuild()) {
    const approved = await currentApproved({ store: context.store, env: context.env });
    if (!approved.has(interaction.guildId)) {
      context.log.warn(`/${interaction.commandName} blocked in unapproved server ${interaction.guildId}`);
      return interaction.reply({
        content: `${BOT_NAME} is not licensed for this server. Ask whoever runs it to approve the server first.`,
        flags: MessageFlags.Ephemeral,
      });
    }
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
