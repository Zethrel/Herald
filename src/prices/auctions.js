// Reading the commodity auction house.
//
// Pure. The input is Blizzard's auction array, the output is one number per
// item, and the choice of *which* number is the opinionated part: the cheapest
// listing is a lie when it is a single unit and the next thousand cost triple.
// So the price quoted is what it actually costs to buy the quantity wanted,
// walked up the order book.

/** Copper is the API's unit. Everything else is presentation. */
export function formatMoney(copper) {
  if (copper == null) return '—';
  const total = Math.round(copper);
  const gold = Math.floor(total / 10_000);
  const silver = Math.floor((total % 10_000) / 100);

  if (gold > 0) return `${gold.toLocaleString('en-GB')}g ${String(silver).padStart(2, '0')}s`;
  if (silver > 0) return `${silver}s ${total % 100}c`;
  return `${total}c`;
}

/**
 * Group the auction feed into a per-item order book, cheapest first.
 *
 * @param {Array<{item?: {id: number}, unit_price?: number, quantity?: number}>} auctions
 * @param {Set<number>|number[]} [wanted] item ids to keep; everything else is
 *   dropped, because the full feed is millions of rows and we need dozens.
 */
export function buildOrderBook(auctions, wanted = null) {
  const keep = wanted ? new Set(wanted) : null;
  /** @type {Map<number, Array<{price: number, quantity: number}>>} */
  const books = new Map();

  for (const auction of auctions ?? []) {
    const itemId = auction?.item?.id;
    if (itemId == null) continue;
    if (keep && !keep.has(itemId)) continue;

    const price = auction.unit_price;
    const quantity = auction.quantity ?? 0;
    if (price == null || quantity <= 0) continue;

    const book = books.get(itemId) ?? [];
    book.push({ price, quantity });
    books.set(itemId, book);
  }

  for (const book of books.values()) book.sort((a, b) => a.price - b.price);
  return books;
}

/**
 * What buying `quantity` of an item actually costs, walking the book.
 *
 * @returns {{total: number, unitAverage: number, cheapest: number, available: number, short: number}|null}
 */
export function costToBuy(book, quantity) {
  if (!book || book.length === 0 || quantity <= 0) return null;

  let remaining = quantity;
  let total = 0;
  let available = 0;

  for (const listing of book) {
    available += listing.quantity;
    if (remaining <= 0) continue;
    const taken = Math.min(remaining, listing.quantity);
    total += taken * listing.price;
    remaining -= taken;
  }

  const bought = quantity - remaining;

  return {
    total,
    unitAverage: bought > 0 ? total / bought : book[0].price,
    cheapest: book[0].price,
    available,
    // More than the auction house is holding. Worth saying out loud before
    // someone plans a raid week around it.
    short: remaining,
  };
}

/**
 * Price a shopping list's reagents (and anything with no recipe, which has to
 * be bought outright).
 *
 * @param {object} input
 * @param {Array<{name: string, quantity: number, slug?: string|null}>} input.lines
 * @param {object} input.dataset the tier file, for slug -> item id
 * @param {Map<number, Array>} input.books
 */
export function priceLines({ lines, dataset, books }) {
  const priced = [];
  const unpriced = [];
  let total = 0;
  let complete = true;

  for (const line of lines) {
    const itemId = line.slug ? dataset.items?.[line.slug]?.itemId ?? null : null;
    const cost = itemId != null ? costToBuy(books.get(itemId), line.quantity) : null;

    if (!cost) {
      // No id, or nothing listed. Either way the total is a floor, not a price.
      unpriced.push(line);
      complete = false;
      continue;
    }

    total += cost.total;
    if (cost.short > 0) complete = false;
    priced.push({ ...line, itemId, ...cost });
  }

  return {
    priced: priced.sort((a, b) => b.total - a.total),
    unpriced,
    total,
    // False when something could not be priced or the house cannot supply it:
    // the caller must not present the total as the whole bill.
    complete,
  };
}
