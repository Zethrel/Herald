#!/usr/bin/env node
//
// Turn a class-by-class consumable table into tier text.
//
//   npm run import-table -- tiers/sources/spec-consumables.md \
//     --prelude tiers/defaults.txt --out tiers/current.txt
//
// Without --out it prints, so you can see what it made of the table before it
// overwrites anything. Then load the result into the bot:
//
//   npm run import-tier -- tiers/current.txt --dry
//   npm run import-tier -- tiers/current.txt
//
// The reading and converting is in src/consumables/table.js; this is the half
// that touches the disk.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { convertTable, isFatal, parseTable, toTierText } from '../src/consumables/table.js';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};

const outFile = flag('--out');
const preludeFile = flag('--prelude');
const input = args.find((arg) => !arg.startsWith('--') && arg !== outFile && arg !== preludeFile);

if (!input) {
  console.error(
    'Usage: npm run import-table -- <table.md> [--prelude tiers/defaults.txt] [--out tiers/current.txt]',
  );
  process.exit(1);
}

const rows = parseTable(await readFile(resolve(input), 'utf8'));
const { entries, problems } = convertTable(rows);

const prelude = preludeFile ? await readFile(resolve(preludeFile), 'utf8') : '';
const body = toTierText(entries);
const output = prelude ? `${prelude.replace(/\n+$/, '')}\n\n${body}\n` : `${body}\n`;

if (outFile) {
  await writeFile(resolve(outFile), output, 'utf8');
  console.error(`Wrote ${entries.length} spec line(s) to ${outFile}`);
} else {
  console.log(output);
}

console.error(`\n${entries.length} of ${rows.length} row(s) converted.`);

if (problems.length > 0) {
  console.error(`\n${problems.length} thing(s) worth a look:`);
  for (const problem of problems) console.error(`  ${problem}`);
}

// A row that could not be placed is data lost, and the exit code should say so.
process.exit(problems.some(isFatal) ? 1 : 0);
