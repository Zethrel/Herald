// A small client for Blizzard's Game Data API.
//
// Deliberately thin: it authenticates, it fetches, it retries a 429. Everything
// that turns a response into tier data lives in tierSync.js, where it can be
// tested without credentials or a network.
//
// Credentials are free: https://develop.battle.net → Create Client. They are
// only needed by `npm run sync-tier`, never by the running bot.

const TOKEN_URL = 'https://oauth.battle.net/token';

export function readBlizzardEnv(env = process.env) {
  const clientId = env.BLIZZARD_CLIENT_ID?.trim();
  const clientSecret = env.BLIZZARD_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      'BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET are required for the tier sync. Create a client at https://develop.battle.net and put them in .env.',
    );
  }

  return {
    clientId,
    clientSecret,
    region: env.BLIZZARD_REGION?.trim() || 'eu',
    locale: env.BLIZZARD_LOCALE?.trim() || 'en_GB',
  };
}

export function createBlizzardClient({ clientId, clientSecret, region, locale, fetchImpl = fetch }) {
  let token = null;
  let tokenExpiresAt = 0;

  async function authenticate() {
    if (token && Date.now() < tokenExpiresAt) return token;

    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      throw new Error(`Blizzard rejected the credentials (${response.status}). Check the client id and secret.`);
    }

    const body = await response.json();
    token = body.access_token;
    // Expire a minute early rather than discovering it mid-run.
    tokenExpiresAt = Date.now() + (body.expires_in ?? 3600) * 1000 - 60_000;
    return token;
  }

  async function get(path, params = {}) {
    const url = new URL(`https://${region}.api.blizzard.com${path}`);
    url.searchParams.set('namespace', `static-${region}`);
    url.searchParams.set('locale', locale);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${await authenticate()}` },
      });

      if (response.status === 429) {
        // Blizzard allows 100 requests a second; a sync of a few dozen items
        // should never see this, but backing off is cheaper than failing.
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
        continue;
      }

      if (response.status === 404) return null;

      if (!response.ok) {
        throw new Error(`${path} returned ${response.status} ${response.statusText}`);
      }

      return response.json();
    }

    throw new Error(`${path} kept rate limiting after four attempts.`);
  }

  return {
    get,

    /** Exact-name item lookup. Returns the lowest id, which is the real item. */
    async findItemByName(name) {
      const body = await get('/data/wow/search/item', {
        'name.en_US': name,
        orderby: 'id',
        _pageSize: '25',
      });
      return body?.results?.[0]?.data ?? null;
    },

    async findRecipeByName(name) {
      const body = await get('/data/wow/search/recipe', {
        'name.en_US': name,
        orderby: 'id',
        _pageSize: '25',
      });
      return body?.results?.[0]?.data ?? null;
    },

    getRecipe(id) {
      return get(`/data/wow/recipe/${id}`);
    },

    getItem(id) {
      return get(`/data/wow/item/${id}`);
    },
  };
}
