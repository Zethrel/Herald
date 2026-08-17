// The signup post: what it looks like and what you can press on it.
//
// Custom ids are the only state a component carries, so they are built and
// parsed in one place: `raid:<raidId>:<action>[:<argument>]`.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';

import { BRAND_COLOR, FOOTER } from '../branding.js';
import { STATUSES, STATUS_KEYS, buildRoster } from './model.js';
import { SPECS, specsByClass } from '../game/specs.js';
import { discordTime } from './time.js';

export const PREFIX = 'raid';

export function customId(raidId, action, argument = null) {
  return [PREFIX, raidId, action, argument].filter((part) => part !== null).join(':');
}

export function parseCustomId(id) {
  const [prefix, raidId, action, ...rest] = (id ?? '').split(':');
  if (prefix !== PREFIX || !raidId || !action) return null;
  return { raidId, action, argument: rest.length > 0 ? rest.join(':') : null };
}

const ROLE_HEADINGS = {
  tank: '🛡️ Tanks',
  healer: '💚 Healers',
  melee: '⚔️ Melee',
  ranged: '🏹 Ranged',
};

function line(entry) {
  const spec = entry.spec ? ` — ${entry.spec.name} ${entry.spec.className}` : ' — _spec not set_';
  return `<@${entry.userId}>${spec}`;
}

export function buildRaidEmbed(raid) {
  const { roster, other, counts } = buildRoster(raid);
  const startsAt = new Date(raid.startsAt);

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(raid.cancelled ? `~~${raid.title}~~ (cancelled)` : raid.title)
    .setDescription(
      [
        `${discordTime(startsAt, 'F')} · ${discordTime(startsAt, 'R')}`,
        raid.description ?? null,
        raid.closed && !raid.cancelled ? '_Signups are closed._' : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .setFooter({ text: `${raid.id} · ${FOOTER}` });

  for (const role of ['tank', 'healer', 'melee', 'ranged']) {
    const group = roster[role];
    embed.addFields({
      name: `${ROLE_HEADINGS[role]} — ${group.length}`,
      value: group.length > 0 ? group.map(line).join('\n').slice(0, 1024) : '—',
      inline: true,
    });
  }

  if (roster.unknown.length > 0) {
    embed.addFields({
      name: `❔ Spec not set — ${roster.unknown.length}`,
      value: roster.unknown.map((entry) => `<@${entry.userId}>`).join(', ').slice(0, 1024),
    });
  }

  const extras = ['late', 'tentative', 'bench', 'no']
    .filter((status) => other[status].length > 0)
    .map(
      (status) =>
        `${STATUSES[status].emoji} **${STATUSES[status].label}** (${other[status].length}): ${other[status]
          .map((entry) => `<@${entry.userId}>`)
          .join(', ')}`,
    );

  if (extras.length > 0) {
    embed.addFields({ name: '​', value: extras.join('\n').slice(0, 1024) });
  }

  embed.addFields({
    name: 'Roster',
    value: `**${counts.confirmed}** signed up${counts.late > 0 ? ` · ${counts.late} late` : ''} — ${counts.tank} tank, ${counts.healer} healer, ${counts.melee} melee, ${counts.ranged} ranged`,
  });

  return embed;
}

export function buildRaidButtons(raid) {
  if (raid.cancelled) return [];

  const status = new ActionRowBuilder().addComponents(
    ...STATUS_KEYS.map((key) =>
      new ButtonBuilder()
        .setCustomId(customId(raid.id, `status`, key))
        .setLabel(STATUSES[key].label)
        .setEmoji(STATUSES[key].emoji)
        .setStyle(key === 'yes' ? ButtonStyle.Success : key === 'no' ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setDisabled(raid.closed),
    ),
  );

  const tools = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(raid.id, 'changespec'))
      .setLabel('Change spec')
      .setEmoji('🔧')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(raid.closed),
  );

  return [status, tools];
}

/**
 * Picking a spec takes two menus, not one: Discord allows 25 options per select
 * and there are 39 specs. Class first, then its specs.
 */
export function buildClassSelect(raidId, status) {
  const classes = [...specsByClass().keys()];

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId(raidId, 'class', status ?? 'none'))
      .setPlaceholder('Which class?')
      .addOptions(classes.map((className) => ({ label: className, value: className }))),
  );
}

export function buildSpecSelect(raidId, status, className) {
  const specs = SPECS.filter((spec) => spec.className === className);

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      // The status the member pressed rides along so the pick can be applied
      // in one go rather than making them press the button again.
      .setCustomId(customId(raidId, 'spec', status ?? 'none'))
      .setPlaceholder(`Which ${className} spec?`)
      .addOptions(
        specs.map((spec) => ({
          label: `${spec.name} ${spec.className}`,
          description: `${spec.role} · ${spec.stat}`,
          value: spec.key,
        })),
      ),
  );
}
