#!/usr/bin/env node
//
// Fill the tier file's facts from Blizzard's Game Data API.
//
//   npm run sync-tier            write the results back
//   npm run sync-tier -- --dry   print what it would do and change nothing
//
// You write the names; this fills in item ids, and for anything marked
// "craft": true it fetches the recipe and writes the yield and reagents.
// It never touches `specs`, `defaults`, `sources` or your notes -- those are
// judgement, and no API knows them.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createBlizzardClient, readBlizzardEnv } from '../src/sync/blizzard.js';
import { itemsNeedingIds, itemsToCraft, applySyncResults, recipeToEntry, summarize } from '../src/sync/tierSync.js';
import { normalizeDataset } from '../src/consumables/dataset.js';

const dryRun = process.argv.includes('--dry') || process.argv.includes('--dry-run');
const tierFile = resolve(process.env.TIER_FILE?.trim() || 'tiers/current.json');

let credentials;
try {
  credentials = readBlizzardEnv();
} catch (error) {
  // A missing key is a setup problem, not a crash: say so in one line.
  console.error(error.message);
  process.exit(1);
}

const client = createBlizzardClient(credentials);

const dataset = normalizeDataset(JSON.parse(await readFile(tierFile, 'utf8')));
const results = [];

const pending = itemsNeedingIds(dataset);
const craftable = itemsToCraft(dataset);

if (pending.length === 0 && craftable.length === 0) {
  console.log(
    `Nothing to do. Add entries to "items" in ${tierFile} — a name is enough, and "craft": true also pulls the recipe.`,
  );
  process.exit(0);
}

console.log(`${credentials.region.toUpperCase()} · ${pending.length} id(s) to find, ${craftable.length} recipe(s) to fetch\n`);

for (const { slug, name } of pending) {
  const item = await client.findItemByName(name);
  if (!item) {
    results.push({ kind: 'miss', slug, reason: `no item named "${name}"` });
    console.log(`  ✗ ${slug} — no item named "${name}"`);
    continue;
  }
  results.push({ kind: 'itemId', slug, itemId: item.id, name });
  console.log(`  ✓ ${slug} → ${item.id}`);
}

for (const { slug, name, recipeId } of craftable) {
  // A recipe is usually named after what it makes, but an explicit recipeId in
  // the file always wins -- that is how you pin down a name Blizzard reuses.
  const found = recipeId ? { id: recipeId } : await client.findRecipeByName(name);
  if (!found) {
    results.push({ kind: 'miss', slug, reason: `no recipe named "${name}"` });
    console.log(`  ✗ ${slug} — no recipe named "${name}"`);
    continue;
  }

  const entry = recipeToEntry(await client.getRecipe(found.id), { locale: 'en_US' });
  if (!entry) {
    results.push({ kind: 'miss', slug, reason: `recipe ${found.id} lists no reagents` });
    console.log(`  ✗ ${slug} — recipe ${found.id} lists no reagents`);
    continue;
  }

  results.push({ kind: 'recipe', slug, ...entry });
  console.log(
    `  ✓ ${slug} — yields ${entry.recipe.yield}, ${entry.recipe.reagents.length} reagent(s)`,
  );
}

const { dataset: next, report } = applySyncResults(dataset, results);

console.log(`\n${summarize(report).join('\n')}`);

for (const conflict of report.conflicts) {
  console.log(`  ! ${conflict.slug}: kept your id ${conflict.kept}, the search found ${conflict.found}`);
}
for (const miss of report.misses) {
  console.log(`  ! ${miss.slug}: ${miss.reason}`);
}

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

// Only the facts changed, so the date reflects that. Whoever edits the
// judgement half should set it themselves.
next.syncedAt = new Date().toISOString();

await writeFile(tierFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`\nWrote ${tierFile}`);
