// The server blueprint: the ranks and channels a WoW raiding guild's Discord
// gets set up with. This file is plain data on purpose -- `src/plan/` diffs it
// against a live server and `src/apply/` executes the difference, so changing
// what a guild's server looks like never means touching the code that builds it.
//
// Rank order is the array order: index 0 sits at the top of the role list.

import { ChannelType, PermissionFlagsBits as P } from 'discord.js';

export const RANKS = [
  {
    key: 'guildMaster',
    name: 'Guild Master',
    color: 0xe6b422,
    hoist: true,
    mentionable: true,
    permissions: [
      P.ManageGuild,
      P.ManageRoles,
      P.ManageChannels,
      P.ManageMessages,
      P.ManageEvents,
      P.KickMembers,
      P.BanMembers,
      P.MuteMembers,
      P.DeafenMembers,
      P.MoveMembers,
      P.MentionEveryone,
    ],
  },
  {
    key: 'officer',
    name: 'Officer',
    color: 0xc0392b,
    hoist: true,
    mentionable: true,
    permissions: [
      P.ManageMessages,
      P.ManageEvents,
      P.KickMembers,
      P.MuteMembers,
      P.MoveMembers,
      P.MentionEveryone,
    ],
  },
  {
    key: 'raidLeader',
    name: 'Raid Leader',
    color: 0xe67e22,
    hoist: true,
    mentionable: true,
    permissions: [P.ManageEvents, P.MuteMembers, P.MoveMembers, P.PrioritySpeaker, P.MentionEveryone],
  },
  {
    key: 'raider',
    name: 'Raider',
    color: 0x3498db,
    hoist: true,
    mentionable: true,
    permissions: [],
    // Self-assignable from the welcome message.
    selfAssign: {
      emoji: '⚔️',
      label: 'Raider',
      description: 'Raiding with the guild, or here to trial for a spot.',
    },
  },
  {
    key: 'trial',
    name: 'Trial',
    color: 0x5dade2,
    hoist: false,
    mentionable: true,
    permissions: [],
    // Deliberately not self-assignable: officers promote into and out of trial.
  },
  {
    key: 'social',
    name: 'Social',
    color: 0x2ecc71,
    hoist: true,
    mentionable: true,
    permissions: [],
    selfAssign: {
      emoji: '🍺',
      label: 'Social',
      description: 'Guild chat, alts, mythic+ and the odd pug. No raid commitment.',
    },
  },
  {
    key: 'newcomer',
    name: 'Newcomer',
    color: 0x95a5a6,
    hoist: false,
    mentionable: false,
    permissions: [],
    // Handed out automatically on join, and taken back once a rank is picked.
    isDefault: true,
  },
];

// Ranks that may be picked from the welcome message, in the order the reactions
// are added to it.
export const SELF_ASSIGN_RANKS = RANKS.filter((rank) => rank.selfAssign);

export const DEFAULT_RANK_KEY = RANKS.find((rank) => rank.isDefault)?.key ?? null;

export const RANK_KEYS = RANKS.map((rank) => rank.key);

export function rankByKey(key) {
  return RANKS.find((rank) => rank.key === key) ?? null;
}

// Ranks with access to everything a member can see. Used below so a new
// category does not have to re-list the whole officer chain.
const STAFF = ['guildMaster', 'officer', 'raidLeader'];
const RAID_TEAM = [...STAFF, 'raider', 'trial'];
const ALL_MEMBERS = [...RAID_TEAM, 'social'];

// `everyone` says what @everyone gets on the category:
//   'read'   -- can see and read, cannot post
//   'hidden' -- cannot see it at all; only the listed ranks can
export const CATEGORIES = [
  {
    key: 'information',
    name: '📜 Information',
    everyone: 'read',
    ranks: [],
    channels: [
      {
        key: 'welcome',
        name: 'welcome',
        type: 'text',
        topic: 'Start here — pick your rank to unlock the rest of the server.',
        // The landing page. @everyone may click the reactions the bot puts
        // there but may not add new ones, which is what keeps it from turning
        // into an emoji wall.
        lockReactions: true,
      },
      {
        key: 'rules',
        name: 'rules',
        type: 'text',
        topic: 'Guild rules and raid expectations.',
      },
      {
        key: 'announcements',
        name: 'announcements',
        type: 'text',
        topic: 'Guild news, roster changes, raid week announcements.',
      },
    ],
  },
  {
    key: 'guild',
    name: '💬 Guild',
    everyone: 'hidden',
    ranks: ALL_MEMBERS,
    channels: [
      { key: 'general', name: 'general', type: 'text', topic: 'Guild chat.' },
      { key: 'offTopic', name: 'off-topic', type: 'text', topic: 'Everything that is not WoW.' },
      { key: 'screenshots', name: 'screenshots', type: 'text', topic: 'Mounts, transmog, kill shots.' },
      { key: 'guildHall', name: 'Guild Hall', type: 'voice' },
    ],
  },
  {
    key: 'raid',
    name: '🗡️ Raid',
    everyone: 'hidden',
    ranks: RAID_TEAM,
    channels: [
      { key: 'raidChat', name: 'raid-chat', type: 'text', topic: 'Tactics, consumables, roster talk.' },
      {
        key: 'raidSignups',
        name: 'raid-signups',
        type: 'text',
        topic: 'Sign-ups for the raid week. Post absences here.',
      },
      { key: 'logs', name: 'logs-and-parses', type: 'text', topic: 'Warcraft Logs links and VOD reviews.' },
      { key: 'raidVoiceOne', name: 'Raid — Main', type: 'voice' },
      { key: 'raidVoiceTwo', name: 'Raid — Overflow', type: 'voice' },
    ],
  },
  {
    key: 'officers',
    name: '🛡️ Officers',
    everyone: 'hidden',
    ranks: STAFF,
    channels: [
      { key: 'officerChat', name: 'officer-chat', type: 'text', topic: 'Officer discussion.' },
      { key: 'applications', name: 'applications', type: 'text', topic: 'Recruitment and trial reviews.' },
      { key: 'officerVoice', name: 'Officer Meeting', type: 'voice' },
    ],
  },
];

export const CHANNEL_TYPES = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
};

// Every channel in the blueprint, flattened, each carrying its category key.
export function allChannels() {
  return CATEGORIES.flatMap((category) =>
    category.channels.map((channel) => ({ ...channel, categoryKey: category.key })),
  );
}
