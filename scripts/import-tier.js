#!/usr/bin/env node
//
// Fill the tier file from a plain text file.
//
//   npm run import-tier -- tiers/current.txt
//   npm run import-tier -- tiers/current.txt --dry
//   npm run import-tier -- tiers/current.txt --source method
//
// Without --source the lines become the guild's own data (`defaults` and
// `specs`). With `--source method` the spec lines are recorded as what Method
// says instead, complete with the guide URL, and default lines are refused --
// Method publishes a page per spec, not a ruling on "all intellect casters".
//
// Run `npm run sync-tier` afterwards to fill in item ids, craft yields and
// reagents from Blizzard.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { applyImport, applyImportAsReport, parseTierText } from '../src/consumables/import.js';
import { guideUrl } from '../src/sources/urls.js';
import { normalizeDataset } from '../src/consumables/dataset.js';
import { sourceById } from '../src/sources/registry.js';
import { specByKey } from '../src/game/specs.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const sourceIndex = args.indexOf('--source');
const sourceId = sourceIndex === -1 ? null : args[sourceIndex + 1];
const input = args.find((arg) => !arg.startsWith('--') && arg !== sourceId);

if (!input) {
  console.error('Usage: npm run import-tier -- <file.txt> [--source method] [--dry]');
  process.exit(1);
}

if (sourceId && !sourceById(sourceId)) {
  console.error(`Unknown source "${sourceId}".`);
  process.exit(1);
}

const tierFile = resolve(process.env.TIER_FILE?.trim() || 'tiers/current.json');
const parsed = parseTierText(await readFile(resolve(input), 'utf8'));

for (const error of parsed.errors) {
  console.error(`  line ${error.line}: ${error.reason}\n    ${error.text}`);
}

const defaultCount = Object.keys(parsed.defaults).length;
const specCount = Object.keys(parsed.specs).length;

if (defaultCount + specCount === 0) {
  console.error('\nNothing to import — every line was blank, a comment, or unreadable.');
  process.exit(1);
}

if (sourceId && defaultCount > 0) {
  console.error(
    `\nRefusing to record ${defaultCount} default line(s) as ${sourceById(sourceId).name}: a guide publishes a page per spec, not a ruling on "all intellect casters". Import those without --source, or write them out per spec.`,
  );
  process.exit(1);
}

const dataset = normalizeDataset(JSON.parse(await readFile(tierFile, 'utf8')));

const next = sourceId
  ? applyImportAsReport(dataset, parsed, {
      sourceId,
      urlFor: (specKey) => guideUrl(sourceId, specByKey(specKey)),
    })
  : applyImport(dataset, parsed);

const newItems = Object.keys(parsed.items).filter((slug) => !dataset.items?.[slug]);

console.log(
  [
    '',
    sourceId ? `Recording as ${sourceById(sourceId).name}:` : 'Recording as the guild\'s own data:',
    `  ${defaultCount} default(s): ${Object.keys(parsed.defaults).join(', ') || '—'}`,
    `  ${specCount} spec exception(s): ${Object.keys(parsed.specs).join(', ') || '—'}`,
    `  ${newItems.length} new item(s): ${newItems.join(', ') || '—'}`,
    parsed.errors.length > 0 ? `  ${parsed.errors.length} line(s) skipped, listed above` : '',
  ]
    .filter(Boolean)
    .join('\n'),
);

if (dryRun) {
  console.log('\nDry run — nothing written.');
  process.exit(0);
}

await writeFile(tierFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`\nWrote ${tierFile}\nNow run \`npm run sync-tier\` to fill in item ids, yields and reagents.`);
