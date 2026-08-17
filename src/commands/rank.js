import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { planBackfill } from '../ranks/membership.js';
import { RANKS } from '../blueprint.js';

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Rank housekeeping')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('backfill')
      .setDescription('Give the default rank to members who have no rank at all')
      .addBooleanOption((option) =>
        option
          .setName('confirm')
          .setDescription('Actually apply it. Without this you get a count and nothing else.'),
      ),
  );

export async function execute(interaction, { store }) {
  const config = await store.get(interaction.guildId);
  const confirm = interaction.options.getBoolean('confirm') ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const members = await interaction.guild.members.fetch();
  const snapshot = [...members.values()].map((member) => ({
    id: member.id,
    isBot: member.user.bot,
    roleIds: [...member.roles.cache.keys()],
  }));

  const plan = planBackfill(snapshot, config);
  if (!plan.defaultRoleId) {
    return interaction.editReply(
      'No default rank is bound. Run `/setup run`, or bind one with `/config rank`.',
    );
  }

  const defaultRankName = RANKS.find((rank) => rank.key === config.defaultRankKey)?.name ?? 'the default rank';
  const summary = [
    `**${plan.assign.length}** member(s) have no rank at all.`,
    `**${plan.skipped.alreadyRanked}** already hold a rank and will not be touched.`,
    `**${plan.skipped.bots}** bot(s) skipped.`,
  ].join('\n');

  if (!confirm) {
    return interaction.editReply(
      `${summary}\n\nRun \`/rank backfill confirm:true\` to give those ${plan.assign.length} member(s) **${defaultRankName}**.`,
    );
  }

  let assigned = 0;
  const failures = [];
  for (const memberId of plan.assign) {
    const member = members.get(memberId);
    try {
      await member.roles.add(plan.defaultRoleId, 'Backfilling the default rank');
      assigned += 1;
    } catch (error) {
      failures.push(`${member?.user?.tag ?? memberId}: ${error.message}`);
    }
  }

  const tail = failures.length > 0 ? `\n\n⚠️ ${failures.length} failed:\n${failures.slice(0, 5).join('\n')}` : '';
  return interaction.editReply(
    `${summary}\n\nGave **${defaultRankName}** to **${assigned}** member(s). Everyone who already had a rank kept it.${tail}`,
  );
}
