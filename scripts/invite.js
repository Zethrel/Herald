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

// Why each one is needed, so nobody has to guess when trimming the list.
const NEEDED = [
  [P.ManageRoles, 'create the ranks and hand them out'],
  [P.ManageChannels, 'create the categories and channels'],
  [P.ViewChannel, 'see the channels it made'],
  [P.SendMessages, 'post the welcome page, raid signups and reminders'],
  [P.EmbedLinks, 'those posts are embeds'],
  [P.AddReactions, 'put the ⚔️ and 🍺 on the welcome page'],
  [P.ReadMessageHistory, 'find its own welcome message again after a restart'],
  [P.ManageMessages, "remove a member's stale reaction when they switch rank"],
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

console.log(`\nInvite Herald with this link:\n`);
console.log(
  `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${permissions.bitfield}\n`,
);
console.log('It asks for:');
for (const [bit, why] of NEEDED) {
  console.log(`  ${new PermissionsBitField(bit).toArray()[0].padEnd(19)} ${why}`);
}
console.log(
  '\nAfter inviting, drag Herald\'s role above the ranks it manages\n(Server Settings → Roles), or it cannot hand them out.\n',
);
