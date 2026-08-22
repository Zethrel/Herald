// The standing consumables board: one message the bot owns in a channel,
// saying what the people actually coming need to buy.
//
// It follows the roster, not the spec catalogue. All forty specs is a wall of
// text nobody reads to the bottom of; the eight specs signed up for Tuesday is
// a shopping list. Anyone wanting a spec that is not on it still has
// `/consumables spec`.
//
// The rendering half is pure -- raids and tier data in, an embed out -- so the
// layout and Discord's ceilings can be tested without a gateway. Only
// `syncBoard` touches Discord.

import { createHash } from 'node:crypto';

import { EmbedBuilder } from 'discord.js';

import { BRAND_COLOR, FOOTER } from '../branding.js';
import { ROSTER_STATUSES } from '../raids/model.js';
import { SLOT_LABELS } from './dataset.js';
import { discordTime } from '../raids/time.js';
import { mergeReports } from '../sources/compare.js';
import { resolveSpecConsumables } from './resolve.js';
import { specByKey } from '../game/specs.js';

// The four a raider actually has to buy. The optional slots -- health and mana
// potions, augment rune -- stay on `/consumables spec`: on a board they are the
// difference between a list people read and one they scroll past.
export const BOARD_SLOTS = ['flask', 'food', 'potion', 'oil'];

// Raid order, and the same icons the raid post uses. A board that sorts its
// people differently from the signup sheet above it makes two lists nobody can
// cross-reference.
export const ROLE_ORDER = ['tank', 'healer', 'melee', 'ranged'];

// One per slot, so a row survives being wrapped by a narrow client: the reader
// can still see where each item starts. Deliberately nothing weapon-shaped --
// the roles already own the swords and bows.
export const SLOT_ICONS = {
  flask: '\u{1F9EA}',
  food: '\u{1F356}',
  potion: '\u2697\uFE0F',
  oil: '\u{1F6E2}\uFE0F',
  healthPotion: '\u2764\uFE0F',
  manaPotion: '\u{1F537}',
  rune: '\u{1F4DC}',
};
export const ROLE_ICONS = { tank: '🛡️', healer: '💚', melee: '⚔️', ranged: '🏹' };

// Discord's own ceilings. Exceeding any one rejects the whole message, so the
// renderer trims to fit rather than finding out on a raid night.
export const LIMITS = { fields: 25, fieldName: 256, fieldValue: 1024, total: 6000, title: 256 };

// Held back from the character budget for the "Not shown" note.
const OMITTED_BUDGET = 260;

/** Raids still taking signups, soonest first. */
export function openRaids(config, now = Date.now()) {
  return Object.values(config?.raids ?? {})
    .filter((raid) => !raid.closed && !raid.cancelled)
    // A raid whose start time has passed is over in every sense that matters
    // here, whether or not anybody remembered to close it.
    .filter((raid) => !raid.startsAt || Date.parse(raid.startsAt) >= now)
    .sort((a, b) => (Date.parse(a.startsAt ?? 0) || 0) - (Date.parse(b.startsAt ?? 0) || 0));
}

/**
 * The specs on one raid's roster, one row each with how many people are
 * bringing it. Four fire mages need four times the flasks and exactly one line.
 */
export function rosterSpecs(raid, lookup = specByKey) {
  const counts = new Map();

  for (const signup of Object.values(raid?.signups ?? {})) {
    // The same statuses `/consumables shopping` buys for. The board and the
    // shopping list disagreeing about who is coming would be worse than either
    // being slightly conservative.
    if (!ROSTER_STATUSES.includes(signup.status)) continue;
    if (!signup.specKey) continue;

    const spec = lookup(signup.specKey);
    if (!spec) continue;

    counts.set(spec.key, { spec, count: (counts.get(spec.key)?.count ?? 0) + 1 });
  }

  return [...counts.values()].sort(
    (a, b) =>
      ROLE_ORDER.indexOf(a.spec.role) - ROLE_ORDER.indexOf(b.spec.role) ||
      a.spec.className.localeCompare(b.spec.className) ||
      a.spec.name.localeCompare(b.spec.name),
  );
}

/** What one slot says, or null when it says nothing worth a column. */
export function slotText(entry, { alternatives = false } = {}) {
  // `none` is an answer -- "there is no oil this tier" -- and an empty slot is
  // a question. Neither belongs on a compact row, but only the second is worth
  // chasing, and `/consumables tier` is what lists those.
  if (!entry || entry.none || !entry.item) return null;

  const other = alternatives && entry.alternatives?.[0] ? ` / ${entry.alternatives[0].name}` : '';
  return `${entry.item.name}${other}`;
}

