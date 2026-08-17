import {
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { buildRaidButtons, buildRaidEmbed } from '../raids/render.js';
import { createRaid, nextRaidId } from '../raids/model.js';
import { deleteRaid, getRaid, listRaids, saveRaid, updateRaid, upcomingRaids } from '../raids/repository.js';
import { discordTime, isValidTimeZone, parseWhen } from '../raids/time.js';

export const data = new SlashCommandBuilder()
  .setName('raid')
  .setDescription('Raid nights and who is coming')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Post a signup for a raid night (Manage Server)')
      .addStringOption((option) =>
        option.setName('title').setDescription('e.g. Heroic clear, Mythic progression').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('when').setDescription('YYYY-MM-DD HH:MM in the server timezone').setRequired(true),
      )
      .addStringOption((option) => option.setName('description').setDescription('Anything else raiders should know'))
      .addChannelOption((option) =>
        option
          .setName('channel')
          .setDescription('Where to post it (default: #raid-signups)')
          .addChannelTypes(ChannelType.GuildText),
      )
      .addStringOption((option) =>
        option.setName('timezone').setDescription('IANA name, e.g. Europe/Oslo. Default: the server setting'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('roster')
      .setDescription('Who is signed up')
      .addStringOption((option) =>
        option.setName('raid').setDescription('Which raid').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('Upcoming raids'))
  .addSubcommand((sub) =>
    sub
      .setName('close')
      .setDescription('Stop taking signups, keeping the roster (Manage Server)')
      .addStringOption((option) =>
        option.setName('raid').setDescription('Which raid').setRequired(true).setAutocomplete(true),
      )
      .addBooleanOption((option) =>
        option.setName('reopen').setDescription('Open it again instead of closing it'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('cancel')
      .setDescription('Call the raid off (Manage Server)')
      .addStringOption((option) =>
        option.setName('raid').setDescription('Which raid').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('delete')
      .setDescription('Remove a raid and its signups entirely (Manage Server)')
      .addStringOption((option) =>
        option.setName('raid').setDescription('Which raid').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('timezone')
      .setDescription('The timezone /raid create reads times in (Manage Server)')
      .addStringOption((option) =>
        option.setName('zone').setDescription('IANA name, e.g. Europe/Oslo').setRequired(true),
      ),
  );

export async function autocomplete(interaction, { store }) {
  const typed = interaction.options.getFocused().toLowerCase();
  const raids = await listRaids(store, interaction.guildId);

  const matches = raids
    .filter((raid) => `${raid.id} ${raid.title}`.toLowerCase().includes(typed))
    .slice(0, 25)
    .map((raid) => ({
      name: `${raid.title} — ${new Date(raid.startsAt).toISOString().slice(0, 16).replace('T', ' ')}${
        raid.cancelled ? ' (cancelled)' : raid.closed ? ' (closed)' : ''
      }`.slice(0, 100),
      value: raid.id,
    }));

  await interaction.respond(matches);
}

export async function execute(interaction, context) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'roster') return showRoster(interaction, context);
  if (sub === 'list') return showList(interaction, context);

  // Everything else changes the raid schedule.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: 'Running the raid calendar is a Manage Server job.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'create') return create(interaction, context);
  if (sub === 'timezone') return setTimeZone(interaction, context);
  return changeState(interaction, context, sub);
}

async function create(interaction, { store, log }) {
  const config = await store.get(interaction.guildId);
  const timeZone = interaction.options.getString('timezone') ?? config.timeZone ?? 'UTC';

  const when = parseWhen(interaction.options.getString('when'), timeZone);
  if (when.error) {
    return interaction.reply({ content: when.error, flags: MessageFlags.Ephemeral });
  }

  const channel =
    interaction.options.getChannel('channel') ??
    (config.channels?.raidSignups ? interaction.guild.channels.cache.get(config.channels.raidSignups) : null) ??
    interaction.channel;

  const raid = createRaid({
    id: nextRaidId(config.raids),
    title: interaction.options.getString('title'),
    startsAt: when.date,
    description: interaction.options.getString('description'),
    createdBy: interaction.user.id,
    timeZone,
  });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const message = await channel.send({
    embeds: [buildRaidEmbed(raid)],
    components: buildRaidButtons(raid),
  });

  await saveRaid(store, interaction.guildId, {
    ...raid,
    channelId: channel.id,
    messageId: message.id,
  });

  log.info(`${interaction.user.tag} created ${raid.id} in ${interaction.guild.name}`);

  return interaction.editReply(
    `**${raid.title}** is up in <#${channel.id}> for ${discordTime(when.date, 'F')} (\`${raid.id}\`). ${message.url}`,
  );
}

async function showRoster(interaction, { store }) {
  const raid = await getRaid(store, interaction.guildId, interaction.options.getString('raid'));
  if (!raid) {
    return interaction.reply({ content: 'No such raid.', flags: MessageFlags.Ephemeral });
  }

  return interaction.reply({ embeds: [buildRaidEmbed(raid)], flags: MessageFlags.Ephemeral });
}

async function showList(interaction, { store }) {
  const raids = await upcomingRaids(store, interaction.guildId);
  if (raids.length === 0) {
    return interaction.reply({ content: 'Nothing on the calendar.', flags: MessageFlags.Ephemeral });
  }

  const lines = raids.map((raid) => {
    const signups = Object.values(raid.signups ?? {}).filter((signup) => signup.status === 'yes').length;
    const state = raid.closed ? ' _(closed)_' : '';
    return `\`${raid.id}\` **${raid.title}** — ${discordTime(new Date(raid.startsAt), 'F')} · ${signups} signed up${state}`;
  });

  return interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
}

async function setTimeZone(interaction, { store }) {
  const zone = interaction.options.getString('zone').trim();
  if (!isValidTimeZone(zone)) {
    return interaction.reply({
      content: `"${zone}" is not a timezone I know. Use an IANA name like \`Europe/Oslo\`.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await store.update(interaction.guildId, { timeZone: zone });
  return interaction.reply({
    content: `Times in \`/raid create\` are now read as **${zone}**. Raids already posted keep the time they were created with.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function changeState(interaction, { store, client, log }, sub) {
  const raidId = interaction.options.getString('raid');

  if (sub === 'delete') {
    const raid = await getRaid(store, interaction.guildId, raidId);
    if (!raid) return interaction.reply({ content: 'No such raid.', flags: MessageFlags.Ephemeral });

    await deleteRaid(store, interaction.guildId, raidId);
    // The post outlives the record otherwise, and its buttons would answer
    // "that raid no longer exists" forever.
    await deleteRaidMessage(client, raid).catch(() => {});

    log.info(`${interaction.user.tag} deleted ${raidId}`);
    return interaction.reply({
      content: `Deleted **${raid.title}** and its signups.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const reopen = sub === 'close' && interaction.options.getBoolean('reopen') === true;
  const { raid, error } = await updateRaid(store, interaction.guildId, raidId, (current) => ({
    ...current,
    closed: sub === 'close' ? !reopen : current.closed,
    cancelled: sub === 'cancel' ? true : current.cancelled,
  }));

  if (error) return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });

  await refreshRaidMessage(client, raid).catch(() => {});
  log.info(`${interaction.user.tag} ${sub}d ${raidId}`);

  const said = {
    close: reopen ? 'Signups are open again' : 'Signups are closed',
    cancel: 'Raid cancelled',
  };

  return interaction.reply({ content: `${said[sub]} for **${raid.title}**.`, flags: MessageFlags.Ephemeral });
}

/** Re-render the signup post after anything that changes it. */
export async function refreshRaidMessage(client, raid) {
  if (!raid?.channelId || !raid?.messageId) return null;

  const channel = await client.channels.fetch(raid.channelId);
  const message = await channel.messages.fetch(raid.messageId);

  return message.edit({
    embeds: [buildRaidEmbed(raid)],
    components: buildRaidButtons(raid),
  });
}

async function deleteRaidMessage(client, raid) {
  if (!raid?.channelId || !raid?.messageId) return;
  const channel = await client.channels.fetch(raid.channelId);
  const message = await channel.messages.fetch(raid.messageId);
  await message.delete();
}
