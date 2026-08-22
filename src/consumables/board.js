// The standing consumables board: one message the bot owns in a channel,
// listing every spec's consumables and marking the ones signed up to an open
// raid. It is edited in place, so the channel keeps one authoritative post
// rather than a scroll of increasingly wrong ones.
//
// The rendering half is pure -- specs and data in, an embed out -- so the
// layout and Discord's size limits can be tested without a gateway. Only
// `syncBoard` touches Discord.

import { createHash } from 'node:crypto';

import { EmbedBuilder } from 'discord.js';

import { BRAND_COLOR, FOOTER } from '../branding.js';
import { ROSTER_STATUSES } from '../raids/model.js';
import { SLOT_LABELS } from './dataset.js';
import { mergeReports } from '../sources/compare.js';
import { resolveSpecConsumables } from './resolve.js';
import { specsByClass } from '../game/specs.js';

// The four a raider actually has to buy. The optional slots (health and mana
// potions, augment rune) stay on `/consumables spec`: on a 40-spec board they
// are the difference between a table people read and one they scroll past.
export const BOARD_SLOTS = ['flask', 'food', 'potion', 'oil'];

/** Marks a spec somebody has signed up as. */
export const SIGNED_MARK = '🔸';

// Discord's own ceilings. Exceeding any one of them rejects the whole message,
// so the renderer trims to fit rather than finding out at raid time.
export const LIMITS = { fields: 25, fieldValue: 1024, total: 6000, title: 256 };

/**
 * Spec keys somebody is signed up as, across every raid that is still open.
 * A closed or cancelled raid is history, and its roster should stop marking
 * the board.
 */
export function signedUpSpecKeys(config, now = Date.now()) {
  const keys = new Set();

  for (const raid of Object.values(config?.raids ?? {})) {
    if (raid.closed || raid.cancelled) continue;
    // A raid whose start time has passed is over in every sense that matters
    // here, whether or not anybody remembered to close it.
    if (raid.startsAt && Date.parse(raid.startsAt) < now) continue;

    for (const signup of Object.values(raid.signups ?? {})) {
      if (!ROSTER_STATUSES.includes(signup.status)) continue;
      if (signup.specKey) keys.add(signup.specKey);
    }
  }

  return keys;
}

/** What one slot says, or null when it says nothing worth a column. */
export function slotText(entry, { alternatives = true } = {}) {
  // `none` is an answer -- "there is no oil this tier" -- and an empty slot is
  // a question. Neither belongs on a compact row, but only the second is worth
  // chasing, and `/consumables tier` is what lists those.
  if (!entry || entry.none || !entry.item) return null;

  const other = alternatives && entry.alternatives?.[0] ? ` / ${entry.alternatives[0].name}` : '';
  return `${entry.item.name}${other}`;
}

/** One spec's row: the name, then whatever is recorded for it. */
export function specLine({ resolved, slots = BOARD_SLOTS, signed = false, alternatives = true }) {
  const parts = slots.map((slot) => slotText(resolved.slots[slot], { alternatives })).filter(Boolean);
  const mark = signed ? `${SIGNED_MARK} ` : '';
  const body = parts.length > 0 ? parts.join(' \u00b7 ') : '_nothing recorded_';

  return `${mark}**${resolved.spec.name}** \u2014 ${body}`;
}

/**
 * Slots every spec answers the same way. The weapon oil is one item for the
 * whole raid more often than not, and repeating it on forty rows spends a
 * thousand of the six thousand characters Discord allows to say nothing. Those
 * get hoisted into a single line above the table instead.
 */
export function commonSlots(resolvedList, { alternatives = true } = {}) {
  const common = {};

  for (const slot of BOARD_SLOTS) {
    const texts = new Set(resolvedList.map((resolved) => slotText(resolved.slots[slot], { alternatives })));
    if (texts.size !== 1) continue;

    const [only] = texts;
    // All forty agreeing that a slot is empty is not worth a line either.
    if (only) common[slot] = only;
  }

  return common;
}