/**
 * One spec's block: who is bringing it, then a line per consumable. Costs four
 * lines where one would do, and buys the thing a raid night actually wants --
 * nothing wraps, and the eye can run straight down the flask column.
 */
export function rosterBlock({ spec, count, resolved, slots, alternatives = false }) {
  const many = count > 1 ? ` ×${count}` : '';
  const lines = [`${ROLE_ICONS[spec.role] ?? '•'} **${spec.name} ${spec.className}**${many}`];

  for (const slot of slots) {
    const text = slotText(resolved.slots[slot], { alternatives });
    if (text) lines.push(`${SLOT_ICONS[slot] ?? '·'} ${text}`);
  }

  if (lines.length === 1) lines.push('_nothing recorded_');

  return lines;
}

/**
 * Slots every spec on the board answers the same way. One weapon oil for the
 * whole raid is the normal case, and repeating it on every row is the single
 * biggest source of noise -- those get hoisted into one line above the rosters.
 */
export function commonSlots(resolvedList, { alternatives = false } = {}) {
  const common = {};
  if (resolvedList.length === 0) return common;

  for (const slot of BOARD_SLOTS) {
    const texts = resolvedList.map((resolved) => slotText(resolved.slots[slot], { alternatives }));
    const answered = texts.filter(Boolean);
    const distinct = new Set(answered);

    // One answer between all of them, or it belongs on the rows.
    if (distinct.size !== 1) continue;
    // A blank or two is a gap in the tier file rather than a real difference,
    // so it does not block the hoist -- but a slot only half the raid has an
    // answer for is not a raid-wide statement, and stays on the rows.
    if (answered.length < Math.max(2, Math.ceil(resolvedList.length / 2))) continue;

    const [only] = distinct;
    // Said out loud, because "everyone" when two specs have nothing recorded
    // would be the board claiming more than the data does.
    common[slot] = { text: only, all: answered.length === texts.length };
  }

  return common;
}

/**
 * Lines into fields, splitting a roster too long for one field across several
 * rather than dropping people off the end of it.
 */
export function spill(name, blocks, budget = LIMITS.fieldValue) {
  const fields = [];
  let current = [];
  let length = 0;

  const label = () => (fields.length === 0 ? name : '\u2937').slice(0, LIMITS.fieldName);
  const push = () => fields.push({ name: label(), value: current.join('\n\n').slice(0, budget) || '\u2014' });

  for (const block of blocks) {
    const text = block.join('\n');

    // A block is one spec and its consumables. Splitting one across two fields
    // would put a flask under somebody else's name, so a block that does not
    // fit starts the next field instead.
    if (current.length > 0 && length + text.length + 2 > budget) {
      push();
      current = [];
      length = 0;
    }

    current.push(text);
    length += text.length + 2;
  }

  push();

  return fields;
}

export function buildBoardEmbed({ dataset, overrides = {}, reports = null, config = {}, now = Date.now() }) {
  const rosters = openRaids(config, now).map((raid) => ({
    raid,
    rows: rosterSpecs(raid).map((entry) => ({
      ...entry,
      resolved: resolveSpecConsumables({ spec: entry.spec, dataset, overrides, reports }),
    })),
  }));

  return assemble({ rosters, dataset });
}

