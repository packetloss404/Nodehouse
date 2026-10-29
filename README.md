# The Nodehouse

**A modern BBS system.**

*Your house on the wire.*

The Nodehouse is a self-hosted community BBS powered by Nodehouse: a place for callers, messages, files, chat, and doors. Connect by Telnet for the authentic experience or use the browser terminal. Both transports feed one shared session engine, so callers across 16 nodes see each other in real time.

The original vibe-coding personality still has a home. **Vibe Community** is a deliberately neon corner of the message network, joined by the Vibe Lounge and named door worlds. It is part of The Nodehouse, not the premise of the whole system.

## Direction

The Nodehouse is evolving toward a local-first community node inspired by the best interaction patterns of early- and late-1990s BBS systems:

- A caller loop centered on mail waiting, new-message scans, new files, callers, doors, and deliberate logoff
- Clear separation between local E-Mail, local conferences, shared PacketNet echoes, routed NetMail, and external NetNews
- Offline **Packet Briefcase** and QWK/REP workflows for reading and replying away from the live connection
- Curated file libraries, daily-turn doors, compact caller profiles, last-callers lists, and other small features that make a community feel inhabited
- Authenticated store-and-forward federation only after local threading, unread state, moderation, and delivery queues are reliable

The traditional caller loop now extends beyond the initial shell: callers can tune a personal newscan, resume a conference, catch up or mark a message unread, inspect threads, search messages, take a guided Daily Call, use the Front Porch and opt-in directory, page other nodes, play persistent daily-turn doors, browse the ANSI gallery, and exchange offline packets. The existing special-interest boards remain grouped under **Vibe Community**.

The [traditional BBS research and loop design](docs/TRADITIONAL-BBS-RESEARCH.md) records the TriBBS, Spitfire, PCBoard, WWIV, Renegade, and Synchronet comparison. The broader network proposal, migration constraints, risks, and phased review checklist live in [HANDOFF.md](HANDOFF.md).

---

## Features

- **Hybrid Access** — Raw Telnet server (TCP 2323, real IAC negotiation) plus a browser terminal you dial into (modem log, carrier tone, CRT glow, self-hosted assets) over WebSocket, both driving one `BBSSession` engine
- **Multi-Node Concurrency** — Up to 16 simultaneous users with cross-protocol broadcasts: login/logout/disconnect notices, SysOp pages, and new-mail alerts reach online users regardless of how they connected
- **Traditional Caller Loop & Daily Call** — “Since Your Last Call” plus a guided `Z` route covering mail, subscribed conferences, bulletins, files, callers, and polls; deliberate logoff and persisted novice/expert/super menu modes remain intact
- **ANSI Art UI & Gallery** — Full-color menus plus a curated, metadata-aware gallery of original 80-column `.ans` screens; unsafe terminal controls and oversized artwork are rejected
- **Personal Newscan** — Opt-in conference subscriptions, caller-defined scan order, remembered conference, durable high-water metadata, catch-up, explicit mark-unread, and scans whose authority remains the per-message `message_read` record
- **Threaded Message Reader** — Stable global/root identity, validated same-conference parents, thread view, access-scoped literal subject/body/author search, public follow-up versus private reply, and a `/S` save / `/A` abort editor; bounded drafts, signatures, and selected quoting are available at the service layer
- **Electronic Mail** — Person-to-person mail with inbox/read/reply/delete, recipient validation, unread counts in the caller summary and main prompt, and live "new mail" push if the recipient is currently online
- **Polls & Voting Booth** — Interactive polls with one-vote-per-user enforcement (DB-level unique constraint) and results rendered as percentage ASCII bar charts
- **TeleChat** — 3 live rooms with real cross-node message relay scoped per room, join/leave announcements, and `/W` who's-here
- **One-Liners** — A compact caller wall; usernames are ANSI-stripped before display
- **Front Porch & Caller Cards** — Expiring notices, events, classifieds, and help-wanted cards that callers can file (each enters moderation), a seeded AutoMessage, and a searchable alias-first directory; profiles are hidden until their caller explicitly opts in
- **Node Lobby** — Presence with Available/Away/Busy/DND states, consent-based caller pages and private node chat, plus durable telegram fallback through local E-Mail
- **Vibe Community** — Grouped boards for AI-assisted building, agents, prompts, and experimental workflows
- **5 Persistent Door Games** — Trusted registry, daily launch allowances, bounded saves, completed-run scoring, and league tables; season storage is ready for scheduled competitions
- **Packet Briefcase & QWK/REP** — One-time, expiring browser transfers export readable offline packets and import bounded replies; ZIP traversal, expansion, replay, conference access, and reply-parent checks guard the boundary
- **SysOp Control Desk** — Role-separated moderator/SysOp permissions, profile and porch review, moderation queue, bounded audit history, MOTD/bulletin/user/message controls, node monitoring, and a token-authenticated dashboard
- **File Libraries** — 4 browsable catalog areas for utilities, text files, caller uploads, and ANSI art (listing/catalog; transfer not yet wired)
- **Persistent Storage** — SQLite (better-sqlite3, WAL mode, 28 tables) with scrypt-hashed passwords and call logging
- **Deployment Guardrails** — Docker- and Railway-aware HTTP/Telnet ports, database health checks, secure production bootstrap, bounded login/registration/admin attempts, origin-checked WebSockets, CI, and end-to-end listener smoke tests

