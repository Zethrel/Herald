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
import { formatMoney, priceLines } from '../prices/auctions.js';
import { gaps, resolveSpecConsumables } from '../consumables/resolve.js';
import { getRaid, listRaids } from '../raids/repository.js';
import { rosterForShopping } from '../raids/model.js';

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
        option.setName('roster').setDescription('e.g. 4x fire mage, 2 holy priest, 3 prot warr'),
      )
      .addStringOption((option) =>
        option
          .setName('raid')
          .setDescription('Or take the roster from a raid signup')
          .setAutocomplete(true),
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

/** Type-ahead over the spec catalogue, or over this server's raids. */
export async function autocomplete(interaction, { store }) {
  const focused = interaction.options.getFocused(true);
  const typed = (focused.value ?? '').toLowerCase();

  if (focused.name === 'raid') {
    const raids = await listRaids(store, interaction.guildId);
    return interaction.respond(
      raids
        .filter((raid) => !raid.cancelled && `${raid.id} ${raid.title}`.toLowerCase().includes(typed))
        .slice(0, 25)
        .map((raid) => ({
          name: `${raid.title} — ${Object.values(raid.signups ?? {}).filter((signup) => signup.status === 'yes').length} signed up`.slice(0, 100),
          value: raid.id,
        })),
    );
  }

  const matches = SPECS.filter((spec) => {
    const haystack = [`${spec.name} ${spec.className}`, spec.key, ...spec.aliases].join(' ').toLowerCase();
    return haystack.includes(typed);
  }).slice(0, 25);

  await interaction.respond(
    matches.map((spec) => ({ name: `${spec.name} ${spec.className}`, value: spec.key })),
  );
}

export async function execute(interaction, { store, dataset, prices, log }) {
  const sub = interaction.options.getSubcommand();
  const config = await store.get(interaction.guildId);
  const overrides = config.consumables?.overrides ?? {};

  if (sub === 'tier') return showTier(interaction, { dataset, overrides });
  if (sub === 'shopping') return showShopping(interaction, { dataset, overrides, prices, store });

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

async function showShopping(interaction, { dataset, overrides, prices, store }) {
  const raidId = interaction.options.getString('raid');
  const rosterText = interaction.options.getString('roster');

  if (!raidId && !rosterText) {
    return interaction.reply({
      content: 'Give me a `roster` to read, or a `raid` to take one from.',
      flags: MessageFlags.Ephemeral,
    });
  }

  let entries = [];
  let unknown = [];
  let source = null;

  if (raidId) {
    const raid = await getRaid(store, interaction.guildId, raidId);
    if (!raid) {
      return interaction.reply({ content: 'No such raid.', flags: MessageFlags.Ephemeral });
    }

    const fromRaid = rosterForShopping(raid);
    entries = fromRaid.roster;
    // Signed up but never told the bot what they play: they need consumables
    // too, and saying so is more use than quietly under-counting.
    unknown = fromRaid.unknown.map((userId) => `<@${userId}> (no spec set)`);
    source = raid;
  } else {
    const parsed = parseRoster(rosterText, { findSpec });
    entries = parsed.entries;
    unknown = parsed.unknown;
  }

  if (entries.length === 0) {
    return interaction.reply({
      content: raidId
        ? 'Nobody on that raid has signed up with a spec yet.'
        : `Nothing in that roster matched a spec${unknown.length > 0 ? `: ${unknown.join(', ')}` : ''}. Try "4x fire mage, 2 holy priest".`,
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
      [
        source ? `From **${source.title}** (\`${source.id}\`)` : null,
        `Per raider: ${perRaider.flask} flask · ${perRaider.food} food · ${perRaider.potion} potions`,
      ]
        .filter(Boolean)
        .join('\n'),
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

  // Everything above is arithmetic on the tier file and answers instantly.
  // Pricing may have to pull the commodity feed, so the reply is deferred only
  // when prices are actually going to be attempted.
  const shoppable = [...list.reagents, ...list.buy];
  if (!prices?.available || shoppable.length === 0) {
    return interaction.reply({ embeds: [embed] });
  }

  await interaction.deferReply();
  await addPrices(embed, { list: shoppable, dataset, prices });
  return interaction.editReply({ embeds: [embed] });
}

async function addPrices(embed, { list, dataset, prices }) {
  const itemIds = list.map((line) => (line.slug ? dataset.items?.[line.slug]?.itemId : null)).filter(Boolean);
  const snapshot = await prices.prices(itemIds);
  if (!snapshot) return;

  const { priced, unpriced, total, complete } = priceLines({ lines: list, dataset, books: snapshot.books });
  if (priced.length === 0) return;

  const top = priced
    .slice(0, 8)
    .map(
      (line) =>
        `${formatMoney(line.total)} — **${line.quantity}×** ${line.name}${
          line.short > 0 ? ` _(only ${line.available} listed)_` : ''
        }`,
    )
    .join('\n');

  embed.addFields({
    name: complete ? 'Cost at current prices' : 'Cost at current prices (partial)',
    value: [
      `**${formatMoney(total)}**${complete ? '' : ' — at least; see below'}`,
      '',
      top,
      priced.length > 8 ? `…and ${priced.length - 8} more` : '',
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1024),
  });

  const caveats = [];
  if (unpriced.length > 0) {
    caveats.push(`Not priced: ${unpriced.map((line) => line.name).join(', ')}`);
  }
  if (priced.some((line) => line.short > 0)) {
    caveats.push('Some items are not listed in the quantity you need — the total is a floor.');
  }

  embed.addFields({
    name: 'Prices',
    value: [
      `Region-wide commodities, snapshot **${snapshot.age.text}**.`,
      'Blizzard regenerates this hourly at 20 past, so it will not move before then.',
      ...caveats,
    ].join('\n'),
  });
}
