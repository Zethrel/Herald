# Raids and consumables, nothing else

The bot also builds ranks, categories, channels and a welcome page. A guild that
already has its own server wants none of that. This is the short version: four
things once, then two commands a raid night.

Everything here is optional to skip — `/raid create` falls back to the channel
you run it in, so none of the setup machinery has to run first.

## What you can ignore

| Command | What it is for |
| --- | --- |
| `/setup run` | Builds ranks, categories and channels from scratch. You already have yours. |
| `/config` | Binds the bot's rank and channel slots to roles you already have. Only matters if you use the ranks. |
| `/rank` | Hands ranks out by hand. |
| `/welcome` | Posts the react-for-a-rank landing page. |
| `/guilds` | The allowlist. Owner-only, and not yours to run. |

## Once, before the first raid

**1. Invite the bot with the smaller permission set.** Skipping `/setup` means
skipping everything it needs — no Manage Roles, no Manage Channels, no voice
permissions.

```
&permissions=85120
```

That is View Channel, Send Messages, Embed Links, Read Message History, plus
View Audit Log. [Which permissions are negotiable](#which-permissions-are-negotiable)
breaks down every box the invite prompt ticks.

**2. Register the commands.**

```
npm run deploy
```

Without this the commands never appear. Global registration can take up to an
hour to spread.

**3. Set the timezone.**

```
/raid timezone zone:Europe/Oslo
```

This is the one that bites. The default is UTC, so a raid typed as `21:00` is
posted as 21:00 UTC — 23:00 for a European guild, on the wrong side of a raid
night. Set it before anyone signs up to anything.

**4. Put the consumables board somewhere.**

```
/consumables board post channel:#consumables
```

One message the bot owns and edits from then on. It follows the roster: as
people sign up, their spec's food, flask and potion appear on it. Nobody has to
run it again.

## A raid night

| | |
| --- | --- |
| **Announce** | `/raid create title:Heroic clear when:2026-08-28 20:00` — posts the signup with its buttons |
| **Raiders** | Press the buttons on that post and pick their spec. No commands for them to learn |
| **Automatic** | The board rewrites itself on every signup, and the roster gets pinged before the raid |
| **Shopping** | `/consumables shopping raid:Heroic clear` — totals the roster into flasks, feasts and the reagents to craft them |
| **Afterwards** | `/raid close` — keeps the roster, stops signups, and drops the raid off the board |

What the board looks like with ten people on it:

```
Raid consumables — current tier

Most specs — 🛢️ Thalassian Phoenix Oil
🍖 food buff · 🧪 flask · ⚗️ combat potion · 🛢️ weapon oil · ×N how many are bringing it

Chimaerus — heroic
Friday, 28 August 2026 20:00 · in 6 days

🛡️ Blood Death Knight          💚 Holy Priest
🍖 Harandar Celebration        🍖 Royal Roast
🧪 Flask of the Shattered Sun  🧪 Flask of the Shattered Sun
⚗️ Potion of Recklessness      ⚗️ Light's Potential
```

Discord stacks those in one column; they are paired here to fit the page. The
weapon oil is not repeated ten times — anything every spec answers the same way
is hoisted to the line at the top.

## Raid commands

| Command | What it does | Who |
| --- | --- | --- |
| `/raid create` | Post a signup for a raid night | Manage Server |
| `/raid list` | Upcoming raids | anyone |
| `/raid roster` | Who is signed up to one raid | anyone |
| `/raid close` | Stop taking signups, keeping the roster. `reopen:true` undoes it | Manage Server |
| `/raid cancel` | Call the raid off | Manage Server |
| `/raid delete` | Remove a raid and its signups entirely | Manage Server |
| `/raid timezone` | The timezone `/raid create` reads times in | Manage Server |
| `/raid reminders` | When the roster gets pinged — `"24h, 1h"`, `"30m"`, or `off` | Manage Server |

## Consumables commands

### Everyday

| Command | What it does | Who |
| --- | --- | --- |
| `/consumables spec` | What one spec should be carrying | anyone |
| `/consumables shopping` | A roster rolled up into consumables and reagents, priced if Blizzard keys are set | anyone |
| `/consumables tier` | Which tier the data is for, and what is still missing from it | anyone |
| `/consumables compare` | What each guide says, side by side | anyone |

### The board

| Command | What it does | Who |
| --- | --- | --- |
| `/consumables board post` | Post it in a channel and keep it current | Manage Server |
| `/consumables board refresh` | Re-render now — after editing the tier file and restarting | Manage Server |
| `/consumables board remove` | Stop updating it. The message stays where it is | Manage Server |

### Correcting the data

| Command | What it does | Who |
| --- | --- | --- |
| `/consumables set` | Override one slot for one spec on this server | Manage Server |
| `/consumables secondary` | Which secondary stat a spec stacks — this is what picks its flask | Manage Server |
| `/consumables clear` | Drop an override, falling back to the tier file | Manage Server |
| `/consumables report` | Record what one guide says, for `compare` to weigh | Manage Server |

Anything set here edits the board immediately. There is no separate refresh step.

## Which permissions are negotiable

The invite prompt asks for a long list, and most of it can go. What a server can
safely untick comes down to one question: is the bot going to build channels and
ranks with `/setup run`, or only run raids and consumables?

### Must stay — four

| Permission | What breaks without it |
| --- | --- |
| View Channels | Cannot see the channel it is meant to post in |
| Send Messages | No raid signups, no board, no reminders |
| Embed Links | Everything it sends is an embed. Discord strips them, and the bot appears to post nothing at all |
| Read Message History | Cannot fetch its own board or raid post back to edit it. Signups stop updating after a restart |

### Only for `/setup run` — untick all of these otherwise

**Manage Roles** and **Manage Channels** create the ranks and channels. The rest
look alarming and are worth explaining, because *the bot never uses them
itself*:

> Send Messages in Threads · Create Public Threads · Create Private Threads ·
> Attach Files · Use External Emoji · Connect · Speak · Video · Use Voice Activity

Discord only lets a bot **grant** a permission in a channel overwrite that it
holds itself. `/setup run` writes exactly these into the channels it creates, so
members can post files, use emoji and talk in voice. Without them, channel
creation fails with a 403. The bot never posts a file, never opens a thread, and
never joins a voice channel.

### Optional either way

| Permission | What it costs to refuse |
| --- | --- |
| Manage Messages | Used for one thing: clearing a member's stale reaction on the welcome message when they swap rank. No welcome message, no need for it |
| View Audit Log | The "added to an unapproved server" alert reads "unknown" instead of naming who invited it. Nothing fails |

### On Manage Roles, which is the one admins baulk at

Discord enforces role hierarchy: a bot can only touch roles positioned *below*
its own. Put the bot's role beneath your officer roles and it structurally
cannot grant anyone admin or edit a role above it. That is Discord's rule, not a
promise from this code.

### Ready-made invite values

| Value | Grants |
| --- | --- |
| `84992` | The four essentials. Raids and consumables, nothing else |
| `85120` | The above plus View Audit Log — **the one to start with** |
| `378262646480` | The full list, for a server that wants `/setup run` |

Nothing is locked in. Permissions can be added later through Server Settings →
Integrations without re-inviting the bot, so starting narrow costs nothing.

`npm run invite` prints the full link and explains what each permission is for.

## Two things worth knowing

**"Manage Server" is Discord's permission, not the bot's.** There is no separate
officer list. Anyone holding Manage Server can run the gated commands, and
Discord's *Integrations* settings can narrow it further per command if you want
raid leads posting raids without the rest of the server.

**The tier file needs a restart.** Consumable data is read once when the bot
starts. Editing `tiers/current.json` means restarting before anyone sees the
change, then `/consumables board refresh`. Everything set through
`/consumables set` applies straight away.

---

Raiders never need a command. Signing up is the buttons on the raid post.
`/about` lists everything the bot can do.
