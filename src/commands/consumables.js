import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { BRAND_COLOR, FOOTER } from '../branding.js';
import { SLOTS, SLOT_LABELS, coverage, isStale } from '../consumables/dataset.js';
import { SPECS, SPEC_KEYS, findSpec, specByKey } from '../game/specs.js';
import { DEFAULT_PER_RAIDER, buildShoppingList, parseRoster } from '../consumables/shopping.js';
import { gaps, resolveSpecConsumables } from '../consumables/resolve.js';

export const data = new SlashCommandBuilder()
  .setName('consumables')
  .setDescription('Flasks, food and potions for the current tier')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((sub) =>
    sub
      .setName('spec')
      .setDescription('What one spec should be carrying')
      .addStringOption((option) =>
        option
          .setName('spec')
          .setDescription('e.g. fire mage, boomkin, prot warr')
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('shopping')
      .setDescription('Roll a roster up into consumables and the reagents to craft them')
      .addStringOption((option) =>
        option
          .setName('roster')
          .setDescription('e.g. 4x fire mage, 2 holy priest, 3 prot warr')
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option.setName('flasks').setDescription(`Flasks per raider (default ${DEFAULT_PER_RAIDER.flask})`).setMinValue(0),
      )
      .addIntegerOption((option) =>
        option.setName('food').setDescription(`Food per raider (default ${DEFAULT_PER_RAIDER.food})`).setMinValue(0),
      )
      .addIntegerOption((option) =>
        option
          .setName('potions')
          .setDescription(`Combat potions per raider (default ${DEFAULT_PER_RAIDER.potion})`)
          .setMinValue(0),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('tier').setDescription('Which tier the data is for, how complete it is, and where it came from'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Override one slot for one spec on this server (Manage Server)')
      .addStringOption((option) =>
        option.setName('spec').setDescription('Which spec').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('slot')
          .setDescription('Which consumable')
          .setRequired(true)
          .addChoices(...SLOTS.map((slot) => ({ name: SLOT_LABELS[slot], value: slot }))),
      )
      .addStringOption((option) =>
        option.setName('item').setDescription('Item name, or a slug from the tier file').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('source').setDescription('Where this came from — a link, a sim, a name'),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('clear')
      .setDescription("Drop this server's override for a spec (Manage Server)")
      .addStringOption((option) =>
        option.setName('spec').setDescription('Which spec').setRequired(true).setAutocomplete(true),
      ),
  );

/** Type-ahead over the spec catalogue, matched the same way the parser matches. */
export async function autocomplete(interaction) {
  const typed = interaction.options.getFocused().toLowerCase();
  const matches = SPECS.filter((spec) => {
    const haystack = [`${spec.name} ${spec.className}`, spec.key, ...spec.aliases].join(' ').toLowerCase();
    return haystack.includes(typed);
  }).slice(0, 25);

  await interaction.respond(
    matches.map((spec) => ({ name: `${spec.name} ${spec.className}`, value: spec.key })),
  );
}

export async function execute(interaction, { store, dataset, log }) {
  const sub = interaction.options.getSubcommand();
  const config = await store.get(interaction.guildId);
  const overrides = config.consumables?.overrides ?? {};

  if (sub === 'tier') return showTier(interaction, { dataset, overrides });
  if (sub === 'shopping') return showShopping(interaction, { dataset, overrides });

  const spec = resolveSpecOption(interaction.options.getString('spec'));
  if (!spec) {
    return interaction.reply({
      content:
        'I could not tell which spec that is. Pick one from the suggestions, or write it as "fire mage" / "resto druid".',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'spec') return showSpec(interaction, { spec, dataset, overrides });

  // set / clear both change the server's data, so they need Manage Server.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: 'Changing what the raid is told to bring is a Manage Server job.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'clear') {
    // `overrides` is two levels down, and mergeConfig only merges one, so this
    // patch replaces the map wholesale -- which is what makes a removal stick.
    const next = { ...overrides };
    delete next[spec.key];
    await store.update(interaction.guildId, { consumables: { overrides: next } });

    return interaction.reply({
      content: `Dropped this server's override for **${spec.name} ${spec.className}**. It falls back to the tier file again.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // set
  const slot = interaction.options.getString('slot');
  const item = interaction.options.getString('item').trim();
  const source = interaction.options.getString('source');

  const next = {
    ...overrides,
    [spec.key]: {
      ...(overrides[spec.key] ?? {}),
      [slot]: item,
      source: source ?? overrides[spec.key]?.source ?? null,
      updatedAt: new Date().toISOString(),
      setBy: interaction.user.id,
    },
  };

  await store.update(interaction.guildId, { consumables: { overrides: next } });
  log.info(`${interaction.user.tag} set ${spec.key}.${slot} = ${item}`);

  return interaction.reply({
    content: `**${spec.name} ${spec.className}** — ${SLOT_LABELS[slot]} is now **${item}** on this server.${
      source ? '' : ' No source recorded; add one with the `source` option so the raid can check it.'
    }`,
    flags: MessageFlags.Ephemeral,
  });
}

function resolveSpecOption(value) {
  return specByKey(value) ?? findSpec(value);
}

function renderSlots(resolved) {
  return SLOTS.map((slot) => {
    const { item, via } = resolved.slots[slot];
    if (!item) return `**${SLOT_LABELS[slot]}** — _not set for this tier_`;

    const link = item.itemId
      ? ` ([wowhead](https://www.wowhead.com/item=${item.itemId}))`
      : '';
    // Say when an answer is a class-wide default rather than this spec's own,
    // because that is exactly the case where a raider should double-check.
    const note = via && via.startsWith('default:') ? ` _(${via.replace('default:', '')} default)_` : '';
    const mine = via === 'guild' ? ' _(this server)_' : '';
    return `**${SLOT_LABELS[slot]}** — ${item.name}${link}${note}${mine}`;
  }).join('\n');
}

function tierLine(dataset) {
  const { name, patch } = dataset.tier;
  if (!name && !patch) return 'no tier recorded';
  return [name, patch].filter(Boolean).join(' · ');
}

function staleWarning(dataset) {
  if (!isStale(dataset)) return null;
  return dataset.updatedAt
    ? `⚠️ This data was last updated <t:${Math.floor(Date.parse(dataset.updatedAt) / 1000)}:R> — check it before the raid.`
    : '⚠️ Nothing here has been dated, so treat it as unverified.';
}

function showSpec(interaction, { spec, dataset, overrides }) {
  const resolved = resolveSpecConsumables({ spec, dataset, overrides });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${spec.name} ${spec.className}`)
    .setDescription(renderSlots(resolved))
    .addFields({
      name: 'Tier',
      value: `${tierLine(dataset)}${resolved.source ? `\nSource: ${resolved.source}` : ''}`,
    })
    .setFooter({ text: FOOTER });

  if (resolved.note) embed.addFields({ name: 'Note', value: resolved.note });

  const warning = staleWarning(dataset);
  if (warning) embed.addFields({ name: '​', value: warning });

  if (!resolved.complete) {
    embed.addFields({
      name: 'Missing entries',
      value:
        'An officer can fill these in with `/consumables set`. Herald will not guess at a consumable it has not been told about.',
    });
  }

  return interaction.reply({ embeds: [embed] });
}

function showTier(interaction, { dataset, overrides }) {
  const stats = coverage(dataset, SPEC_KEYS);
  const missing = gaps({ specs: SPECS, dataset, overrides });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`Consumables — ${tierLine(dataset)}`)
    .addFields(
      {
        name: 'Coverage',
        value: [
          `**${stats.filled}/${stats.total}** specs have an entry of their own.`,
          `**${SPECS.length - missing.length}/${SPECS.length}** specs resolve to a full set once defaults and this server's overrides are applied.`,
          `Overrides on this server: **${Object.keys(overrides).length}**`,
        ].join('\n'),
      },
      {
        name: 'Last updated',
        value: dataset.updatedAt
          ? `<t:${Math.floor(Date.parse(dataset.updatedAt) / 1000)}:D>`
          : '_never — nothing in the tier file has been dated_',
      },
    )
    .setFooter({ text: FOOTER });

  if (dataset.sources?.length > 0) {
    embed.addFields({ name: 'Sources', value: dataset.sources.map((source) => `• ${source}`).join('\n') });
  }

  if (missing.length > 0) {
    const listed = missing
      .slice(0, 12)
      .map((entry) => `${entry.spec.name} ${entry.spec.className} — ${entry.slots.join(', ')}`)
      .join('\n');
    embed.addFields({
      name: `Still unanswered (${missing.length})`,
      value: `${listed}${missing.length > 12 ? `\n…and ${missing.length - 12} more` : ''}`,
    });
  }

  const warning = staleWarning(dataset);
  if (warning) embed.addFields({ name: '​', value: warning });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

function showShopping(interaction, { dataset, overrides }) {
  const { entries, unknown } = parseRoster(interaction.options.getString('roster'), { findSpec });

  if (entries.length === 0) {
    return interaction.reply({
      content: `Nothing in that roster matched a spec${unknown.length > 0 ? `: ${unknown.join(', ')}` : ''}. Try "4x fire mage, 2 holy priest".`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const perRaider = {
    flask: interaction.options.getInteger('flasks') ?? DEFAULT_PER_RAIDER.flask,
    food: interaction.options.getInteger('food') ?? DEFAULT_PER_RAIDER.food,
    potion: interaction.options.getInteger('potions') ?? DEFAULT_PER_RAIDER.potion,
  };

  const list = buildShoppingList({ roster: entries, dataset, overrides, perRaider });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`Shopping list — ${list.raiders} raider(s)`)
    .setDescription(
      `Per raider: ${perRaider.flask} flask · ${perRaider.food} food · ${perRaider.potion} potions`,
    )
    .setFooter({ text: FOOTER });

  embed.addFields({
    name: 'Consumables',
    value:
      list.consumables.map((entry) => `**${entry.quantity}×** ${entry.name}`).join('\n') ||
      '_nothing — the tier file has no entries for these specs yet_',
  });

  if (list.crafts.length > 0) {
    embed.addFields({
      name: 'Crafts',
      value: list.crafts
        .map(
          (entry) =>
            `**${entry.crafts}×** ${entry.name}${entry.yield > 1 ? ` (yields ${entry.yield}${entry.surplus > 0 ? `, ${entry.surplus} spare` : ''})` : ''}`,
        )
        .join('\n'),
    });
  }

  if (list.reagents.length > 0) {
    embed.addFields({
      name: 'Reagents to gather',
      value: list.reagents.map((entry) => `**${entry.quantity}×** ${entry.name}`).join('\n').slice(0, 1024),
    });
  }

  if (list.buy.length > 0) {
    embed.addFields({
      name: 'No recipe on file',
      value: `${list.buy.map((entry) => `**${entry.quantity}×** ${entry.name}`).join('\n')}\n_Buy these, or add a recipe to the tier file._`.slice(0, 1024),
    });
  }

  if (list.missingSlots.length > 0) {
    embed.addFields({
      name: '⚠️ Not counted',
      value: list.missingSlots
        .map((entry) => `${entry.spec.name} ${entry.spec.className} — no ${entry.slots.join(', ')}`)
        .join('\n')
        .slice(0, 1024),
    });
  }

  if (unknown.length > 0) {
    embed.addFields({ name: 'Not understood', value: unknown.join(', ') });
  }

  return interaction.reply({ embeds: [embed] });
}
