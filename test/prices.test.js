import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  RECOMMENDED_CRON,
  REFRESH_MINUTE,
  cacheExpiryFor,
  describeAge,
  lastRefreshBefore,
  minutesUntilNextRefresh,
  nextRefreshAfter,
} from '../src/sync/refresh.js';
import { buildOrderBook, costToBuy, formatMoney, priceLines } from '../src/prices/auctions.js';
import { createPriceService } from '../src/prices/service.js';
import { normalizeDataset } from '../src/consumables/dataset.js';

const at = (iso) => new Date(iso);

describe('the hourly refresh', () => {
  it('knows Blizzard regenerates at 20 past', () => {
    assert.equal(REFRESH_MINUTE, 20);
    assert.equal(nextRefreshAfter(at('2026-08-17T10:05:00Z')).toISOString(), '2026-08-17T10:20:00.000Z');
    assert.equal(lastRefreshBefore(at('2026-08-17T10:05:00Z')).toISOString(), '2026-08-17T09:20:00.000Z');
  });

  it('rolls over the hour correctly', () => {
    assert.equal(nextRefreshAfter(at('2026-08-17T10:20:00Z')).toISOString(), '2026-08-17T11:20:00.000Z');
    assert.equal(lastRefreshBefore(at('2026-08-17T10:20:00Z')).toISOString(), '2026-08-17T10:20:00.000Z');
    assert.equal(nextRefreshAfter(at('2026-08-17T23:45:00Z')).toISOString(), '2026-08-18T00:20:00.000Z');
  });

  it('expires a cache just after the next refresh, not on the hour', () => {
    // Expiring at 11:00 would re-download ten megabytes for data that does not
    // change until 11:20.
    assert.equal(cacheExpiryFor(at('2026-08-17T10:30:00Z')).toISOString(), '2026-08-17T11:25:00.000Z');
    assert.equal(minutesUntilNextRefresh(at('2026-08-17T10:00:00Z')), 20);
  });

  it('schedules a sync after the refresh has landed', () => {
    assert.equal(RECOMMENDED_CRON, '25 * * * *');
  });

  it('describes how old a snapshot is', () => {
    const now = at('2026-08-17T11:00:00Z');
    assert.equal(describeAge('2026-08-17T10:20:00Z', now).text, '40 min ago');
    assert.equal(describeAge('2026-08-17T11:00:00Z', now).text, 'just now');
    assert.equal(describeAge('2026-08-17T09:20:00Z', now).text, '1h 40m ago');
    assert.equal(describeAge(null, now).stale, true);
    assert.equal(describeAge('not a date', now).stale, true);
  });

  it('calls a snapshot stale once a refresh has been missed', () => {
    const now = at('2026-08-17T13:00:00Z');
    assert.equal(describeAge('2026-08-17T12:20:00Z', now).stale, false);
    assert.equal(describeAge('2026-08-17T10:20:00Z', now).stale, true);
  });
});

describe('formatMoney', () => {
  it('reads as gold and silver', () => {
    assert.equal(formatMoney(12_345_600), '1,234g 56s');
    assert.equal(formatMoney(9_900), '99s 0c');
    assert.equal(formatMoney(42), '42c');
    assert.equal(formatMoney(null), '—');
  });
});

describe('buildOrderBook', () => {
  const auctions = [
    { item: { id: 1 }, unit_price: 500, quantity: 10 },
    { item: { id: 1 }, unit_price: 100, quantity: 5 },
    { item: { id: 2 }, unit_price: 900, quantity: 3 },
    { item: { id: 3 }, unit_price: 100, quantity: 1 },
    { item: { id: 1 }, unit_price: 300, quantity: 0 },
    { item: {}, unit_price: 100, quantity: 5 },
  ];

  it('keeps only the items asked for, cheapest first', () => {
    const books = buildOrderBook(auctions, [1, 2]);

    assert.deepEqual([...books.keys()].sort(), [1, 2]);
    assert.deepEqual(books.get(1), [
      { price: 100, quantity: 5 },
      { price: 500, quantity: 10 },
    ]);
  });

  it('drops listings with no quantity or no item', () => {
    const books = buildOrderBook(auctions, [1]);
    assert.equal(books.get(1).length, 2);
  });

  it('takes everything when nothing is specified', () => {
    assert.equal(buildOrderBook(auctions).size, 3);
  });
});

