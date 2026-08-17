// The channel half of the plan: which categories and channels already exist,
// which need creating, and what permission overwrites each one should carry.
//
// Discord does not compute channel permissions by inheriting from the category
// at read time -- "synced" channels simply hold a copy of the category's
// overwrites. So every channel gets its complete overwrite set computed here
// rather than a delta against its parent.

import { PermissionFlagsBits as P } from 'discord.js';

import { CATEGORIES } from '../blueprint.js';
import { normalizeName } from './roles.js';

// Text channel names are lowercased and dash-separated by Discord itself, so
// compare on that form rather than on what the blueprint typed.
export function channelSlug(name, type) {
  const normalized = normalizeName(name);
  return type === 'voice' ? normalized : normalized.replace(/\s+/g, '-');
}

const TEXT_PARTICIPATE = [
  P.ViewChannel,
  P.ReadMessageHistory,
  P.SendMessages,
  P.SendMessagesInThreads,
  P.CreatePublicThreads,
  P.AddReactions,
  P.AttachFiles,
  P.EmbedLinks,
  P.UseExternalEmojis,
];

const TEXT_READ_ONLY_ALLOW = [P.ViewChannel, P.ReadMessageHistory, P.AddReactions];

const TEXT_READ_ONLY_DENY = [
  P.SendMessages,
  P.SendMessagesInThreads,
  P.CreatePublicThreads,
  P.CreatePrivateThreads,
];

const VOICE_PARTICIPATE = [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD];

const HIDDEN_DENY = [P.ViewChannel, P.Connect];

/**
 * The complete overwrite set for one channel (or for a category, when `channel`
 * is omitted).
 *
 * @param {object} input
 * @param {object} input.category blueprint category
 * @param {object} [input.channel] blueprint channel within it
 * @param {Record<string, string|null>} input.roleIds rank key -> role id
 * @param {string} input.everyoneRoleId the @everyone role id (equals the guild id)
 */
export function overwritesFor({ category, channel = null, roleIds, everyoneRoleId }) {
  const isVoice = channel?.type === 'voice';
  const overwrites = [];

  if (category.everyone === 'read') {
    const allow = [...TEXT_READ_ONLY_ALLOW];
    const deny = [...TEXT_READ_ONLY_DENY];
    if (channel?.lockReactions) {
      // Members may still click the reactions the bot placed -- that needs only
      // ViewChannel and ReadMessageHistory. Denying AddReactions stops them
      // adding a hundred more emoji next to them.
      allow.splice(allow.indexOf(P.AddReactions), 1);
      deny.push(P.AddReactions);
    }
    overwrites.push({ id: everyoneRoleId, allow, deny });
  } else {
    overwrites.push({ id: everyoneRoleId, allow: [], deny: [...HIDDEN_DENY] });
  }

  for (const rankKey of category.ranks) {
    const roleId = roleIds[rankKey];
    if (!roleId) continue; // Rank not bound yet; skip rather than crash.
    overwrites.push({
      id: roleId,
      allow: isVoice ? [...VOICE_PARTICIPATE] : [...TEXT_PARTICIPATE],
      deny: [],
    });
  }

  return overwrites;
}

/**
 * @param {object} input
 * @param {Array<{id: string, name: string, type: 'text'|'voice'|'category', parentId: string|null}>} input.existing
 * @param {{categories: Record<string, string|null>, channels: Record<string, string|null>}} input.bound
 * @param {Array<object>} [input.categories] blueprint categories
 */
export function planChannels({ existing, bound = { categories: {}, channels: {} }, categories = CATEGORIES }) {
  const byId = new Map(existing.map((channel) => [channel.id, channel]));

  const findExisting = (name, type, parentId) =>
    existing.find(
      (candidate) =>
        candidate.type === type &&
        channelSlug(candidate.name, type) === channelSlug(name, type) &&
        (type === 'category' || candidate.parentId === parentId),
    ) ?? null;

  const categorySteps = [];
  const channelSteps = [];

  for (const category of categories) {
    const boundCategoryId = bound.categories?.[category.key];
    let categoryId = null;
    let action = 'create';

    if (boundCategoryId && byId.has(boundCategoryId)) {
      categoryId = boundCategoryId;
      action = 'keep';
    } else {
      const match = findExisting(category.name, 'category', null);
      if (match) {
        categoryId = match.id;
        action = 'adopt';
      }
    }

    categorySteps.push({ key: category.key, name: category.name, action, channelId: categoryId });

    for (const channel of category.channels) {
      const boundChannelId = bound.channels?.[channel.key];
      if (boundChannelId && byId.has(boundChannelId)) {
        channelSteps.push({
          key: channel.key,
          categoryKey: category.key,
          name: channel.name,
          type: channel.type,
          action: 'keep',
          channelId: boundChannelId,
        });
        continue;
      }

      // Only adopt a same-named channel when it is already sitting in the
      // category we matched; a #general in some other category belongs to
      // something else.
      const match = categoryId ? findExisting(channel.name, channel.type, categoryId) : null;
      channelSteps.push({
        key: channel.key,
        categoryKey: category.key,
        name: channel.name,
        type: channel.type,
        action: match ? 'adopt' : 'create',
        channelId: match?.id ?? null,
      });
    }
  }

  return { categorySteps, channelSteps };
}
