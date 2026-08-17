import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { applySetup } from '../apply/setup.js';
import { BRAND_COLOR, FOOTER } from '../branding.js';
import { RANKS } from '../blueprint.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set the server up: ranks, channels, and the welcome message')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('run')
      .setDescription('Create anything missing and post the welcome message')
      .addBooleanOption((option) =>
        option
          .setName('dry_run')
          .setDescription('Show what would be created without touching the server'),
      )
      .addBooleanOption((option) =>
        option
          .setName('enforce_permissions')
          .setDescription('Also rewrite permissions on channels that already existed (default: leave them alone)'),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('Show what is bound and what is still missing'),
  );

const ACTION_LABELS = {
  keep: '✅ already bound',
  adopt: '🔗 adopting existing',
  create: '✨ creating',
};

function renderSteps(steps, { dryRun }) {
  if (steps.length === 0) return '_nothing_';
  return steps
    .map((step) => {
      const label = step.action === 'create' && dryRun ? '✨ would create' : ACTION_LABELS[step.action];
      return `${label} — **${step.name}**`;
    })
    .join('\n');
}

export async function execute(interaction, { store, client }) {
  if (interaction.options.getSubcommand() === 'status') {
    return showStatus(interaction, { store });
  }

  const missing = missingBotPermissions(interaction.guild);
  if (missing.length > 0) {
    return interaction.reply({
      content: `I am missing **${missing.join('**, **')}**. Grant those in Server Settings → Roles and run this again.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const dryRun = interaction.options.getBoolean('dry_run') ?? false;
  const enforcePermissions = interaction.options.getBoolean('enforce_permissions') ?? false;

  // Creating a dozen channels takes longer than the three seconds Discord gives
  // us to answer, so acknowledge first and edit the reply when it is done.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const config = await store.get(interaction.guildId);
  const report = await applySetup({
    guild: interaction.guild,
    client,
    config,
    store,
    dryRun,
    enforcePermissions,
  });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(dryRun ? 'Setup — dry run' : 'Setup complete')
    .addFields(
      { name: 'Ranks', value: renderSteps(report.roles, report) },
      { name: 'Categories', value: renderSteps(report.categories, report) },
      { name: 'Channels', value: renderSteps(report.channels, report) },
    )
    .setFooter({ text: FOOTER });

  if (report.welcome) {
    embed.addFields({
      name: 'Welcome message',
      value: `Posted in <#${report.welcome.channelId}>. Members pick their rank there.`,
    });
  }

  if (report.warnings.length > 0) {
    embed.addFields({ name: '⚠️ Worth knowing', value: report.warnings.join('\n') });
  }

  if (dryRun) {
    embed.setDescription('Nothing was changed. Run `/setup run` without `dry_run` to apply this.');
  } else {
    embed.setDescription(
      'Existing members were not touched — everyone keeps the ranks they already had. New members get the default rank on join.',
    );
  }

  return interaction.editReply({ embeds: [embed] });
}

async function showStatus(interaction, { store }) {
  const config = await store.get(interaction.guildId);

  const ranks = RANKS.map((rank) => {
    const roleId = config.roles[rank.key];
    const marks = [];
    if (rank.key === config.defaultRankKey) marks.push('default on join');
    if (rank.selfAssign) marks.push(`self-serve ${rank.selfAssign.emoji}`);
    const suffix = marks.length > 0 ? ` _(${marks.join(', ')})_` : '';
    return `${roleId ? `<@&${roleId}>` : `⚠️ **${rank.name}** unbound`}${suffix}`;
  }).join('\n');

  const welcome = config.welcome.messageId
    ? `<#${config.welcome.channelId}> — [message](https://discord.com/channels/${interaction.guildId}/${config.welcome.channelId}/${config.welcome.messageId})`
    : '⚠️ not posted yet — run `/welcome post`';

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle('Server status')
    .addFields(
      { name: 'Ranks', value: ranks },
      { name: 'Welcome message', value: welcome },
      {
        name: 'Behaviour',
        value: [
          `Exclusive ranks: **${config.exclusiveRanks ? 'on' : 'off'}**`,
          `Default rank removed when a rank is picked: **${config.removeDefaultOnPick ? 'on' : 'off'}**`,
          `Last setup: **${config.setupAt ? `<t:${Math.floor(Date.parse(config.setupAt) / 1000)}:R>` : 'never'}**`,
        ].join('\n'),
      },
    )
    .setFooter({ text: FOOTER });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

function missingBotPermissions(guild) {
  const me = guild.members.me;
  const needed = [
    [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
    [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
  ];
  return needed.filter(([bit]) => !me?.permissions.has(bit)).map(([, label]) => label);
}
