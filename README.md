# Herald

A Discord bot for a World of Warcraft raiding guild.

1. **Sets the server up** — ranks, categories, channels and their permissions,
   from one command.
2. **Gives every new member a default rank** the moment they join, so nobody
   lands on a server they cannot see.
3. **Hands out Raider and Social by reaction** on a welcome page, which is the
   only channel an unranked member can see.
4. **Takes raid signups**, grouped by role, one click per raider, and pings the
   roster before the raid.
5. **Answers what to bring** — flask, food and potion per spec — and turns a
   roster into a shopping list of reagents, priced off the auction house.

**Members who already have a rank are never touched.** That rule is enforced in
one place — `src/ranks/membership.js` — and it holds for joins, for the
`/rank backfill` sweep, and for `/setup run` on a server that has been running
for years.

**It only runs where it is allowed to.** Herald is private: it works in the
servers on its allowlist and reports itself to its owners anywhere else. See
[Approved servers](#approved-servers) and [Licence](#licence).

> The name is provisional. It lives in exactly one place — `BOT_NAME` in
> `.env`, falling back to `src/branding.js` — so renaming Herald later is one
> line and touches nothing else.

## What a set-up server looks like

`/setup run` creates these ranks, top to bottom:

| Rank | How it is given |
| --- | --- |
| Guild Master | by hand |
| Officer | by hand |
| Raid Leader | by hand |
| **Raider** | ⚔️ on the welcome message |
| Trial | by hand — officers promote into and out of trial |
| **Social** | 🍺 on the welcome message |
| Newcomer | automatically, on join |

and these channels:

- **📜 Information** — `#welcome`, `#rules`, `#announcements`. Visible to
  everyone, read-only. `#welcome` additionally denies *Add Reactions*, so
  members can click the two reactions the bot placed but cannot bury them under
  their own.
- **💬 Guild** — `#general`, `#off-topic`, `#screenshots`, *Guild Hall* voice.
  Social and up.
- **🗡️ Raid** — `#raid-chat`, `#raid-signups`, `#logs-and-parses`, two voice
  channels. Trial and up.
- **🛡️ Officers** — `#officer-chat`, `#applications`, voice. Raid Leader and up.

So an unranked arrival sees Information and nothing else; picking a rank on the
welcome page is what opens the server up.

All of that is data, in [`src/blueprint.js`](src/blueprint.js). Change the
ranks, channels or permissions there and re-run `/setup run` — no other file
needs editing.

## Commands

| Command | What it does |
| --- | --- |
| `/setup run [dry_run] [enforce_permissions]` | Creates whatever is missing, then posts the welcome message. |
| `/setup status` | What is bound, what is missing, when setup last ran. |
| `/welcome post [channel]` | Posts or moves the welcome message. |
| `/welcome refresh` | Rebuilds it in place after a rank or emoji change — existing reactions survive. |
| `/config rank <rank> <role>` | Points a rank at a role the server already has. |
| `/config emoji <rank> <emoji>` | Changes the reaction for a self-serve rank. |
| `/config behaviour ...` | Exclusive ranks on/off, default-rank-removal on/off. |
| `/config view` | The current configuration. |
| `/rank backfill [confirm]` | Gives the default rank to members who have **no** rank at all. Reports and does nothing without `confirm:true`. |
| `/raid create <title> <when>` | Posts a signup for a raid night (Manage Server). |
| `/raid list` · `/raid roster <raid>` | What is on the calendar, and who is coming. |
| `/raid close\|cancel\|delete <raid>` | Stop signups, call it off, or remove it (Manage Server). |
| `/raid timezone <zone>` | The timezone `/raid create` reads times in (Manage Server). |
| `/raid reminders [lead_times] [raid]` | When the roster gets pinged, for the server or one raid (Manage Server). |
| `/consumables spec <spec>` | Flask, food and potion for one spec, with where the answer came from. |
| `/consumables shopping [roster] [raid] [flasks] [food] [potions]` | Rolls a roster up into consumables, crafts and reagents. |
| `/consumables tier` | Which tier the data is for, how complete it is, what is still missing. |
| `/consumables compare [spec]` | What Method says, against the guild's own call. |
| `/consumables report <source> <spec> <slot> <item>` | Record what one guide says (Manage Server). |
| `/consumables set\|clear` | Override a slot for a spec on this server (Manage Server). |
| `/guilds list\|approve\|revoke\|leave` | The server allowlist. Bot owners only — see below. |
| `/about` | What the bot does. |

`/about`, `/consumables` and `/raid` are open to everyone — raiders need to look
up their own flask and see who is coming. The subcommands that change things
(`/consumables set`, `/raid create` and friends) check **Manage Server** in code
instead. Every other command requires **Manage Server**, and `/guilds`
additionally refuses anyone who is not in `OWNER_IDS`.

### Setup is additive, and safe to re-run

`/setup run` only ever creates. It never deletes, renames or reorders anything
it did not make, and it never changes a member's roles.

- A role whose name already matches a rank (`Raider`, `Officer`, …) is
  **adopted**, not duplicated. Case and spacing do not matter.
- A channel is adopted only when it sits in the matching category already.
- Channels that already existed keep their permissions unless you pass
  `enforce_permissions:true`.
- `dry_run:true` prints the plan and changes nothing.

If your ranks are named something else entirely, bind them by hand with
`/config rank` and then run setup — it will keep those bindings.

## Raid signups

`/raid create title:"Mythic progression" when:"2026-08-20 20:00"` posts a signup
in `#raid-signups`:

```
Mythic progression
Thursday, 20 August 2026 20:00 · in 3 days

🛡️ Tanks — 2      💚 Healers — 4     ⚔️ Melee — 6      🏹 Ranged — 8
@ada — Protection  @bo — Holy Priest  @cy — Windwalker  @di — Fire Mage
…

🕗 Late (1): @ed     🪑 Bench (2): @fi, @gu     ❌ Absent (1): @ha

[ ✅ Signed up ] [ 🕗 Late ] [ ❓ Tentative ] [ 🪑 Bench ] [ ❌ Absent ]
[ 🔧 Change spec ]
```

**Signing up is one click** — after the first time. The bot has to know what
someone plays to put them in a role column and to work out their flask, so the
first press asks: class, then spec (two menus, because Discord allows 25 options
per menu and there are 39 specs). That choice is remembered per server, so every
later raid is a single press. *Change spec* revises it, and picking *Absent* or
*Tentative* never asks at all.

The roster is grouped the way a raid leader reads it. Late players are listed
apart from the confirmed roster — they should not be counted on for the first
pull — but they **do** count for consumables, because they still need a flask.
Anyone who signed up without a spec is shown under *Spec not set* rather than
being quietly dropped.

Times are read in the server's timezone (`/raid timezone Europe/Oslo`) and
posted as Discord timestamps, so every raider sees the raid in their own local
time — the guild with members in three countries does not have to do arithmetic.
DST is handled: the same wall-clock time in October and January resolves to
different instants, and there is a test for it.

Signups are stored per server and every change is applied under a per-guild
lock, so twenty people pressing the button in the same second all land.

### Reminders

The roster gets pinged **a day before and an hour before** by default. Change it
per server or per raid:

```
/raid reminders lead_times:"24h, 2h, 30m"
/raid reminders lead_times:"1h" raid:"Mythic progression"
/raid reminders lead_times:"off"
/raid create ... reminders:"3h"
```

The ping names everyone who is signed up or late — being reminded is exactly
what a late raider needs — and anyone still tentative, whose line asks them to
confirm rather than telling them to turn up. Bench and absent are left alone.
Mentions are restricted to that list (`parse: []`), so an `@everyone` typed into
a raid title cannot ping the server.

Two rules make this safe to run unattended:

- **A reminder is sent at most once, ever.** What has been sent is recorded on
  the raid before the message goes out, not after. A crash between the two costs
  one reminder; the other order costs everyone a duplicate ping every minute
  until it succeeds.
- **A reminder that is too late is dropped, not sent.** If the bot is offline
  when one comes due it will still send up to 30 minutes late, but never after
  the raid has started — a bot that was down for three hours must not wake up
  and announce a raid that is already pulling. Missed ones are closed out so
  they cannot fire later.

**Short notice still gets one ping.** A raid announced two hours before the pull
has every lead time already behind it, and saying nothing would be exactly
backwards — short notice is when people most need telling. So a raid that has
never been reminded, has not started, and has run out of lead times gets exactly
one ping straight away, titled *starting soon* rather than claiming to be the
hour-before one. The same rule covers the bot having been offline through every
window: nobody was told, the raid is soon, one ping is the right answer. A raid
that already got a reminder does not get a second one this way.

It runs as a minute ticker rather than a timer per raid: timers do not survive a
restart, and a raid posted three weeks out would need one held for three weeks.
Everything a tick needs is in the store, so the process can stop and start
whenever and the answer is the same. Nothing is sent for a cancelled raid, a
raid nobody signed up to, or a server that is not on the allowlist.

### It feeds the shopping list

```
/consumables shopping raid:"Mythic progression"
```

That takes the actual roster — everyone signed up or late, counted by spec — and
runs it through the shopping list below, prices and all. Nobody types
`4x fire mage` by hand. People who signed up without setting a spec are named in
the reply, because a shopping list that silently misses three raiders is worse
than one that says so.

## Consumables

```
/consumables spec fire mage
  Flask     — Flask of <x> (wowhead)
  Food buff — <x>
  Potion    — <x>            (intellect default)
  Tier: <tier> · Source: <link>

/consumables shopping roster:"4x fire mage, 2 holy priest, 3 prot warr" flasks:2
  Consumables   18× Flask of <x>, 36× <food>, …
  Crafts         9× Flask of <x> (yields 2, 1 spare)
  Reagents      27× <herb>, 9× <herb>
```

The roster parser takes what people actually type — `4x fire mage`, `2 holy
priest`, `boomkin`, `ww monk`, `prot warr` — and the spec option has type-ahead.
Anything it cannot read comes back in the reply rather than being silently
dropped, and anything ambiguous is refused outright: `frost` is a Mage and a
Death Knight, and guessing puts the wrong flask in someone's bags.

The crafting maths is the part worth trusting it for. Recipes yield more than
one flask per craft, so reagents are counted by whole crafts: 9 flasks from a
recipe that yields 2 is 5 crafts, 15 of the first herb, and one flask spare.

### Where the answers come from

**Herald does not know what the current tier wants, and does not pretend to.**
Everything above is driven by [`tiers/current.json`](tiers/current.json), which
ships empty. An unfilled slot renders as *not set for this tier* — never as a
plausible-looking guess, because a guessed reagent list costs real gold.

The file has four parts:

| Key | What it holds |
| --- | --- |
| `items` | slug → name, item id (drives the Wowhead links) |
| `reports` | what Method says, per spec — see *What Method says* |
| `recipes` | slug → profession, yield, reagents. This is what makes the shopping list possible |
| `defaults` | per primary stat (`intellect`, `agility`, `strength`) and per role (`healer`, `tank`) |
| `specs` | per spec, when a spec departs from its stat's default |

Answers resolve most specific first: **this server's override → the spec's own
entry → what Method says → its primary stat → its role.** So one
`intellect` entry answers for all nineteen intellect specs, and you only write a
spec entry where a spec actually differs. `/consumables spec` says which of
those a given answer came from, so a raider can see when they are reading a
class-wide default rather than something set for them.

Provenance is part of the format, not decoration. `updatedAt` and `sources`
drive a staleness warning after `staleAfterDays` (90 by default), and undated
data counts as stale — "we don't know when this was written" is not reassuring
the night before a progression pull. `/consumables tier` reports coverage and
lists what is still unanswered.

Officers can also fix one spec without touching the file: `/consumables set spec:fire mage
slot:flask item:... source:...` overrides it for that server only, and
`/consumables clear` puts it back.

### What Method says

Herald follows one guide: [Method](https://www.method.gg/). Icy Veins and
Wowhead were considered and dropped, and the reason is recorded in
`src/sources/registry.js` so nobody re-litigates it: both mint a **new URL every
tier**, so there is no stable page to follow. A source needs a durable address
before it can be tracked by pattern — Method's `/guides/<spec>-<class>/` has
one, theirs do not.

```
/consumables compare spec:fire mage
  Method · read the guide

  Flask     — ℹ️ only one source
    Method: Flask of <x> (source) · 3 days ago
  Food buff — ⚠️ they disagree
    Method:      <x> (source)
    Our own call: <y>
  Combat potion — nobody has said

/consumables compare          → every spec where the guild differs from Method
```

Alongside Method there is a second "source": **the guild's own call**. It exists
so that a decision to depart from the guide is *visible* rather than silent —
`/consumables compare` with no spec lists exactly where the two differ.

**Where Method is the only voice, Herald uses it.** It sits above the generic
stat defaults in the chain, since a guide that looked at this exact spec beats
"all intellect casters use X", and below anything a person wrote deliberately.

**Where a recorded guild view contradicts it, Herald picks neither** and falls
through to the tier file's own defaults. Recording a disagreement *marks* it; it
does not decide it. To actually decide, use `/consumables set` — that is an
override and outranks everything.

Every quoted line keeps Method's name, the page URL and when it was read. This
is someone else's editorial judgement; Herald repeats it with attribution rather
than absorbing it.

### Getting it in

`/consumables report source:method spec:fire mage slot:flask item:"…" url:…`
records one answer for one spec, on one server. That works today and needs
nothing external. For bulk, fill the `reports` section of the tier file — the
shape is in [`tiers/example.json`](tiers/example.json).

**Guide links are derived from the pattern.** Method organises its pages as
`method.gg/guides/<spec>-<class>/stats-races-and-consumables`, so
`/consumables compare` links straight to the right page for all 39 specs, whether
or not anyone has recorded an answer yet. Deriving those is safe in a way
guessing selectors is not: a wrong URL 404s loudly and is fixed with one line in
`METHOD_OVERRIDES`, while a wrong selector returns the wrong flask and says
nothing.

Four slugs were checked by hand; the rest follow the pattern and render as
*unverified link* until `npm run check-guides` says otherwise. That script
requests each URL once, a second apart, reads no page content, and prints the
confirmed slugs to paste back plus any 404s needing an override. It separates a
404 (the slug is wrong) from a 403 or 5xx (the network is in the way) and stops
outright when nothing gets through — turning a proxy block into a list of
"corrections" would be worse than no answer.

**There is still no scraper, deliberately.** Reading the recommendation off the
page needs HTML selectors, and those can only be written against real markup and
re-verified whenever Method reworks its templates. Selectors written blind would
look right, break silently mid-tier, and be discovered on raid night — the exact
failure this file exists to prevent. When it is worth automating, the honest
path is a small fetcher checked against a live page, writing into `reports`
exactly as the manual command does; everything downstream of that point already
works.

The file is read once at startup, so editing it means a restart — the same cost
as editing `.env`. [`tiers/example.json`](tiers/example.json) shows the shape
filled in, with invented item names.

### Filling in the facts: `npm run sync-tier`

The judgement half — which flask a spec wants — is yours. The facts half is
Blizzard's, and the sync fetches it from their Game Data API:

```sh
npm run sync-tier -- --dry     # show what it would do
npm run sync-tier              # write it back
```

You write a name and a flag:

```json
"items": { "flask-of-x": { "name": "Flask of X", "craft": true } }
```

and it fills in the item id, finds the recipe, and writes the craft yield, the
reagents and an item entry for each reagent it had not seen before. Re-run it
after a patch and it picks up changed reagents and yields.

It never writes to `specs`, `defaults`, `sources` or your notes, and it never
overwrites something you set by hand: pin an item id yourself and a search that
disagrees is reported rather than applied. A variable-yield recipe is taken at
its **minimum**, because a shopping list built on the lucky outcome sends
someone back to the auction house mid-raid.

Credentials are free — create a client at
[develop.battle.net](https://develop.battle.net) and put `BLIZZARD_CLIENT_ID`
and `BLIZZARD_CLIENT_SECRET` in `.env`.

### What it costs

With those credentials set, `/consumables shopping` also prices itself off the
**region-wide commodity auction house** — which is where every flask, potion,
feast and herb is sold, so there is no realm to configure.

```
Cost at current prices
  84,120g 00s
  31,500g — 630× <herb>
  22,400g — 280× <herb>
  …
Prices
  Region-wide commodities, snapshot 37 min ago.
```

The quoted price is what buying that quantity actually costs, walked up the
order book — not the cheapest listing, which is a lie the moment it is a single
unit with the next thousand at triple. When the auction house cannot supply the
quantity, the total is labelled a floor and the line says how many are listed.

**Blizzard regenerates this data hourly, at 20 minutes past.** The bot knows
that: it fetches at most once per refresh and caches until 25 past the next
hour, so a second `/consumables shopping` in the same hour is free, and the age
shown next to the total comes from the snapshot's own `Last-Modified` rather
than from a guess. Concurrent callers share one download — the feed is tens of
megabytes.

If you schedule `sync-tier`, run it at `25 * * * *` for the same reason: after
the refresh has landed, not on top of it.

Without credentials none of this exists and nothing else changes — no errors, no
degraded commands, just no prices.

## Approved servers

Herald is not public. The licence says who may use it; this is the half that
enforces it while the bot is running, because Discord itself offers no way to
stop someone adding a bot to a server they own.

**The allowlist is `APPROVED_GUILDS` in `.env`, plus whatever `/guilds approve`
has added.** An empty allowlist approves *nothing* — it does not mean "allow
everything". In any server that is not on it, the bot:

1. works out who invited it, from that server's audit log where it can;
2. DMs every id in `OWNER_IDS` — and posts to `ALERT_WEBHOOK_URL` if set —
   with the server name, id, member count, server owner and inviter;
3. leaves immediately. Set `UNAPPROVED_SERVER_ACTION=report` to have it stay
   instead, in which case every command there is refused.

That check runs on invite **and at every startup**, which is what catches a
server the bot was added to while it was offline: no join event is waiting for
it when it comes back, so it re-checks the whole list itself. Being removed
from a server that *is* approved is reported too, so a quiet removal does not
go unnoticed.

```
/guilds list                          every server the bot is in, ✅ or ⚠️
/guilds approve <server_id> [note]     let it work there
/guilds revoke  <server_id> [stay]     take it off the list, and leave
/guilds leave   <server_id>            leave without changing the list
```

Only the ids in `OWNER_IDS` may run those; anyone else gets a refusal. Entries
that came from `APPROVED_GUILDS` cannot be revoked by command — the deployment's
own list wins over a runtime one, so a stolen owner account cannot quietly
widen it.

Server ids come from Discord's *Copy Server ID* (enable Developer Mode in
Settings → Advanced), or straight out of the alert you were sent.

**Put your own server in `APPROVED_GUILDS` before the first start.** `/guilds`
is a slash command, so it has to be run from a server the bot is in — start with
an empty allowlist and the default action and the bot will dutifully leave
everywhere, including the server you meant to run it from.

Two things to know about the alerts. A bot can only DM someone it shares a
server with, so an owner who is not in one of the bot's servers will never get
the DM — set `ALERT_WEBHOOK_URL` as well and the alert lands in a channel
regardless. And the *added by* line comes from the other server's audit log,
which needs View Audit Log there; without it the alert still arrives, with the
inviter listed as unknown.

## Running it

Node 22 or newer. `discord.js` is the only dependency.

```sh
npm install
cp .env.example .env      # DISCORD_TOKEN, DISCORD_CLIENT_ID, OWNER_IDS are required
npm run deploy            # register the slash commands (once, and after changing them)
npm start
```

It refuses to start without `OWNER_IDS`: a bot that cannot tell anyone about an
unapproved invite is worse than one that will not boot.

```sh
npm test                  # 255 tests, no network needed
```

### Discord Developer Portal

1. **Bot → Privileged Gateway Intents**: turn on **Server Members Intent**.
   Without it Discord never tells the bot about a join, and the default rank
   never gets handed out. *Message Content* is not needed.
2. **Installation / OAuth2 → scopes**: `bot` and `applications.commands`.
3. Permissions: Manage Roles, Manage Channels, View Channels, Send Messages,
   Embed Links, Add Reactions, Read Message History, Manage Messages.
   (*Manage Messages* is what lets the bot pull a member's stale reaction off
   the welcome message when they switch rank.)

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=268528720
   ```

4. **Drag the bot's role above every rank it manages** in Server Settings →
   Roles. Discord refuses to let any bot hand out a role that sits above its
   own, and `/setup run` will tell you so rather than failing halfway.

### State

Per-server settings — which role is which rank, where the welcome message is —
live in `data/guilds.json`, written atomically, alongside the runtime half of
the allowlist. Back it up: losing it means the bot forgets which message to
watch (one `/welcome post` rebinds it) and forgets every approval made with
`/guilds approve`. Approvals in `APPROVED_GUILDS` survive regardless, which is
the argument for keeping the servers that matter in the environment file.

## How it is put together

```
src/
├── blueprint.js       what a set-up server looks like — pure data
├── store.js           per-server settings and the allowlist, JSON on disk
├── access/            which servers may run the bot, and telling you when one may not
├── consumables/       the tier file, spec resolution and the shopping list (pure)
├── game/              the class and specialisation catalogue — data
├── sources/           what each guide recommends, and how they compare (pure)
├── sync/              the Blizzard API client, the refresh cadence, the transforms
├── prices/            commodity auction pricing, cached per hourly refresh
├── raids/             raid nights, signups, roster and reminders (model, time,
│                     reminder scheduling all pure)
├── plan/              diff the blueprint against a live server (pure)
├── apply/             execute the diff
├── ranks/             who gets which rank, and when (pure)
├── welcome.js         the landing page embed and its reactions
├── commands/          slash commands
└── events/            gateway handlers
```

The decisions are all in the pure modules under `plan/` and `ranks/`: they take
a snapshot (role ids, emoji, a config object) and return what should happen.
The `apply/` and `events/` layers do the talking to Discord. That split is why
the test suite can cover rank exclusivity, adoption of existing roles and the
"existing members keep their rank" rule without a gateway connection.

### One thing worth knowing if you change the reaction handling

When ranks are exclusive, picking ⚔️ while holding Social removes the Social
role *and* the member's 🍺 reaction. Removing that reaction makes Discord fire
`messageReactionRemove`, which is the same event as a member deliberately
handing a rank back. The roles are therefore applied **before** the reaction is
pulled: by the time the remove event arrives the member no longer holds Social,
so `planReactionRemove` returns `already-absent` and does nothing. Reverse that
order and the bot fights itself. There is a test named after this case.

## Licence

**Not open source.** Source-available: you can read this repository, and that is
all reading it grants you. Running Herald — or a modified or re-branded copy of
it — requires a written grant from the copyright holder, and that grant can be
withdrawn. No redistribution, no resale, no hosting it for anyone else.

See [LICENSE](LICENSE) for the terms, and *Approved servers* above for how the
bot holds the same line at runtime.
