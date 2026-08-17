// The buttons and menus on a signup post.
//
// The flow is built around one goal: signing up should be a single click for
// anyone who has signed up before. The first time, the bot does not know what
// someone plays, so it asks -- class, then spec, because Discord allows 25
// options in a select and there are 39 specs. After that the spec is remembered
// per server and every later raid is one press.

import { MessageFlags } from 'discord.js';

import { STATUSES, applySignup, setSpec } from '../raids/model.js';
import { buildClassSelect, buildSpecSelect, parseCustomId } from '../raids/render.js';
import { getMain, getRaid, setMain, updateRaid } from '../raids/repository.js';
import { refreshRaidMessage } from '../commands/raid.js';
import { specByKey } from '../game/specs.js';

/** True when this interaction belongs to a raid post. */
export function isRaidComponent(interaction) {
  return (
    (interaction.isButton() || interaction.isStringSelectMenu()) &&
    parseCustomId(interaction.customId) !== null
  );
}

export async function handleRaidComponent(interaction, context) {
  const { raidId, action, argument } = parseCustomId(interaction.customId);
  const { store, client, log } = context;

  const raid = await getRaid(store, interaction.guildId, raidId);
  if (!raid) {
    return interaction.reply({
      content: 'That raid is no longer on the calendar.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (action === 'status') return pressStatus(interaction, { ...context, raid, raidId, status: argument });
  if (action === 'changespec') return askForClass(interaction, { raidId, status: 'none' });
  if (action === 'class') return askForSpec(interaction, { raidId, status: argument });
  if (action === 'spec') return applySpec(interaction, { ...context, raidId, status: argument });

  log.warn(`Unknown raid component action: ${action}`);
  return null;
}

async function pressStatus(interaction, { store, client, log, raid, raidId, status }) {
  if (!STATUSES[status]) return null;

  const main = await getMain(store, interaction.guildId, interaction.user.id);
  const known = raid.signups?.[interaction.user.id]?.specKey ?? main;

  // Absence needs no spec, and neither does anyone the bot already knows.
  if (!known && status !== 'no' && status !== 'tentative') {
    return askForClass(interaction, { raidId, status });
  }

  const { raid: next, error } = await updateRaid(store, interaction.guildId, raidId, (current) =>
    applySignup(current, { userId: interaction.user.id, status, specKey: known ?? null }),
  );

  if (error) {
    return interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
  }

  // Acknowledge first: the message edit is a second API call, and Discord only
  // gives three seconds before the click is marked as failed.
  await interaction.reply({
    content: `${STATUSES[status].emoji} **${STATUSES[status].label}**${
      known ? ` as ${specByKey(known)?.name ?? known}` : ''
    }. Use **Change spec** if that is wrong.`,
    flags: MessageFlags.Ephemeral,
  });

  await refreshRaidMessage(client, next).catch((error) =>
    log.warn(`Could not refresh ${raidId}: ${error.message}`),
  );
  return null;
}

function askForClass(interaction, { raidId, status }) {
  return interaction.reply({
    content: 'Which class are you bringing?',
    components: [buildClassSelect(raidId, status)],
    flags: MessageFlags.Ephemeral,
  });
}

function askForSpec(interaction, { raidId, status }) {
  const className = interaction.values[0];

  // Editing the same ephemeral message keeps it to one prompt rather than a
  // stack of them.
  return interaction.update({
    content: `And which ${className} spec?`,
    components: [buildSpecSelect(raidId, status, className)],
  });
}

async function applySpec(interaction, { store, client, log, raidId, status }) {
  const specKey = interaction.values[0];
  const spec = specByKey(specKey);

  await setMain(store, interaction.guildId, interaction.user.id, specKey);

  const { raid: next, error } = await updateRaid(store, interaction.guildId, raidId, (current) => {
    // `none` means they came from Change spec: keep whatever status they had,
    // and do not sign up someone who had not signed up.
    if (status === 'none') {
      return current.signups?.[interaction.user.id]
        ? setSpec(current, interaction.user.id, specKey)
        : current;
    }
    return applySignup(current, { userId: interaction.user.id, status, specKey });
  });

  if (error) {
    return interaction.update({ content: error, components: [] });
  }

  const signedUpAs = status === 'none' ? 'Spec set to' : `${STATUSES[status].emoji} ${STATUSES[status].label} as`;

  await interaction.update({
    content: `${signedUpAs} **${spec ? `${spec.name} ${spec.className}` : specKey}**. I will remember it for the next one.`,
    components: [],
  });

  await refreshRaidMessage(client, next).catch((error) =>
    log.warn(`Could not refresh ${raidId}: ${error.message}`),
  );
  return null;
}
