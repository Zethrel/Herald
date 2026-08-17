import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildWelcomeEmbed, welcomeReactions } from '../src/welcome.js';
import { commandPayload } from '../src/commands/index.js';
import { defaultGuildConfig } from '../src/store.js';

function configured() {
  const config = defaultGuildConfig();
  config.roles.raider = 'role-raider';
  config.roles.social = 'role-social';
  return config;
}

describe('welcomeReactions', () => {
  it('lists the emoji in blueprint order', () => {
    assert.deepEqual(welcomeReactions(configured()), ['⚔️', '🍺']);
  });

  it('leaves out ranks with no role bound, so the message cannot lie', () => {
    const config = configured();
    config.roles.raider = null;

    assert.deepEqual(welcomeReactions(config), ['🍺']);
  });
});

describe('buildWelcomeEmbed', () => {
  it('describes every self-serve rank', () => {
    const embed = buildWelcomeEmbed({ guildName: 'Kill Them All', config: configured() }).toJSON();

    assert.match(embed.title, /Kill Them All/);
    assert.ok(embed.fields.some((field) => field.name.includes('Raider')));
    assert.ok(embed.fields.some((field) => field.name.includes('Social')));
  });

  it('mentions that ranks are exclusive only when they are', () => {
    const exclusive = buildWelcomeEmbed({ guildName: 'G', config: configured() }).toJSON();
    assert.ok(exclusive.fields.some((field) => /exclusive/i.test(field.value)));

    const config = { ...configured(), exclusiveRanks: false };
    const shared = buildWelcomeEmbed({ guildName: 'G', config }).toJSON();
    assert.ok(!shared.fields.some((field) => /exclusive/i.test(field.value)));
  });

  it('says so instead of rendering an empty page when nothing is configured', () => {
    const embed = buildWelcomeEmbed({ guildName: 'G', config: defaultGuildConfig() }).toJSON();

    assert.equal(embed.fields.length, 1);
    assert.match(embed.fields[0].value, /setup run/);
  });
});

describe('command definitions', () => {
  it('build into a valid registration payload', () => {
    const payload = commandPayload();
    const names = payload.map((command) => command.name);

    assert.deepEqual(names, ['setup', 'welcome', 'config', 'rank', 'consumables', 'guilds', 'about']);
    assert.ok(payload.every((command) => command.description.length > 0));
  });

  it('keeps the server-shaping commands off limits to ordinary members', () => {
    const payload = commandPayload();
    for (const name of ['setup', 'welcome', 'config', 'rank', 'guilds']) {
      const command = payload.find((entry) => entry.name === name);
      assert.ok(command.default_member_permissions, `${name} should require a permission`);
    }
  });

  it('leaves the commands raiders need open to raiders', () => {
    // /consumables is a lookup: everyone should be able to ask what their own
    // spec brings. Its `set` and `clear` subcommands check Manage Server in
    // code instead, so the whole command does not have to be locked down.
    const payload = commandPayload();
    for (const name of ['consumables', 'about']) {
      const command = payload.find((entry) => entry.name === name);
      assert.ok(!command.default_member_permissions, `${name} should be open`);
    }
  });
});