## Roadmap Summary

1. **Traditional caller shell — shipped in 1.2.0** — reliable unread newscan, last-call summary, Last Callers, menu modes, conventional labels, public/private reply split, and idempotent disconnect cleanup
2. **Community and reader release — implemented** — personal newscan, thread/search controls, Daily Call, caller cards, Front Porch, control desk, node paging/telegrams, persistent doors, offline packets, and ANSI gallery
3. **File-library completion — next** — safe uploads/downloads, search, extended descriptions, batch downloads, and upload quarantine
4. **Local message/mail depth — planned** — expose draft/signature/quote services throughout the terminal editor, add richer mailbox state, and move area charters into the database
5. **PacketNet lab and adapters — backlog only** — signed node identities, scheduled mail runs, trusted hub fan-out, retries, deduplication, authenticated NNTP, and optional FTN/FidoNet support

See [HANDOFF.md](HANDOFF.md) for acceptance criteria and protocol references.

## Quick Start

```bash
git clone git@github.com:packetloss404/Nodehouse.git
cd Nodehouse
npm install
cp .env.example .env
npm run verify
npm start
```

PowerShell equivalent: `Copy-Item .env.example .env`.

Then connect:

| Method | Address |
|--------|---------|
| Web Terminal | http://localhost:8088 |
| Admin Panel | http://localhost:8088/admin |
| Telnet | `telnet localhost 2323` |

The browser terminal is a dial-in: the landing card holds the line open with a
modem log and a carrier tone, and the session begins only when you press **DIAL
IN**. Sound is mutable, and a redial button appears after `NO CARRIER`. Raw
Telnet remains the no-nonsense path for a real terminal.

On a fresh local development database, `.env.example` permits the development-only login `SysOp` / `sysop`. A fresh production or Railway database instead requires `NODEHOUSE_SYSOP_PASSWORD` with at least 12 characters; The Nodehouse will not start with the known default.

Validate the codebase with the same syntax-and-test loop used for this milestone:

```bash
npm run verify        # syntax check + unit tests + end-to-end tests
npm run smoke         # local HTTP + Telnet release smoke
npm run test:browser  # Playwright: web terminal + SysOp panel (needs Chromium)
```

`npm run verify` boots the real server for the end-to-end suite. The browser suite needs a one-time `npx playwright install chromium`.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) before exposing the board publicly. It records the Docker and Railway persistence, backup, recovery, release, and public-smoke contracts.

### Docker deployment

The production Compose stack publishes HTTP on host port `8088` and maps standard Telnet port `23` to the application's internal `2323` listener. It persists the SQLite database in `./data` and the file library in `./files`.

```bash
cp .env.example .env
# Set NODE_ENV=production and a long NODEHOUSE_SYSOP_PASSWORD in .env.
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 nodehouse
```

Put an HTTP reverse proxy in front of `8088`; WebSocket upgrades use the same endpoint. Raw Telnet must be forwarded directly as TCP and is intentionally plaintext.

## Testing

Three suites, all runnable locally and in CI:

| Command | What it covers |
|---------|----------------|
| `npm test` | Unit/service tests plus end-to-end tests that boot the real server on ephemeral ports and drive the Telnet and WebSocket transports (`test/e2e/`) |
| `npm run test:browser` | Playwright: the xterm.js web terminal, the browser login/logoff flow, and the SysOp control desk (`test/browser/`) |
| `npm run smoke` | A release smoke of `/healthz`, the web terminal shell, and the Telnet welcome banner |