function assemble({ rosters, dataset, alternatives = false }) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`Raid consumables — ${dataset.tier?.name ?? 'current tier'}`.slice(0, LIMITS.title))
    .setFooter({ text: FOOTER });

  const everyone = rosters.flatMap(({ rows }) => rows.map((row) => row.resolved));

  if (everyone.length === 0) {
    embed.setDescription(
      [
        '_Nothing is signed up right now._',
        '',
        'This fills in by itself as people sign up to an open raid. Start one with `/raid create`,',
        'or look a single spec up any time with `/consumables spec`.',
      ].join('\n'),
    );

    return embed;
  }

  const common = commonSlots(everyone, { alternatives });
  const rowSlots = BOARD_SLOTS.filter((slot) => !(slot in common));

  const shared = Object.entries(common).filter(([, entry]) => entry.all);
  const mostly = Object.entries(common).filter(([, entry]) => !entry.all);

  embed.setDescription(
    [
      shared.length > 0 ? `**Everyone** — ${slotSummary(shared)}` : null,
      mostly.length > 0 ? `**Most specs** — ${slotSummary(mostly)}` : null,
      // Every icon that appears anywhere above or below, named once.
      `_${legend(BOARD_SLOTS.filter((slot) => slot in common || rowSlots.includes(slot)))} · ×N how many are bringing it_`,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  // Every raid rendered first, then as many as fit. Soonest first, because the
  // raid people are shopping for tonight matters more than the alt run on
  // Sunday -- and a message over any of Discord's ceilings is not delivered at
  // all, so something has to give.
  const groups = rosters.map(({ raid, rows }) => {
    const when = raid.startsAt
      ? `${discordTime(new Date(raid.startsAt), 'F')} · ${discordTime(new Date(raid.startsAt), 'R')}`
      : null;

    const blocks = [
      when ? [when] : null,
      ...rows.map((row) => rosterBlock({ ...row, slots: rowSlots, alternatives })),
    ].filter(Boolean);

    if (rows.length === 0) blocks.push(['_Nobody signed up yet._']);

    return { raid, fields: spill(raid.title ?? raid.id, blocks) };
  });

  const omitted = [];
  let size = embedSize(embed);
  let count = 0;

  for (const group of groups) {
    const cost = group.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);

    // One field and a couple of hundred characters held back for the note that
    // says what was left out. A board that silently drops a raid is worse than
    // one that admits it could not fit it.
    if (count + group.fields.length > LIMITS.fields - 1 || size + cost > LIMITS.total - OMITTED_BUDGET) {
      omitted.push(group.raid.title ?? group.raid.id);
      continue;
    }

    for (const field of group.fields) embed.addFields(field);
    size += cost;
    count += group.fields.length;
  }

  if (omitted.length > 0) {
    embed.addFields({
      name: 'Not shown',
      value: `${omitted.join(', ')} — too much for one message. Close the raids that are done, or ask for one at a time with \`/consumables shopping raid:…\`.`.slice(
        0,
        LIMITS.fieldValue,
      ),
    });
  }

  return embed;
}

function slotSummary(entries) {
  return entries.map(([slot, entry]) => `${SLOT_ICONS[slot] ?? ''} ${entry.text}`.trim()).join(' · ');
}

/** What the icons mean, for whoever has not seen the board before. */
function legend(slots) {
  return slots.map((slot) => `${SLOT_ICONS[slot] ?? ''} ${SLOT_LABELS[slot].toLowerCase()}`.trim()).join(' · ');
}

/** Total characters Discord counts against the 6000 ceiling. */
export function embedSize(embed) {
  const data = embed.toJSON ? embed.toJSON() : embed;

  return (
    (data.title?.length ?? 0) +
    (data.description?.length ?? 0) +
    (data.footer?.text?.length ?? 0) +
    (data.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
  );
}

/**
 * A stable fingerprint of what the board says. Kept in the store so an
 * interaction that changed nothing the board shows -- `/consumables spec`, a
 * fifth mage joining a raid that already had four -- does not spend an edit.
 */
export function boardHash(embed) {
  const data = embed.toJSON ? embed.toJSON() : embed;
  return createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

/** Render the board from a guild's current state, without touching Discord. */
export async function renderBoard(guildId, { store, dataset }) {
  const config = await store.get(guildId);

  return {
    config,
    embed: buildBoardEmbed({
      dataset,
      config,
      overrides: config.consumables?.overrides ?? {},
      reports: mergeReports(dataset.reports, config.consumables?.reports),
    }),
  };
}

/**
 * Bring the posted board in line with the data. Safe to call after anything:
 * it returns early when this server has no board, and when nothing it shows
 * has changed.
 *
 * Never throws. A board that cannot be edited must not take down the command
 * that changed the data.
 */
export async function syncBoard(guildId, { client, store, dataset, log }, { force = false } = {}) {
  const { config, embed } = await renderBoard(guildId, { store, dataset });
  const board = config.consumables?.board;
  if (!board?.channelId || !board?.messageId) return { status: 'none' };

  const hash = boardHash(embed);
  if (!force && hash === board.hash) return { status: 'unchanged' };

  try {
    const channel = await client.channels.fetch(board.channelId);
    const message = await channel.messages.fetch(board.messageId);
    await message.edit({ embeds: [embed] });
    await store.update(guildId, { consumables: { board: { ...board, hash } } });
    return { status: 'edited' };
  } catch (error) {
    // 10008 Unknown Message, 10003 Unknown Channel: somebody deleted it. Forget
    // it rather than retrying on every interaction for the rest of time.
    if (error.code === 10008 || error.code === 10003) {
      await store.update(guildId, {
        consumables: { board: { channelId: null, messageId: null, hash: null } },
      });
      log?.warn(`Consumables board in ${guildId} is gone — forgetting it. Re-post with /consumables board post.`);
      return { status: 'gone' };
    }

    log?.warn(`Could not edit the consumables board in ${guildId}: ${error.message}`);
    return { status: 'failed', error };
  }
}
