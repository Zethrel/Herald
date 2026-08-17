import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBlizzardClient, readBlizzardEnv } from '../src/sync/blizzard.js';

// The client is never exercised against the real API in CI, so the request it
// builds — namespace, locale, auth header, token reuse, 429 backoff — is
// checked against a stub instead. Getting the namespace wrong is the classic
// way to spend an afternoon on an empty result set.

function stubFetch(handlers) {
  const calls = [];
  const impl = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });

    for (const [pattern, respond] of handlers) {
      if (url.includes(pattern)) return respond(url, init, calls);
    }
    throw new Error(`unexpected request: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body,
});

const token = ['oauth.battle.net/token', () => json({ access_token: 'tok', expires_in: 3600 })];

const credentials = { clientId: 'id', clientSecret: 'secret', region: 'eu', locale: 'en_GB' };

describe('readBlizzardEnv', () => {
  it('demands both halves of the credential', () => {
    assert.throws(() => readBlizzardEnv({ BLIZZARD_CLIENT_ID: 'only-one' }), /BLIZZARD_CLIENT_SECRET/);
  });

  it('defaults the region and locale', () => {
    const env = readBlizzardEnv({ BLIZZARD_CLIENT_ID: 'a', BLIZZARD_CLIENT_SECRET: 'b' });
    assert.equal(env.region, 'eu');
    assert.equal(env.locale, 'en_GB');
  });
});

describe('createBlizzardClient', () => {
  it('authenticates with basic auth and reuses the token', async () => {
    const fetchImpl = stubFetch([token, ['/data/wow/item/1', () => json({ id: 1 })]]);
    const client = createBlizzardClient({ ...credentials, fetchImpl });

    await client.getItem(1);
    await client.getItem(1);

    const auths = fetchImpl.calls.filter((call) => call.url.includes('token'));
    assert.equal(auths.length, 1, 'the token should be fetched once, not per request');
    assert.equal(
      auths[0].init.headers.authorization,
      `Basic ${Buffer.from('id:secret').toString('base64')}`,
    );
  });

  it('sends the static namespace, the locale and the bearer token', async () => {
    const fetchImpl = stubFetch([token, ['/data/wow/item/', () => json({ id: 7 })]]);
    const client = createBlizzardClient({ ...credentials, fetchImpl });

    await client.getItem(7);
    const call = fetchImpl.calls.at(-1);

    assert.ok(call.url.startsWith('https://eu.api.blizzard.com/data/wow/item/7'));
    assert.ok(call.url.includes('namespace=static-eu'));
    assert.ok(call.url.includes('locale=en_GB'));
    assert.equal(call.init.headers.authorization, 'Bearer tok');
  });

  it('searches items by exact English name', async () => {
    const fetchImpl = stubFetch([
      token,
      ['/data/wow/search/item', () => json({ results: [{ data: { id: 42, name: 'Flask' } }] })],
    ]);
    const client = createBlizzardClient({ ...credentials, fetchImpl });

    const item = await client.findItemByName('Flask of Testing');

    assert.equal(item.id, 42);
    const call = fetchImpl.calls.at(-1);
    // The search API keys on the US name regardless of the locale asked for.
    assert.ok(call.url.includes('name.en_US=Flask+of+Testing'));
    assert.ok(call.url.includes('orderby=id'));
  });

  it('returns null for an empty search rather than throwing', async () => {
    const fetchImpl = stubFetch([token, ['/data/wow/search/', () => json({ results: [] })]]);
    const client = createBlizzardClient({ ...credentials, fetchImpl });

    assert.equal(await client.findRecipeByName('Nothing'), null);
  });

  it('treats a 404 as absent', async () => {
    const fetchImpl = stubFetch([token, ['/data/wow/recipe/', () => json({}, 404)]]);
    const client = createBlizzardClient({ ...credentials, fetchImpl });

    assert.equal(await client.getRecipe(1), null);
  });

  it('retries a rate limit and then succeeds', async () => {
    let attempts = 0;
    const fetchImpl = stubFetch([
      token,
      [
        '/data/wow/item/',
        () => {
          attempts += 1;
          return attempts === 1 ? json({}, 429) : json({ id: 3 });
        },
      ],
    ]);
    const client = createBlizzardClient({ ...credentials, fetchImpl });

    assert.deepEqual(await client.getItem(3), { id: 3 });
    assert.equal(attempts, 2);
  });

  it('says plainly when the credentials are refused', async () => {
    const fetchImpl = stubFetch([['oauth.battle.net/token', () => json({}, 401)]]);
    const client = createBlizzardClient({ ...credentials, fetchImpl });

    await assert.rejects(() => client.getItem(1), /rejected the credentials/);
  });

  it('surfaces a server error instead of returning nothing', async () => {
    const fetchImpl = stubFetch([token, ['/data/wow/item/', () => json({}, 500)]]);
    const client = createBlizzardClient({ ...credentials, fetchImpl });

    await assert.rejects(() => client.getItem(1), /returned 500/);
  });
});
