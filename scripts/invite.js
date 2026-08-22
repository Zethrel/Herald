#!/usr/bin/env node
//
// Print the invite URL.
//
//   npm run invite
//
// It exists because the client_id in that URL is the *Application* ID, and the
// three ids on the Developer Portal look alike -- putting a user id or a server
// id there yields "Unknown Application", which does not say which id is wrong.
// This reads the one already proven correct by `npm run deploy`.

import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';

import { BOT_NAME } from '../src/branding.js';

// Why each one is needed, so nobody has to guess when trimming the list.
//
// The second group is not about the bot's own messages. Discord only lets a bot
// grant an overwrite bit it already holds, and `/setup run` writes exactly these
// bits into every channel it creates (see TEXT_PARTICIPATE and VOICE_PARTICIPATE
// in src/plan/channels.js). Without them the channel creation fails outright.
const NEEDED = [
  [P.ManageRoles, 'create the ranks and hand them out'],
  [P.ManageChannels, 'create the categories and channels'],
  [P.ViewChannel, 'see the channels it made'],
  [P.SendMessages, 'post the welcome page, raid signups and reminders'],
  [P.EmbedLinks, 'those posts are embeds'],
  [P.AddReactions, 'put the ⚔️ and 🍺 on the welcome page'],
  [P.ReadMessageHistory, 'find its own welcome message again after a restart'],
  [P.ManageMessages, "remove a member's stale reaction when they switch rank"],

  [P.SendMessagesInThreads, 'grant it to the ranks in every text channel'],
  [P.CreatePublicThreads, 'grant it to the ranks, deny it on the read-only ones'],
  [P.CreatePrivateThreads, 'deny it on the read-only channels'],
  [P.AttachFiles, 'grant it to the ranks in every text channel'],
  [P.UseExternalEmojis, 'grant it to the ranks in every text channel'],
  [P.Connect, 'grant it to the ranks in the raid and officer voice channels'],
  [P.Speak, 'grant it to the ranks in the voice channels'],
  [P.Stream, 'grant it to the ranks in the voice channels'],
  [P.UseVAD, 'grant it to the ranks in the voice channels'],

  // Optional in practice: an unapproved server has no reason to have granted
  // it, and the report says "unknown" rather than failing.
  [P.ViewAuditLog, 'name who added the bot to an unapproved server'],
];

const clientId = process.env.DISCORD_CLIENT_ID?.trim();

if (!clientId) {
  console.error(
    [
      '',
      'DISCORD_CLIENT_ID is not set.',
      '',
      'It is the Application ID: Developer Portal → your app → General Information.',
      'Not your user id, and not the server id — those give "Unknown Application".',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const permissions = new PermissionsBitField(NEEDED.map(([bit]) => bit));

console.log(`\nInvite ${BOT_NAME} with this link:\n`);
console.log(
  `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${permissions.bitfield}\n`,
);
console.log('It asks for:');
for (const [bit, why] of NEEDED) {
  console.log(`  ${new PermissionsBitField(bit).toArray()[0].padEnd(22)} ${why}`);
}
console.log(
  `\nAfter inviting, drag its role above the ranks it manages\n(Server Settings → Roles), or it cannot hand them out.\n`,
);
