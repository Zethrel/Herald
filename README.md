# Herald

A Discord bot for a World of Warcraft raiding guild. It does three things:

1. **Sets the server up** — ranks, categories, channels and their permissions,
   from one command.
2. **Gives every new member a default rank** the moment they join, so nobody
   lands on a server they cannot see.
3. **Hands out Raider and Social by reaction** on a welcome page, which is the
   only channel an unranked member can see.

**Members who already have a rank are never touched.** That rule is enforced in
one place — `src/ranks/membership.js` — and it holds for joins, for the
`/rank backfill` sweep, and for `/setup run` on a server that has been running
for years.

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
| `/about` | What the bot does. |

Everything except `/about` requires **Manage Server**.

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

## Running it

Node 22 or newer. `discord.js` is the only dependency.

```sh
npm install
cp .env.example .env      # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
npm run deploy            # register the slash commands (once, and after changing them)
npm start
```

```sh
npm test                  # 55 tests, no network needed
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
live in `data/guilds.json`, written atomically. Back it up, or the bot will
forget which message to watch and you will need one `/welcome post` to rebind.
Everything else is re-derived from the server itself.

## How it is put together

```
src/
├── blueprint.js       what a set-up server looks like — pure data
├── store.js           per-server settings, JSON on disk
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

MIT. See [LICENSE](LICENSE).
