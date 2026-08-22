import {
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';

import { BRAND_COLOR, FOOTER } from '../branding.js';
import {
  REQUIRED_SLOTS,
  SECONDARY_ALIASES,
  SECONDARY_STATS,
  SLOTS,
  SLOT_LABELS,
  coverage,
  isStale,
} from '../consumables/dataset.js';
import { SPECS, SPEC_KEYS, findSpec, specByKey } from '../game/specs.js';
import { DEFAULT_PER_RAIDER, buildShoppingList, parseRoster } from '../consumables/shopping.js';
import { formatMoney, priceLines } from '../prices/auctions.js';
import { gaps, resolveSpecConsumables } from '../consumables/resolve.js';
import { getRaid, listRaids } from '../raids/repository.js';
import { rosterForShopping } from '../raids/model.js';
import { SOURCES, sourceName } from '../sources/registry.js';
import { compareSpec, disagreements, mergeReports } from '../sources/compare.js';
import { guideUrl, isConfirmed } from '../sources/urls.js';

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
      .setName('compare')
      .setDescription('What each guide says, side by side')
      .addStringOption((option) =>
        option
          .setName('spec')
          .setDescription('Leave empty to list the specs the guides disagree on')
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('report')
      .setDescription("Record what one guide says for a spec (Manage Server)")
      .addStringOption((option) =>
        option
          .setName('source')
          .setDescription('Which guide')
          .setRequired(true)
          .addChoices(...SOURCES.map((source) => ({ name: source.name, value: source.id }))),
      )
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
        option.setName('item').setDescription('What that guide recommends').setRequired(true),
      )
      .addStringOption((option) =>
        option.setName('url').setDescription('The page you read it on — kept as the attribution'),
      ),
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
      .setName('secondary')
      .setDescription("Record which secondary stat a spec stacks — this is what picks its flask (Manage Server)")
      .addStringOption((option) =>
        option.setName('spec').setDescription('Which spec').setRequired(true).setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('stat')
          .setDescription('crit, haste, mastery, versatility — or two, as "crit|haste"')
          .setRequired(true),
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
  const reports = mergeReports(dataset.reports, config.consumables?.reports);

  if (sub === 'tier') return showTier(interaction, { dataset, overrides, reports });
  if (sub === 'shopping') return showShopping(interaction, { dataset, overrides, prices, store, reports });
  if (sub === 'compare') return showCompare(interaction, { dataset, reports });

  const spec = resolveSpecOption(interaction.options.getString('spec'));
  if (!spec) {
    return interaction.reply({
      content:
        'I could not tell which spec that is. Pick one from the suggestions, or write it as "fire mage" / "resto druid".',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'spec') return showSpec(interaction, { spec, dataset, overrides, reports });

  // set, clear and report all change the server's data, so they need Manage Server.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({
      content: 'Changing what the raid is told to bring is a Manage Server job.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'secondary') {
    const typed = interaction.options.getString('stat');
    const parsed = parseSecondaryOption(typed);

    if (!parsed) {
      return interaction.reply({
        content: `I do not know the stat "${typed}". Use ${SECONDARY_STATS.join(', ')} — or two of them, written as \`crit|haste\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const next = {
      ...overrides,
      [spec.key]: {
        ...(overrides[spec.key] ?? {}),
        secondary: parsed.length === 1 ? parsed[0] : parsed,
        updatedAt: new Date().toISOString(),
        setBy: interaction.user.id,
      },
    };

    await store.update(interaction.guildId, { consumables: { overrides: next } });
    log.info(`${interaction.user.tag} set ${spec.key} secondary = ${parsed.join('|')}`);

    const resolved = resolveSpecConsumables({ spec, dataset, overrides: next, reports });
    const flask = resolved.slots.flask;

    return interaction.reply({
      content: [
        `**${spec.name} ${spec.className}** now stacks **${parsed.join(' or ')}**.`,
        flask.item
          ? `Flask: **${flask.item.name}**${flask.alternatives.length > 0 ? ` or ${flask.alternatives.map((entry) => entry.name).join(', ')}` : ''}.`
          : 'No flask is recorded for that stat yet — add one to the tier file.',
      ].join('\n'),
      flags: MessageFlags.Ephemeral,
    });
  }

  if (sub === 'report') {
    const sourceId = interaction.options.getString('source');
    const slot = interaction.options.getString('slot');
    const item = interaction.options.getString('item').trim();
    const url = interaction.options.getString('url');

    const existing = config.consumables?.reports ?? {};
    const forSource = existing[sourceId] ?? { specs: {} };

    const next = {
      ...existing,
      [sourceId]: {
        ...forSource,
        specs: {
          ...(forSource.specs ?? {}),
          [spec.key]: {
            ...(forSource.specs?.[spec.key] ?? {}),
            [slot]: item,
            url: url ?? forSource.specs?.[spec.key]?.url ?? null,
            fetchedAt: new Date().toISOString(),
            recordedBy: interaction.user.id,
          },
        },
      },
    };

    await store.update(interaction.guildId, { consumables: { reports: next } });
    log.info(`${interaction.user.tag} recorded ${sourceId} ${spec.key}.${slot} = ${item}`);

    return interaction.reply({
      content: `Recorded: **${sourceName(sourceId)}** says **${spec.name} ${spec.className}** takes **${item}** for ${SLOT_LABELS[slot].toLowerCase()}. See how it compares with \`/consumables compare spec:${spec.name} ${spec.className}\`.`,
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

/** "crit", "Critical Strike", or "crit|haste" for a spec that runs either. */
function parseSecondaryOption(text) {
  const parts = (text ?? '')
    .split(/\s*[|/,]\s*/)
    .map((part) => SECONDARY_ALIASES[part.trim().toLowerCase()])
    .filter(Boolean);

  const unique = [...new Set(parts)];
  return unique.length > 0 && unique.length === (text ?? '').split(/\s*[|/,]\s*/).filter(Boolean).length
    ? unique
    : null;
}

function renderSlots(resolved) {
  return SLOTS.map((slot) => {
    const { item, via, alternatives, none } = resolved.slots[slot];

    // Three different states, and conflating them is how a raider ends up
    // hunting for something that does not exist.
    if (none) return `**${SLOT_LABELS[slot]}** — _none this tier_`;
    if (!item) {
      // An unanswered optional slot is left out rather than announced: a melee
      // spec has no mana potion and never will, and a line saying so on every
      // reply is noise, not information.
      if (!REQUIRED_SLOTS.includes(slot)) return null;
      return `**${SLOT_LABELS[slot]}** — _not set for this tier_`;
    }

    const link = item.itemId
      ? ` ([wowhead](https://www.wowhead.com/item=${item.itemId}))`
      : '';
    // Say when an answer is a class-wide default rather than this spec's own,
    // because that is exactly the case where a raider should double-check.
    const note = via && via.startsWith('default:') ? ` _(${via.replace('default:', '')} default)_` : '';
    const mine = via === 'guild' ? ' _(this server)_' : '';
    // Naming the guides matters more than saying "sources": a raider can go and
    // read them, and can see when only one of the three has an opinion.
    const guides =
      via === 'sources'
        ? ` _(${resolved.slots[slot].sourceIds.map(sourceName).join(', ')}${
            resolved.slots[slot].agreement === 'majority' ? ', majority' : ''
          })_`
        : '';
    // "or" rather than a second line: they are equally fine, not a fallback.
    const others =
      alternatives?.length > 0 ? ` _or ${alternatives.map((entry) => entry.name).join(', ')}_` : '';

    return `**${SLOT_LABELS[slot]}** — ${item.name}${link}${others}${note}${mine}${guides}`;
  })
    .filter(Boolean)
    .join('\n');
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

const AGREEMENT_LABELS = {
  unanimous: '✅ all agree',
  majority: '➗ majority',
  split: '⚠️ they disagree',
  single: 'ℹ️ only one source',
  none: '—',
};

function showCompare(interaction, { dataset, reports }) {
  const requested = interaction.options.getString('spec');

  if (!requested) {
    const split = disagreements({ dataset, specs: SPECS, reports });
    const recorded = Object.keys(reports).length;

    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle('Where the guides disagree')
      .setDescription(
        recorded === 0
          ? 'No guide recommendations have been recorded yet. An officer can add them with `/consumables report`.'
          : split.length === 0
            ? `**${recorded}** source(s) recorded, and they agree everywhere they overlap.`
            : split
                .slice(0, 20)
                .map((entry) => `**${entry.spec.name} ${entry.spec.className}** — ${entry.slots.join(', ')}`)
                .join('\n'),
      )
      .setFooter({ text: FOOTER });

    if (split.length > 20) {
      embed.addFields({ name: '​', value: `…and ${split.length - 20} more` });
    }

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const spec = resolveSpecOption(requested);
  if (!spec) {
    return interaction.reply({
      content: 'I could not tell which spec that is.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const { slots, sources } = compareSpec({ dataset, spec, reports });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${spec.name} ${spec.className} — what the guides say`)
    .setFooter({ text: FOOTER });

  // The pages themselves, whether or not anyone has recorded an answer from
  // them. Useful on its own: it saves a raider working out the URL.
  const links = SOURCES.filter((source) => !source.local)
    .map((source) => {
      const url = guideUrl(source.id, spec);
      if (!url) return `${source.name}: _no link on file_`;
      return `[${source.name}](${url})${isConfirmed(source.id, spec) ? '' : ' _(unverified link)_'}`;
    })
    .join(' · ');

  if (sources.length === 0) {
    embed.setDescription(
      [
        'Nothing recorded for this spec yet. An officer can add what a guide says with `/consumables report`.',
        '',
        links,
      ].join('\n'),
    );
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  embed.setDescription(links);

  for (const slot of SLOTS) {
    const { opinions, agreement } = slots[slot];

    // Same rule as the lookup: an optional slot nobody has an opinion on does
    // not earn a field saying so.
    if (opinions.length === 0 && !REQUIRED_SLOTS.includes(slot)) continue;

    embed.addFields({
      name: `${SLOT_LABELS[slot]} — ${AGREEMENT_LABELS[agreement]}`,
      value:
        opinions.length === 0
          ? '_nobody has said_'
          : opinions
              .map((opinion) => {
                const href = opinion.url ?? guideUrl(opinion.sourceId, spec);
                const link = href ? ` ([source](${href}))` : '';
                const age = opinion.fetchedAt
                  ? ` · <t:${Math.floor(Date.parse(opinion.fetchedAt) / 1000)}:R>`
                  : '';
                return `**${opinion.name}**: ${opinion.item.name}${link}${age}`;
              })
              .join('\n')
              .slice(0, 1024),
    });
  }

  embed.addFields({
    name: '​',
    value:
      `Where they disagree ${FOOTER} picks nothing and falls back to the tier file — a split means the choice is close, or one guide is stale.`,
  });

  return interaction.reply({ embeds: [embed] });
}

function showSpec(interaction, { spec, dataset, overrides, reports }) {
  const resolved = resolveSpecConsumables({ spec, dataset, overrides, reports });

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`${spec.name} ${spec.className}`)
    .setDescription(
      [
        resolved.secondary.length > 0
          ? `_Stacking ${resolved.secondary.join(' or ')}_`
          : '_No stat priority recorded — that is what picks the flask._',
        '',
        renderSlots(resolved),
      ].join('\n'),
    )
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
        `An officer can fill these in with \`/consumables set\`. ${FOOTER} will not guess at a consumable it has not been told about.`,
    });
  }

  return interaction.reply({ embeds: [embed] });
}

function showTier(interaction, { dataset, overrides, reports }) {
  const stats = coverage(dataset, SPEC_KEYS);
  const missing = gaps({ specs: SPECS, dataset, overrides, reports });

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

async function showShopping(interaction, { dataset, overrides, prices, store, reports }) {
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

  const list = buildShoppingList({ roster: entries, dataset, overrides, perRaider, reports });

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

  const unstated = list.missingSlots.filter((entry) => entry.noSecondary);
  const otherGaps = list.missingSlots.filter((entry) => !entry.noSecondary);

  if (unstated.length > 0) {
    // The common case, and the actionable one: the roster brought a spec whose
    // stat priority nobody has written down, so it has no flask to buy.
    embed.addFields({
      name: `⚠️ No stat priority recorded (${unstated.length})`,
      value: [
        unstated.map((entry) => `${entry.spec.name} ${entry.spec.className}`).join(', '),
        '',
        `Fix with \`/consumables secondary spec:${unstated[0].spec.name} ${unstated[0].spec.className} stat:crit\` — then re-run this.`,
      ]
        .join('\n')
        .slice(0, 1024),
    });
  }

  if (otherGaps.length > 0) {
    embed.addFields({
      name: '⚠️ Not counted',
      value: otherGaps
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
