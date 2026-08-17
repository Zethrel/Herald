#!/usr/bin/env node
//
// Check the derived guide URLs against the live site.
//
//   npm run check-guides
//
// Every spec's URL is requested once, politely and in sequence, and the result
// printed. Anything that is not 200 is either a spec the guide does not cover
// or a slug that breaks the pattern -- either way it comes out as a line you
// can paste into METHOD_OVERRIDES in src/sources/urls.js.
//
// This is what turns derived URLs into confirmed ones. It is not a scraper: it
// reads no page content, only whether the page is there.

import { allMethodGuides, METHOD_CONFIRMED } from '../src/sources/urls.js';

const USER_AGENT =
  process.env.GUIDE_USER_AGENT ??
  'HeraldBot/0.1 (private WoW guild Discord bot; link checker; contact via repository owner)';

// One request every second or so. There are 39 of them; there is no hurry, and
// hammering someone else's site to save half a minute is rude.
const DELAY_MS = Number(process.env.GUIDE_CHECK_DELAY_MS ?? 1200);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = { ok: [], missing: [], blocked: [], failed: [] };

console.log(`Checking ${allMethodGuides().length} Method guide URLs, one every ${DELAY_MS}ms\n`);

for (const entry of allMethodGuides()) {
  const label = `${entry.spec.name} ${entry.spec.className}`.padEnd(28);

  try {
    // HEAD first: it is the cheapest thing to ask for. Some sites do not
    // implement it, so a 405 falls back to a GET.
    let response = await fetch(entry.url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT } });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(entry.url, { headers: { 'user-agent': USER_AGENT } });
    }

    if (response.ok) {
      results.ok.push(entry);
      console.log(`  ✓ ${label} ${entry.confirmed ? '(already confirmed)' : ''}`);
    } else if (response.status === 404 || response.status === 410) {
      // The only status that actually means "this slug is wrong, or Method does
      // not cover this spec".
      results.missing.push({ ...entry, status: response.status });
      console.log(`  ✗ ${label} ${response.status} — ${entry.url}`);
    } else {
      // 403 from a corporate proxy, 429, a 5xx: says nothing about the slug.
      // Reporting these as "not found" would produce a list of overrides that
      // are all wrong, which is worse than no answer.
      results.blocked.push({ ...entry, status: response.status });
      console.log(`  ? ${label} ${response.status} — blocked or unavailable, tells us nothing`);
    }
  } catch (error) {
    results.failed.push({ ...entry, reason: error.message });
    console.log(`  ! ${label} ${error.message}`);
  }

  await sleep(DELAY_MS);
}

console.log(
  `\n${results.ok.length} reachable, ${results.missing.length} not found, ${results.blocked.length} blocked, ${results.failed.length} errored.`,
);

// Everything blocked means the network is the problem, not the slugs. Say so
// plainly rather than letting someone read it as "Method deleted their guides".
if (results.ok.length === 0 && results.blocked.length + results.failed.length === allMethodGuides().length) {
  console.log(
    '\nNothing got through at all — that is this machine\'s network or proxy, not the site.\n' +
      'Run it somewhere with direct access before changing any slugs.',
  );
  process.exit(2);
}

const newlyConfirmed = results.ok.filter((entry) => !METHOD_CONFIRMED.has(entry.slug));
if (newlyConfirmed.length > 0) {
  console.log('\nPaste into METHOD_CONFIRMED in src/sources/urls.js:\n');
  for (const entry of newlyConfirmed) console.log(`  '${entry.slug}',`);
}

if (results.blocked.length > 0) {
  console.log(`\n${results.blocked.length} could not be judged either way — re-run those later.`);
}

if (results.missing.length > 0) {
  console.log('\nThese returned 404 and need a real slug in METHOD_OVERRIDES (spec key -> slug):\n');
  for (const entry of results.missing) console.log(`  '${entry.spec.key}': '',  // ${entry.url}`);
}

process.exit(results.failed.length > 0 || results.missing.length > 0 ? 1 : 0);
