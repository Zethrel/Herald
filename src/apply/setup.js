// Executes a plan against a live server.
//
// Everything this does is additive: it creates what is missing and records what
// it found. It never deletes a role or a channel, and it only rewrites the
// permissions of a channel it did not create when explicitly asked to.

import { CATEGORIES, CHANNEL_TYPES, RANKS, rankByKey } from '../blueprint.js';
import { planRoles } from '../plan/roles.js';
import { overwritesFor, planChannels } from '../plan/channels.js';
import { publishWelcome } from '../welcome.js';

const REASON = 'Guild server setup';

function snapshotRoles(guild) {
  return [...guild.roles.cache.values()].map((role) => ({
    id: role.id,
    name: role.name,
    managed: role.managed,
  }));
}

function snapshotChannels(guild) {
  const typeByDiscordType = new Map(
    Object.entries(CHANNEL_TYPES).map(([name, discordType]) => [discordType, name]),
  );

  return [...guild.channels.cache.values()]
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: typeByDiscordType.get(channel.type) ?? null,
      parentId: channel.parentId ?? null,
    }))
    .filter((channel) => channel.type !== null);
}

/**
 * @param {object} input
 * @param {import('discord.js').Guild} input.guild
 * @param {import('discord.js').Client} input.client
 * @param {object} input.config the guild's stored config
 * @param {object} input.store
 * @param {boolean} [input.dryRun] report what would happen, change nothing
 * @param {boolean} [input.enforcePermissions] also rewrite overwrites on adopted channels
 * @param {boolean} [input.createChannels] false on a server that already has its own
 */
export async function applySetup({
  guild,
  client,
  config,
  store,
  dryRun = false,
  enforcePermissions = false,
  createChannels = true,
}) {
  const report = {
    dryRun,
    roles: [],
    categories: [],
    channels: [],
    welcome: null,
    warnings: [],
  };

  // --- Roles ------------------------------------------------------------------

  await guild.roles.fetch();
  const rolePlan = planRoles({ existingRoles: snapshotRoles(guild), boundRoleIds: config.roles });
  const roleIds = { ...config.roles };

  for (const step of rolePlan.steps) {
    report.roles.push(step);
    if (step.action !== 'create') {
      roleIds[step.key] = step.roleId;
      continue;
    }
    if (dryRun) continue;

    const rank = rankByKey(step.key);
    const created = await guild.roles.create({
      name: rank.name,
      color: rank.color,
      hoist: rank.hoist,
      mentionable: rank.mentionable,
      permissions: rank.permissions,
      reason: REASON,
    });
    roleIds[step.key] = created.id;
    step.roleId = created.id;
  }

  if (!dryRun) {
    await store.update(guild.id, { roles: roleIds });
    const ordering = await orderRanks(guild, roleIds);
    if (ordering) report.warnings.push(ordering);
  }

  // --- Categories and channels ------------------------------------------------

  await guild.channels.fetch();

  // A server that already has its own channels wants the ranks and nothing
  // else: whatever /config channel bound stays bound, and the welcome message
  // still goes wherever it was pointed.
  if (!createChannels) {
    if (dryRun) return report;

    const nextConfig = await store.get(guild.id);
    await store.update(guild.id, { setupAt: new Date().toISOString() });
    await postWelcome({ guild, client, config: nextConfig, store, report });
    return report;
  }
  const channelPlan = planChannels({
    existing: snapshotChannels(guild),
    bound: { categories: config.categories, channels: config.channels },
  });

  const categoryIds = { ...config.categories };
  const channelIds = { ...config.channels };
  const everyoneRoleId = guild.roles.everyone.id;

  for (const step of channelPlan.categorySteps) {
    report.categories.push(step);
    const category = CATEGORIES.find((entry) => entry.key === step.key);
    const overwrites = overwritesFor({ category, roleIds, everyoneRoleId });

    if (step.action === 'create') {
      if (dryRun) continue;
      const created = await guild.channels.create({
        name: category.name,
        type: CHANNEL_TYPES.category,
        permissionOverwrites: overwrites,
        reason: REASON,
      });
      categoryIds[step.key] = created.id;
      step.channelId = created.id;
    } else {
      categoryIds[step.key] = step.channelId;
      if (!dryRun && enforcePermissions) {
        const existing = guild.channels.cache.get(step.channelId);
        if (existing) await existing.permissionOverwrites.set(overwrites, REASON);
      }
    }
  }

  for (const step of channelPlan.channelSteps) {
    report.channels.push(step);
    const category = CATEGORIES.find((entry) => entry.key === step.categoryKey);
    const channel = category.channels.find((entry) => entry.key === step.key);
    const overwrites = overwritesFor({ category, channel, roleIds, everyoneRoleId });

    if (step.action === 'create') {
      if (dryRun) continue;
      const created = await guild.channels.create({
        name: channel.name,
        type: CHANNEL_TYPES[channel.type],
        parent: categoryIds[step.categoryKey] ?? null,
        ...(channel.topic ? { topic: channel.topic } : {}),
        permissionOverwrites: overwrites,
        reason: REASON,
      });
      channelIds[step.key] = created.id;
      step.channelId = created.id;
    } else {
      channelIds[step.key] = step.channelId;
      if (!dryRun && enforcePermissions) {
        const existing = guild.channels.cache.get(step.channelId);
        if (existing) await existing.permissionOverwrites.set(overwrites, REASON);
      }
    }
  }

  if (dryRun) return report;

  const nextConfig = await store.update(guild.id, {
    categories: categoryIds,
    channels: channelIds,
    setupAt: new Date().toISOString(),
  });

  // --- Welcome message --------------------------------------------------------

  await postWelcome({ guild, client, config: nextConfig, store, report });
  return report;
}

/** Post or refresh the rank picker, wherever this server keeps it. */
async function postWelcome({ guild, client, config, store, report }) {
  const welcomeChannelId = config.welcome?.channelId ?? config.channels?.welcome;
  const welcomeChannel = welcomeChannelId ? guild.channels.cache.get(welcomeChannelId) : null;

  if (!welcomeChannel) {
    report.warnings.push(
      'No welcome channel bound — point one at an existing channel with `/config channel slot:welcome`, then run `/welcome post`.',
    );
    return;
  }

  const message = await publishWelcome({ channel: welcomeChannel, config, guild, client });
  await store.update(guild.id, {
    welcome: { channelId: welcomeChannel.id, messageId: message.id },
  });
  report.welcome = { channelId: welcomeChannel.id, messageId: message.id };
}

/**
 * Put the ranks in blueprint order, directly under the bot's own role.
 *
 * Best effort by nature: Discord refuses to move any role above the bot's
 * highest one, so on a server where the bot was invited with a low role this
 * quietly does nothing and says so.
 *
 * @returns {Promise<string|null>} a warning, or null when the reorder worked
 */
async function orderRanks(guild, roleIds) {
  const botTop = guild.members.me?.roles.highest.position ?? 0;
  const positions = [];

  RANKS.forEach((rank, index) => {
    const roleId = roleIds[rank.key];
    const position = botTop - 1 - index;
    if (!roleId || position < 1) return;
    positions.push({ role: roleId, position });
  });

  if (positions.length < RANKS.length) {
    return `Could not order every rank: ${guild.members.me?.roles.highest.name ?? "the bot's role"} needs to sit above them in Server Settings → Roles.`;
  }

  try {
    await guild.roles.setPositions(positions);
    return null;
  } catch (error) {
    return `Ranks were created but could not be reordered (${error.message}). Drag the bot's role above them and re-run \`/setup run\`.`;
  }
}