describe('costToBuy', () => {
  const book = [
    { price: 100, quantity: 5 },
    { price: 500, quantity: 10 },
  ];

  it('walks the book rather than quoting the cheapest listing', () => {
    // The naive answer is 10 × 100 = 1000. The real one is 5 × 100 + 5 × 500.
    const cost = costToBuy(book, 10);

    assert.equal(cost.total, 3000);
    assert.equal(cost.cheapest, 100);
    assert.equal(cost.unitAverage, 300);
    assert.equal(cost.short, 0);
  });

  it('stops at the first listing when that is enough', () => {
    assert.equal(costToBuy(book, 3).total, 300);
  });

  it('says how far short the auction house is', () => {
    const cost = costToBuy(book, 100);

    assert.equal(cost.short, 85);
    assert.equal(cost.available, 15);
    assert.equal(cost.total, 5 * 100 + 10 * 500);
  });

  it('returns nothing for an empty book', () => {
    assert.equal(costToBuy([], 5), null);
    assert.equal(costToBuy(undefined, 5), null);
  });
});

describe('priceLines', () => {
  const dataset = normalizeDataset({
    items: {
      herb: { name: 'Herb', itemId: 1 },
      water: { name: 'Water', itemId: 2 },
      mystery: { name: 'Mystery', itemId: null },
    },
  });

  const books = buildOrderBook([
    { item: { id: 1 }, unit_price: 100, quantity: 1000 },
    { item: { id: 2 }, unit_price: 50, quantity: 2 },
  ]);

  it('totals the lines it can price', () => {
    const result = priceLines({
      lines: [{ slug: 'herb', name: 'Herb', quantity: 30 }],
      dataset,
      books,
    });

    assert.equal(result.total, 3000);
    assert.equal(result.complete, true);
  });

  it('marks the total as incomplete when something has no id', () => {
    const result = priceLines({
      lines: [
        { slug: 'herb', name: 'Herb', quantity: 10 },
        { slug: 'mystery', name: 'Mystery', quantity: 10 },
      ],
      dataset,
      books,
    });

    assert.equal(result.complete, false);
    assert.deepEqual(
      result.unpriced.map((line) => line.name),
      ['Mystery'],
    );
    assert.equal(result.total, 1000);
  });

  it('marks it incomplete when the auction house is short', () => {
    const result = priceLines({
      lines: [{ slug: 'water', name: 'Water', quantity: 10 }],
      dataset,
      books,
    });

    assert.equal(result.complete, false);
    assert.equal(result.priced[0].short, 8);
  });

  it('sorts the biggest cost first', () => {
    const result = priceLines({
      lines: [
        { slug: 'water', name: 'Water', quantity: 2 },
        { slug: 'herb', name: 'Herb', quantity: 30 },
      ],
      dataset,
      books,
    });

    assert.deepEqual(
      result.priced.map((line) => line.name),
      ['Herb', 'Water'],
    );
  });
});

describe('createPriceService', () => {
  const auctions = [{ item: { id: 1 }, unit_price: 100, quantity: 10 }];

  function stubClient() {
    const client = {
      calls: 0,
      async getCommodities() {
        client.calls += 1;
        return { auctions, lastModified: '2026-08-17T10:20:00Z' };
      },
    };
    return client;
  }

  it('is a no-op without credentials', async () => {
    const service = createPriceService({ client: null });

    assert.equal(service.available, false);
    assert.equal(await service.prices([1]), null);
  });

  it('fetches once and serves the rest of the hour from cache', async () => {
    const client = stubClient();
    let clock = at('2026-08-17T10:30:00Z');
    const service = createPriceService({ client, now: () => clock });

    await service.prices([1]);
    clock = at('2026-08-17T11:10:00Z');
    const second = await service.prices([1]);

    assert.equal(client.calls, 1);
    assert.equal(second.books.get(1)[0].price, 100);
    assert.equal(second.age.text, '50 min ago');
  });

  it('fetches again once the refresh has landed', async () => {
    const client = stubClient();
    let clock = at('2026-08-17T10:30:00Z');
    const service = createPriceService({ client, now: () => clock });

    await service.prices([1]);
    clock = at('2026-08-17T11:26:00Z');
    await service.prices([1]);

    assert.equal(client.calls, 2);
  });

  it('fetches again when asked about an item the cache never held', async () => {
    const client = stubClient();
    const clock = at('2026-08-17T10:30:00Z');
    const service = createPriceService({ client, now: () => clock });

    await service.prices([1]);
    await service.prices([1, 2]);

    assert.equal(client.calls, 2);
  });

  it('collapses concurrent callers into one download', async () => {
    const client = stubClient();
    const service = createPriceService({ client, now: () => at('2026-08-17T10:30:00Z') });

    await Promise.all([service.prices([1]), service.prices([1]), service.prices([1])]);

    assert.equal(client.calls, 1);
  });

  it('returns nothing rather than throwing when Blizzard is down', async () => {
    const service = createPriceService({
      client: {
        async getCommodities() {
          throw new Error('502');
        },
      },
      log: { warn() {}, info() {} },
    });

    assert.equal(await service.prices([1]), null);
  });
});
