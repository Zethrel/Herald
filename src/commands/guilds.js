import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { BRAND_COLOR, FOOTER } from '../branding.js';
import { currentApproved } from '../access/guard.js';

export const data = new SlashCommandBuilder()
  .setName('guilds')
  .setDescription('Which servers this bot is allowed in (bot owners only)')
  // Discord has no "bot owner" permission to express here, so this only keeps
  // the command out of ordinary members' pickers. The real gate is the
  // OWNER_IDS check below.
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('Every server the bot is in, and whether it is approved'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('approve')
      .setDescription('Allow the bot to run in a server')
      .addStringOption((option) =>
        option.setName('server_id').setDescription('The server id').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('note').setDescription('Who it is for, why — shown in /guilds list'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('revoke')
      .setDescription('Take a server off the allowlist and leave it')
      .addStringOption((option) =>
        option.setName('server_id').setDescription('The server id').setRequired(true),
      )
      .addBooleanOption((option) =>
        option.setName('stay').setDescription('Revoke but do not leave (default: leave)'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('leave')
      .setDescription('Leave a server without changing the allowlist')
      .addStringOption((option) =>
        option.setName('server_id').setDescription('The server id').setRequired(true),
      ),
  );

export async function execute(interaction, { store, env, client, log }) {
  if (!env.ownerIds.includes(interaction.user.id)) {
    return interaction.reply({
      content: 'That one is for the people who run this bot.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const sub = interaction.options.getSubcommand();
  const serverId = interaction.options.getString('server_id');

  if (sub === 'list') return list(interaction, { store, env, client });

  if (sub === 'approve') {
    if (env.approvedGuilds.includes(serverId)) {
      return interaction.reply({
        content: `\`${serverId}\` is already approved through \`APPROVED_GUILDS\`. Nothing to do.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const guild = client.guilds.cache.get(serverId);
    const app = await store.getApp();
    await store.setApprovedGuilds({
      ...app.approvedGuilds,
      [serverId]: {
        name: guild?.name ?? null,
        approvedBy: interaction.user.id,
        approvedAt: new Date().toISOString(),
        note: interaction.options.getString('note') ?? null,
      },
    });

    log.info(`${interaction.user.tag} approved server ${serverId}`);
    return interaction.reply({
      content: guild
        ? `Approved **${guild.name}** (\`${serverId}\`). It works there from now on.`
        : `Approved \`${serverId}\`. The bot is not in that server yet — it will be let in when invited.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'revoke') {
    if (env.approvedGuilds.includes(serverId)) {
      return interaction.reply({
        content: `\`${serverId}\` is approved through \`APPROVED_GUILDS\` in the environment. Remove it there and restart — a command cannot override the deployment's own list.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const app = await store.getApp();
    if (!app.approvedGuilds[serverId]) {
      return interaction.reply({
        content: `\`${serverId}\` is not on the allowlist.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const approvedGuilds = { ...app.approvedGuilds };
    delete approvedGuilds[serverId];
    await store.setApprovedGuilds(approvedGuilds);

    let left = false;
    if (interaction.options.getBoolean('stay') !== true) {
      left = await leaveGuild(client, serverId, log);
    }

    log.info(`${interaction.user.tag} revoked server ${serverId}`);
    return interaction.reply({
      content: `Revoked \`${serverId}\`.${left ? ' Left the server.' : ''}`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // leave
  if (serverId === interaction.guildId) {
    return interaction.reply({
      content: 'Not from inside that server — run it from another one.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const left = await leaveGuild(client, serverId, log);
  return interaction.reply({
    content: left
      ? `Left \`${serverId}\`. It is still on the allowlist, so it can invite the bot back — use \`/guilds revoke\` to stop that.`
      : `The bot is not in \`${serverId}\`.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function leaveGuild(client, guildId, log) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return false;
  try {
    await guild.leave();
    return true;
  } catch (error) {
    log.error(`Could not leave ${guildId}: ${error.message}`);
    return false;
  }
}

async function list(interaction, { store, env, client }) {
  const approved = await currentApproved({ store, env });
  const app = await store.getApp();

  const joined = [...client.guilds.cache.values()]
    .map((guild) => {
      const isApproved = approved.has(guild.id);
      const source = env.approvedGuilds.includes(guild.id) ? ' _(env)_' : '';
      const note = app.approvedGuilds[guild.id]?.note;
      return [
        `${isApproved ? '✅' : '⚠️'} **${guild.name}** — \`${guild.id}\`${source}`,
        `　${guild.memberCount} members${note ? ` · ${note}` : ''}`,
      ].join('\n');
    })
    .join('\n');

  const notJoined = [...approved].filter((id) => !client.guilds.cache.has(id));

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Servers')
    .setDescription(joined || '_The bot is not in any server._')
    .addFields({
      name: 'Unapproved servers are',
      value:
        env.unapprovedAction === 'leave'
          ? 'reported to the owners, then left immediately.'
          : 'reported to the owners. The bot stays, but every command is blocked there.',
    })
    .setFooter({ text: FOOTER });

  if (notJoined.length > 0) {
    embed.addFields({
      name: 'Approved but not joined',
      value: notJoined.map((id) => `\`${id}\``).join(', '),
    });
  }

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