/**
 * The whole board: one field per class, one row per spec.
 *
 * @param {object} input
 * @param {object} input.dataset the tier file, as loaded at startup
 * @param {Record<string, object>} [input.overrides] this server's overrides
 * @param {object} [input.reports] merged guide reports
 * @param {Set<string>} [input.signedUp] spec keys signed up to an open raid
 */
export function buildBoardEmbed({ dataset, overrides = {}, reports = null, signedUp = new Set() }) {
  const grouped = [...specsByClass()].map(([className, specs]) => [
    className,
    specs.map((spec) => resolveSpecConsumables({ spec, dataset, overrides, reports })),
  ]);

  // Built once at full detail. If that overruns Discord's ceiling the whole
  // message is rejected, so the second attempt drops the "or this one"
  // alternatives -- the first item is still correct, just less generous.
  let embed = assemble({ grouped, signedUp, dataset, alternatives: true });
  if (embedSize(embed) <= LIMITS.total) return embed;

  // Second attempt drops the "or this one" alternatives. The first item is
  // still correct, just less generous -- worth about a thousand characters.
  embed = assemble({ grouped, signedUp, dataset, alternatives: false });

  // Still over, which takes item names nobody has yet written. Squeeze the
  // per-class budget until it fits: `fit` drops whole rows and says how many,
  // so the board stays honest about what it is not showing.
  for (let budget = LIMITS.fieldValue; embedSize(embed) > LIMITS.total && budget > 160; budget -= 120) {
    embed = assemble({ grouped, signedUp, dataset, alternatives: false, fieldBudget: budget - 120 });
  }

  return embed;
}

function assemble({ grouped, signedUp, dataset, alternatives, fieldBudget = LIMITS.fieldValue }) {
  const all = grouped.flatMap(([, list]) => list);
  const common = commonSlots(all, { alternatives });
  const rowSlots = BOARD_SLOTS.filter((slot) => !(slot in common));

  const description = [
    Object.keys(common).length > 0
      ? `**Everyone** \u2014 ${Object.entries(common)
          .map(([slot, text]) => `${SLOT_LABELS[slot]}: ${text}`)
          .join(' \u00b7 ')}`
      : null,
    rowSlots.length > 0 ? `_Each spec: ${rowSlots.map((slot) => SLOT_LABELS[slot]).join(' \u00b7 ')}_` : null,
    signedUp.size > 0
      ? `${SIGNED_MARK} someone is signed up as this spec.`
      : '_Nobody is signed up to an open raid right now._',
  ]
    .filter(Boolean)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(BRAND_COLOR)
    .setTitle(`Consumables \u2014 ${dataset.tier?.name ?? 'current tier'}`.slice(0, LIMITS.title))
    .setDescription(description)
    .setFooter({ text: FOOTER });

  for (const [className, list] of grouped) {
    const lines = list.map((resolved) =>
      specLine({ resolved, slots: rowSlots, signed: signedUp.has(resolved.spec.key), alternatives }),
    );
    embed.addFields({ name: className, value: fit(lines, fieldBudget) });
  }

  return embed;
}

/**
 * Join lines to fit one field, dropping whole rows rather than cutting a row
 * mid-item: half an item name reads as a real item and sends someone to the
 * auction house for something that does not exist.
 */
export function fit(lines, limit) {
  const kept = [];
  let length = 0;

  for (const [index, line] of lines.entries()) {
    const rest = `_\u2026${lines.length - index} more, see \`/consumables spec\`_`;

    // Room for this row, or room for the note saying the rest did not fit --
    // the note has to be paid for out of the same budget, or the field that
    // was trimmed to fit ends up one line over the limit again.
    if (length + line.length + 1 > limit - rest.length - 1) {
      kept.push(rest);
      break;
    }

    kept.push(line);
    length += line.length + 1;
  }

  return kept.join('\n') || '_nothing recorded_';
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
 * signup by a spec already on the roster -- does not spend an edit call.
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
      overrides: config.consumables?.overrides ?? {},
      reports: mergeReports(dataset.reports, config.consumables?.reports),
      signedUp: signedUpSpecKeys(config),
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