`npm run verify` runs the syntax check and `npm test`. The shared end-to-end harness lives in `test/helpers/` and is documented in `test/helpers/README.md`.

## Screenshots (What You'll See)

The Nodehouse renders the caller experience entirely in ANSI art. Here's what the flow looks like:

```
┌──────────────────────────────────────────────────────┐
│  The Nodehouse: a self-hosted community BBS          │
│  Messages, files, callers, chat, and door games      │
└──────────────────────────────────────────────────────┘

    Enter your credentials below
    or type NEW to register

    Username: _
```

The main menu provides access to all BBS functions:

```
┌──────────────────────────────────────────────────────┐
│  [M] Message Conferences  [E] Electronic Mail        │
│  [F] File Libraries       [D] Door Games             │
│  [B] Bulletins            [T] TeleChat               │
│  [N] New Message Scan     [L] Last Callers           │
│  [W] Who's Online         [V] Voting Booth           │
│  [O] One-Liners           [Y] Your Settings          │
│  [P] Page SysOp           [S] System Information     │
│  [H] Front Porch          [I] Node Lobby             │
│  [A] ANSI Art Gallery     [K] Packet Briefcase       │
│  [Z] Daily Call           [X] Menu Mode              │
│  [G] Goodbye / Logoff                                │
└──────────────────────────────────────────────────────┘
```

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────┐
│ Telnet :2323 │────▶│                                      │
└─────────────┘     │   BBSSession (State Machine)         │
                    │                                      │
┌─────────────┐     │   ~40 states: login, menus, messages,│──▶ SQLite DB
│ Browser :8088│────▶│   mail, polls, chat, doors, admin... │
│  (WebSocket) │     │                                      │
└─────────────┘     └──────────────────────────────────────┘
                              │
