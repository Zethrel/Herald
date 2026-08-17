import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { BRAND_COLOR, FOOTER } from '../branding.js';
import { RANKS, SELF_ASSIGN_RANKS } from '../blueprint.js';
import { normalizeEmoji } from '../ranks/selfAssign.js';

const rankChoices = RANKS.map((rank) => ({ name: rank.name, value: rank.key }));
const selfAssignChoices = SELF_ASSIGN_RANKS.map((rank) => ({ name: rank.name, value: rank.key }));

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Point the bot at roles you already have, and change how ranks behave')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('rank')
      .setDescription('Bind one of the bot\'s ranks to a role on this server')
      .addStringOption((option) =>
        option.setName('rank').setDescription('Which rank').setRequired(true).addChoices(...rankChoices),
      )
      .addRoleOption((option) =>
        option.setName('role').setDescription('The role to use for it').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('emoji')
      .setDescription('Change the emoji members react with for a self-serve rank')
      .addStringOption((option) =>
        option
          .setName('rank')
          .setDescription('Which self-serve rank')
          .setRequired(true)
          .addChoices(...selfAssignChoices),
      )
      .addStringOption((option) =>
        option.setName('emoji').setDescription('A standard emoji, e.g. ⚔️').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('behaviour')
      .setDescription('Change how the self-serve ranks behave')
      .addBooleanOption((option) =>
        option
          .setName('exclusive_ranks')
          .setDescription('Picking one self-serve rank hands the other back (default: on)'),
      )
      .addBooleanOption((option) =>
        option
          .setName('remove_default_on_pick')
          .setDescription('Take the default rank away once a rank is picked (default: on)'),
      ),
  )
  .addSubcommand((sub) => sub.setName('view').setDescription('Show the current configuration'));

export async function execute(interaction, { store }) {
  const sub = interaction.options.getSubcommand();
  const config = await store.get(interaction.guildId);

  if (sub === 'view') {
    return interaction.reply({ embeds: [renderConfig(config)], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'rank') {
    const rankKey = interaction.options.getString('rank');
    const role = interaction.options.getRole('role');

    const problem = roleProblem(role, interaction.guild);
    if (problem) {
      return interaction.reply({ content: problem, flags: MessageFlags.Ephemeral });
    }

    await store.update(interaction.guildId, { roles: { [rankKey]: role.id } });
    return interaction.reply({
      content: `**${RANKS.find((rank) => rank.key === rankKey).name}** now means <@&${role.id}>. Existing holders keep it; nothing was reassigned.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  if (sub === 'emoji') {
    const rankKey = interaction.options.getString('rank');
    const emoji = normalizeEmoji(interaction.options.getString('emoji'));

    if (/^<a?:/.test(emoji) || emoji.length === 0) {
      return interaction.reply({
        content:
          'That needs to be a standard emoji — custom server emoji are not supported for rank reactions yet.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Emoji are the keys of the map, so re-pointing one means dropping the old
    // entry rather than adding a second emoji for the same rank.
    const selfAssign = Object.fromEntries(
      Object.entries(config.selfAssign).filter(([, value]) => value !== rankKey),
    );
    selfAssign[emoji] = rankKey;

    await store.update(interaction.guildId, { selfAssign });
    return interaction.reply({
      content: `${emoji} now grants **${RANKS.find((rank) => rank.key === rankKey).name}**. Run \`/welcome refresh\` to update the message.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // behaviour
  const patch = {};
  const exclusive = interaction.options.getBoolean('exclusive_ranks');
  const removeDefault = interaction.options.getBoolean('remove_default_on_pick');
  if (exclusive !== null) patch.exclusiveRanks = exclusive;
  if (removeDefault !== null) patch.removeDefaultOnPick = removeDefault;

  if (Object.keys(patch).length === 0) {
    return interaction.reply({
      content: 'Nothing to change — pass at least one option.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const next = await store.update(interaction.guildId, patch);
  return interaction.reply({ embeds: [renderConfig(next)], flags: MessageFlags.Ephemeral });
}

function renderConfig(config) {
  const ranks = RANKS.map((rank) => {
    const roleId = config.roles[rank.key];
    return `**${rank.name}** → ${roleId ? `<@&${roleId}>` : '_unbound_'}`;
  }).join('\n');

  const reactions =
    Object.entries(config.selfAssign)
      .map(([emoji, rankKey]) => `${emoji} → **${RANKS.find((rank) => rank.key === rankKey)?.name ?? rankKey}**`)
      .join('\n') || '_none_';

  return new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Configuration')
    .addFields(
      { name: 'Ranks', value: ranks },
      { name: 'Welcome reactions', value: reactions },
      {
        name: 'Behaviour',
        value: [
          `Default rank on join: **${config.defaultRankKey ?? 'none'}**`,
          `Exclusive ranks: **${config.exclusiveRanks ? 'on' : 'off'}**`,
          `Remove default on pick: **${config.removeDefaultOnPick ? 'on' : 'off'}**`,
        ].join('\n'),
      },
    )
    .setFooter({ text: FOOTER });
}

function roleProblem(role, guild) {
  if (role.managed) {
    return `<@&${role.id}> is managed by an integration, so nobody can be given it by hand. Pick another role.`;
  }
  if (role.id === guild.roles.everyone.id) {
    return '`@everyone` cannot be used as a rank.';
  }
  const botTop = guild.members.me?.roles.highest.position ?? 0;
  if (role.position >= botTop) {
    return `<@&${role.id}> sits above my own role, so I cannot hand it out. Move my role above it in Server Settings → Roles.`;
  }
  return null;
}
