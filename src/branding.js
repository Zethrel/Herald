// Everything the bot calls itself lives here, because the name is still a
// placeholder. Renaming it later is one edit (or one env var) rather than a
// grep across every embed footer.

export const BOT_NAME = process.env.BOT_NAME?.trim() || 'Herald';

// Faction-neutral gold. Used for every embed the bot posts so its messages read
// as one voice in a channel full of other bots' output.
export const BRAND_COLOR = 0xc8a44a;

export const FOOTER = `${BOT_NAME} · guild ranks`;
