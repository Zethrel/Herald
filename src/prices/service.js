// Fetching and caching commodity prices.
//
// The commodity feed is tens of megabytes and is regenerated once an hour, at
// 20 past. So: fetch at most once per refresh, summarise into an order book for
// the items we care about, and throw the raw feed away. A second `/consumables
// shopping` in the same hour costs nothing.
//
// Optional by design. No Blizzard credentials means no prices and no errors --
// every other part of the bot carries on.

import { buildOrderBook } from './auctions.js';
import { cacheExpiryFor, describeAge } from '../sync/refresh.js';
import { createBlizzardClient } from '../sync/blizzard.js';

export function createPriceService({ client, log, now = () => new Date() }) {
  if (!client) {
    return {
      available: false,
      async prices() {
        return null;
      },
    };
  }

  /** @type {{books: Map<number, Array>, lastModified: string|null, expiresAt: Date}|null} */
  let cache = null;
  // One in-flight fetch at a time: three raiders running the command together
  // must not each pull ten megabytes.
  let inFlight = null;

  async function refresh(wanted) {
    const { auctions, lastModified } = await client.getCommodities();
    const at = now();

    cache = {
      // Keyed on every id asked for so far, so a later call for a different
      // item does not silently miss.
      books: buildOrderBook(auctions, wanted),
      wanted: new Set(wanted),
      lastModified,
      fetchedAt: at,
      expiresAt: cacheExpiryFor(at),
    };

    log?.info(
      `Commodity prices: ${cache.books.size} of ${wanted.size ?? wanted.length} item(s) listed, snapshot ${describeAge(lastModified, at).text}`,
    );

    return cache;
  }

  return {
    available: true,

    /**
     * @param {number[]} itemIds
     * @returns {Promise<{books: Map<number, Array>, lastModified: string|null, age: object}|null>}
     */
    async prices(itemIds) {
      const wanted = new Set(itemIds.filter((id) => id != null));
      if (wanted.size === 0) return null;

      const at = now();
      const usable =
        cache &&
        cache.expiresAt > at &&
        // A cached book built for a narrower set cannot answer for new items.
        [...wanted].every((id) => cache.wanted.has(id));

      try {
        const current = usable ? cache : await (inFlight ??= refresh(wanted).finally(() => {
          inFlight = null;
        }));

        return {
          books: current.books,
          lastModified: current.lastModified,
          age: describeAge(current.lastModified, at),
        };
      } catch (error) {
        // Prices are a nicety; the shopping list is the deliverable.
        log?.warn(`Could not fetch commodity prices: ${error.message}`);
        return null;
      }
    },
  };
}

/** Build the service from the environment, or a disabled one when no keys. */
export function priceServiceFromEnv({ env, log }) {
  if (!env.blizzard) return createPriceService({ client: null, log });

  return createPriceService({
    client: createBlizzardClient(env.blizzard),
    log,
  });
}