┌─────────────┐               │
│ Admin Panel  │───────────────┘
│  (REST API)  │     Express routes + token auth
└─────────────┘
```

Both Telnet and WebSocket connections construct the same `BBSSession` over a tiny `transport` shim (`write`/`end`). Telnet sends real IAC negotiation bytes (`WILL ECHO`, `WILL/DO SUPPRESS-GO-AHEAD`) and parses raw input byte-by-byte; WebSocket adds ping/pong keepalive for idle timeout. The `NodeManager` tracks every active node across both transports as a `node → {session, username, activity}` map and provides `broadcast()`, which powers cross-protocol login/logout/paging/new-mail announcements.

## Message Conferences

| # | Conference | Description | Access |
|---|-----------|-------------|--------|
| 1 | General Discussion | Chat about anything and everything | All users |
| 3 | Show & Tell | Share projects, experiments, art, and hardware | All users |
| 2 | Vibe Coding | Swap notes on AI-assisted building and experiments | All users |
| 4 | AI Workflows | Discuss agents, prompts, context files, and tools | All users |
| 5 | SysOp Corner | System administration discussion | SysOp only |

Messages support stable root/thread identity, validated same-conference replies, thread inspection, literal full-text-style search, per-user read tracking via the authoritative `message_read` join table, personal scan subscriptions/order, catch-up, mark-unread, access-level gating, and writing with `/S` to save and `/A` to abort. Draft, signature, and selected-quote services are bounded and durable; their complete interactive editor workflow remains future UI work.

The message menu renders section headings from `config.json`. General Discussion and Show & Tell form the Main Board; Vibe Coding and AI Workflows form Vibe Community; SysOp Corner remains a restricted System conference. Numeric IDs are intentionally stable so existing posts do not need a data migration.

## Daily Call, Front Porch, and Node Lobby

- **Daily Call (`Z`)** presents a repeatable check-in across unread local mail, the caller's subscribed conferences, bulletins, new files, recent callers, and current polls.
- **Front Porch (`H`)** collects expiring community notices, events, classifieds, and help-wanted cards, plus the AutoMessage seeded on a fresh board. A caller can file any of the four card types and each submission enters moderation; operator posts can publish directly.
- **Caller Cards** expose a searchable handle-first directory with optional bio, interests, favorites, and ANSI avatar. New and migrated profiles are private until the caller opts in.
- **Node Lobby (`I`)** adds Available, Away, Busy, and DND presence, caller-to-caller page requests, accepted private chat, and one-line telegrams. An unavailable recipient receives the telegram as durable local E-Mail.

## ANSI Gallery

The gallery reads curated `.ans` files from `art/gallery`, displays SAUCE title/author/group metadata when present, enforces the 80-column house layout, caps file size, and removes escape sequences that could manipulate the terminal outside the allowed drawing controls.

## Offline Packets

The packet desk offers a friendly Nodehouse Packet Briefcase plus traditional QWK export and REP import. Transfers use short-lived, one-use bearer links over the HTTP listener. Imports are bounded, access checked, parent checked, replay protected by caller/content hash, and committed atomically. PacketNet federation is not part of this release.

## Electronic Mail

Person-to-person messaging backed by a dedicated `private_mail` table:

- Send, inbox, read, reply, and delete
- Recipient existence validation with canonical casing
- Unread counts surfaced as a badge on login
- Real-time "you've got mail" push when the recipient is online on any node

## Polls / Voting Booth

An interactive voting subsystem (`polls`, `poll_options`, `poll_votes` tables):

- One vote per user, enforced by a `UNIQUE(poll_id, user_id)` constraint
- Live results rendered as percentage ASCII bar charts
- Ships with a seeded sample poll on first run

## TeleChat & One-Liners

- **TeleChat** — 3 rooms with real-time cross-node message relay scoped to the room you're in, plus join/leave announcements and `/W` to see who's present. Vibe Lounge retains the neon annex's personality.
- **One-Liners** — Leave a compact message for other callers. Usernames are ANSI-stripped before rendering so nobody can break the layout.

## File Libraries

| # | Area | Description |
|---|------|-------------|
| 1 | Utilities | Useful scripts, tools, and small programs |
| 2 | Text Files & Docs | Guides, notes, zines, and reference material |
| 3 | Community Uploads | Files shared by Nodehouse callers |
| 4 | ANSI Art | ANSI art files and packs |

> Note: file areas are browsable catalogs (listing + metadata). Actual upload/download transfer is not yet wired.

## Door Games

Prompt Quest, Token Tycoon, and Stack Overflow sit in the general arcade. Vibe Wars and Dungeon of the Vibe Lords retain their names as part of the Vibe corner's personality.

Doors launch only from a trusted first-party registry. Vibe Wars, Prompt Quest, Token Tycoon, and Stack Overflow now save bounded state between calls; all five doors participate in daily launch allowances and completed-run league tables. The database also has season records for future scheduled competitions.

### 🚀 Vibe Wars
*Inspired by TradeWars 2002*

Intergalactic AI resource trading across 8 sectors with a per-sector price model and volatility. Prices hold steady for as long as you stay in a sector and re-roll when you arrive somewhere new, so a quoted price is the price you pay. Buy and sell GPU Cores, Training Data, Model Weights, API Tokens, Prompt Packs, and VRAM Chips. Navigate probabilistic pirate encounters, manage fuel, cargo, and hull, and maximize your fortune in 30 turns with end-of-game scoring.

### ⚔️ Prompt Quest
*Inspired by Legend of the Red Dragon*

Dungeon crawler where you descend through floors fighting 8 scaling dev-bug monsters — from Null Pointers to the dreaded Prod Outage Dragon. Earn XP and gold, level up, buy weapons (Rubber Duck → Claude Opus Staff) and potions, and see how deep you can go.

### 💰 Token Tycoon
*Original*

Build an AI startup from $5,000 to IPO in 24 months. Hire engineers, buy compute, train models, run marketing campaigns, and acquire customers via real revenue/cost formulas. Random events like viral tweets, angel investors, and AWS bill surprises keep every playthrough different. Graded S through F on final valuation.

### 📚 Stack Overflow
*Original*

Developer-themed hangman with 80 words across four categories: Programming Languages, Frameworks & Tools, Dev Concepts, and AI & Vibe Coding. Guess the word before your stack overflows (6 wrong = crash). Multi-round scoring with running win rate.

### 🧠 Dungeon of the Vibe Lords
*AI-Powered MUD — Claude is your Dungeon Master*

A live AI-narrated dungeon crawl beneath the ruins of a crashed production server. Claude acts as your Dungeon Master, generating room descriptions, NPC dialogue, combat encounters, puzzles, and loot — all in real-time over a telnet terminal.

**What makes it special:**
- **Freeform input** — Type anything. "Search the corpse," "bribe the goblin," "cast a mass rollback on the corrupted database." Claude handles it all.
- **Persistent characters** — Your adventure saves to the database. Log off, come back tomorrow, and the dungeon remembers you. Conversation history is preserved so Claude maintains narrative continuity.
- **Full RPG mechanics** — HP, XP, gold, attack, defense, inventory, leveling with stat growth and full heals. Death is permanent (roguelike).
- **Dev-themed world** — Rooms are server rooms, corrupted codebases, and haunted CI/CD pipelines. Monsters are race conditions, memory leaks, and hallucinating LLMs. Loot is mechanical keyboards and ancient documentation scrolls.
- **Leaderboard** — Hall of Fame ranked by level, monsters slain, and deepest floor reached.

Requires `ANTHROPIC_API_KEY` in `.env` (see `.env.example`). Without it, the dungeon entrance displays a "sealed" message.


## Admin Panel

The SysOp admin panel is a web-based single-file vanilla-JS SPA at `/admin` with a retro green-on-black terminal aesthetic, served by Express with token auth (`/admin/api/*` routes gated by a `requireAuth` middleware; login requires access level ≥ 200).

- **Dashboard** — Live stats (users, messages, calls, uptime), online nodes, recent call log
- **User Management** — List, delete, reset passwords, edit access levels (password hashes stripped from API responses)
- **Message Management** — Browse by conference, delete individual messages
- **Bulletin Management** — Create, toggle active/inactive, delete announcements
- **Node Monitoring** — Real-time view of who's online and what they're doing
- **Community Moderation** — Review Front Porch submissions, hide directory profiles, inspect the moderation queue, and retain a bounded audit trail
- **Role Separation** — Level-100 moderators can review community content; level-200 SysOps retain user and system administration

## Configuration

Board settings live in `config.json`; deployment and secrets use environment variables:

```json
{
  "bbsName": "The Nodehouse",
  "poweredBy": "Nodehouse",
  "sysopName": "SysOp",
  "telnetPort": 2323,
  "webPort": 8088,
  "maxNodes": 16,
  "allowNewUsers": true,
  "idleTimeout": 300,
  "messageBases": [ ... ],
  "fileAreas": [ ... ]
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `telnetPort` | 2323 | Telnet server port |
| `webPort` | 8088 | Web terminal & admin panel port |
| `maxNodes` | 16 | Maximum simultaneous connections |
| `allowNewUsers` | true | Allow new user registration |
| `idleTimeout` | 300 | Seconds before idle disconnect |
| `newUserLevel` | 10 | Access level for new accounts |
| `sysopLevel` | 255 | Maximum access level |

| Environment variable | Purpose |
|----------------------|---------|
| `PORT` / `NODEHOUSE_WEB_PORT` | HTTP port; Railway supplies `PORT` |
| `TELNET_PORT` / `NODEHOUSE_TELNET_PORT` | Independent raw Telnet listener port; Railway's TCP application port is also detected |
| `NODEHOUSE_DB_PATH` | SQLite path; use `/app/data/nodehouse.db` with a persistent container volume |
| `NODEHOUSE_SYSOP_PASSWORD` | Required strong seed password for a fresh production database |
| `NODEHOUSE_ALLOWED_ORIGINS` | Optional comma-separated additional browser WebSocket origins |

## Database

The Nodehouse uses SQLite through better-sqlite3 in WAL mode. New installations use `data/nodehouse.db`; when an existing `data/packetbbs.db` or `data/vibebbs.db` is present, Nodehouse continues using it in place so the rename cannot strand caller data. `NODEHOUSE_DB_PATH` can explicitly select another location. Legacy `PACKETBBS_*` variables remain accepted for compatibility.

For Docker upgrades, leave `NODEHOUSE_DB_PATH` unset unless deliberately selecting a database; the automatic discovery order is what keeps an existing renamed installation on its current database.

The schema is created incrementally on startup and seeded on a brand-new board via namespaced CRUD modules over prepared statements. Additive migrations preserve existing caller, message, and read-state rows:

- **users** — Accounts with scrypt-hashed passwords (per-user salt), access levels, caller stats, and persistent menu mode
- **messages** — Threaded messages organized by conference, with stable global/root identity
- **message_read**, **reader_subscriptions**, **reader_preferences**, **message_drafts** — Authoritative per-message read state plus personal scan order, high-water metadata, remembered conference, signatures, and drafts
- **bulletins** — SysOp announcements with active/inactive toggle
- **files** — File metadata with download counts
- **call_log** — Login/logout history per node
- **graffiti** — Graffiti wall entries
- **private_mail** — Person-to-person mail and telegram fallback with read/unread state
- **user_profiles**, **porch_notices**, **moderation_items**, **audit_events** — Private-by-default caller cards, Front Porch, moderation, and operator history
- **polls**, **poll_options**, **poll_votes** — Polls, their choices, and one-vote-per-user records
- **motd** — Message of the day shown on login
- **dungeon_players**, **dungeon_history** — Persistent character state and AI-dungeon context
- **door_saves**, **door_usage**, **door_runs**, **door_seasons** — Generalized persistent doors, daily admission, scores, and season definitions
- **offline_packets**, **offline_packet_tokens**, **file_transfers** — Offline packet metadata, replay records, and expiring one-use transfers

The SysOp account, welcome content, a sample poll, MOTD, and starter graffiti are seeded automatically on first launch. The familiar `SysOp / sysop` credentials are limited to explicit development/test mode; production seeding requires `NODEHOUSE_SYSOP_PASSWORD`.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Database | SQLite via better-sqlite3 (WAL) |
| Web Server | Express |
| WebSocket | ws |
| Web Terminal | xterm.js v5.5.0 (vendored, served from `/vendor`) |
| Auth | scrypt (Node.js crypto) |
| Protocol | Telnet (raw TCP via `net`) |

Five runtime dependencies, zero build step.

## Project Structure

```
Nodehouse/
├── server.js                  # Entry point — starts all servers
├── config.json                # BBS configuration
├── Dockerfile                 # Production Node.js container image
├── compose.yaml               # HTTP 8088, Telnet 23, and persistent storage
├── railway.json               # Railway start, health, replica, and volume contract
├── package.json
├── scripts/
│   └── smoke.js               # Local or public HTTP + Telnet release smoke
├── src/
│   ├── core/
│   │   ├── ansi.js            # ANSI escape codes & art screens
│   │   ├── bbs.js             # Shared Telnet/browser session state machine
│   │   ├── reader-service.js  # Subscriptions, newscan, cursors, drafts
│   │   ├── message-service.js # Threads, safe message creation, search
│   │   ├── daily-call-service.js
│   │   ├── community-service.js
│   │   └── database.js        # Additive SQLite schema & data APIs
│   ├── server/
│   │   ├── guardrails.js      # Rate, origin, and connection safeguards
│   │   ├── runtime-config.js  # Railway/environment port resolution
│   │   ├── telnet.js          # Telnet server (raw TCP + IAC)
│   │   ├── websocket.js       # WebSocket server
│   │   └── node-manager.js    # Multi-node connection tracking
│   ├── doors/
│   │   ├── registry.js        # Trusted door definitions and save adapters
│   │   ├── door1.js           # Vibe Wars (trading game)
│   │   ├── door2.js           # Prompt Quest (dungeon crawler)
│   │   ├── door3.js           # Token Tycoon (startup sim)
│   │   ├── door4.js           # Stack Overflow (hangman)
│   │   └── door5.js           # Dungeon of the Vibe Lords (AI MUD)
│   ├── admin/
│   │   ├── authz.js           # Moderator/SysOp permissions
│   │   └── panel.js           # SysOp web control desk
│   ├── packets/               # Bounded ZIP, Briefcase, QWK/REP codecs
│   ├── services/              # Door, packet, and ANSI-gallery services
│   └── web/
│       └── index.html         # Browser terminal (xterm.js)
├── test/                       # Unit tests plus end-to-end and browser suites
│   ├── *.test.js               # Unit/service tests (node:test)
│   ├── e2e/                    # End-to-end tests over real Telnet + WebSocket
│   ├── browser/                # Playwright specs (web terminal + admin panel)
│   └── helpers/                # Shared E2E harness (board + transport clients)
├── playwright.config.js
├── docs/
│   ├── OPERATIONS.md          # Railway, backups, recovery, and release gate
│   └── TRADITIONAL-BBS-RESEARCH.md
└── data/                      # SQLite database (gitignored)
```

## License

MIT

---

*Built by [packetloss404](https://github.com/packetloss404). Dial in. Drop a packet. Stay awhile.*
