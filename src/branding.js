// Everything the bot calls itself lives here, so renaming it is one edit rather
// than a grep across every embed footer.
//
// This is only what it calls *itself* in its own messages. The username shown
// in the member list comes from the Discord Developer Portal, and a per-server
// nickname overrides even that -- three separate places, and nothing here can
// change the other two.

/** The full name, for titles and anywhere it introduces itself. */
export const BOT_NAME = process.env.BOT_NAME?.trim() || 'Sleepwalkers Quartermaster';

/**
 * The short form, for footers on every embed. A footer repeats on every message
 * the bot posts, so the long name earns its place in a title and not there.
 */
export const BOT_SHORT_NAME = process.env.BOT_SHORT_NAME?.trim() || 'Quartermaster';

// Faction-neutral gold. Used for every embed the bot posts so its messages read
// as one voice in a channel full of other bots' output.
export const BRAND_COLOR = 0xc8a44a;

export const FOOTER = BOT_SHORT_NAME;
