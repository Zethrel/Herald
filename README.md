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
| `/guilds list\|approve\|revoke\|leave` | The server allowlist. Bot owners only — see below. |
| `/about` | What the bot does. |

Everything except `/about` requires **Manage Server**; `/guilds` additionally
refuses anyone who is not in `OWNER_IDS`.

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
npm test                  # 73 tests, no network needed
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
