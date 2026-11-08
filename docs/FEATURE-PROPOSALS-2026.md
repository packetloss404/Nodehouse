# 1990s BBS research and 2026 feature proposals

Ten parallel research teams covered the 1990s BBS landscape in November 2026.
This document records what they found, what was verified against this codebase,
and the twenty features proposed for the next build cycle.

Sources for each area are cited in the team briefs; the recurring primary
references are the FTSC standards (FTS-0001/0004/0009/1026/5000/5005/5006,
FRL-1039), the QWK layout specification, the SAUCE specification, Synchronet's
user manual and wiki, Renegade and PCBoard documentation, and the Telnet BBS
Guide census.

## Part 1 — What the research established

### The constraint is callers, not features

The modern scene lists 1,091 boards (up from 502 in 2019), but fsxNet — the
largest surviving FTN network — carried roughly 20–30 human conversational
messages per day across ~330 nodes on a sampled day, and SSH adoption has been
flat at about 8% since 2019. A board with thirty empty conferences reads as
abandoned. Features that convert and retain a first-time caller matter more
than features that impress a sysop.

### Five defects verified in this codebase

1. **REP import leaks private replies.** `importRep` reads only subject, body
   and parent; `importReplies` posts every reply with `to_user = 'All'`. A
   private reply composed offline becomes a public conference post.
2. **Nodes are allocated before authentication.** `telnet.js:22` and
   `websocket.js:35` call `allocateNode()` on connect, so one IP can hold all
   16 nodes at the login prompt for the 300 s idle window.
3. **The "CP437" table is CP850.** Byte `0xB5` maps to `Á` where CP437 has
   `╡`; `0xC6` maps to `ã` where CP437 has `╞`. Double-line box art renders as
   accented Latin letters.
4. **The pager is dead code.** `ansi.morePrompt` is defined and never called,
   so long messages and bulletins scroll past the top of the screen.
5. **Daily door turns roll at UTC midnight.** `beginRun` uses
   `SELECT date('now')`, so a caller in UTC+10 resets at 10am local.
   Separately, `createSeason()` has no callers: seasons never rotate.

### Mechanics worth keeping, and the traps

- **Keep:** access requirements as data (not magic levels), remembered areas,
  scan grammars, per-area message sequences, a persistent status rail, a real
  pager, drop-file semantics, daily world ticks, caller logs with memory,
  guest access, validation as a human queue, call accounting, quarantine before
  publish, resumable transfers, and observable queues.
- **Avoid:** ratios and time limits as gates, remote DOS, pre-auth node
  allocation, one global idle timeout, unauthenticated `M_ADR`, trusting QWK
  headers, ANSI-only with no fallback, and silent drops of any kind.
- **The recurring failure mode across every area:** invisibility. Duplicate
  suppression, delivery, moderation and maintenance all failed historically
  when the system did something without saying so.

## Part 2 — The twenty proposals

Ordered by build order. `Fix` items ship first and each carries a regression
test. Effort is S (< half a day), M (1–2 days), L (3+ days) at this codebase's
scale.

### 1. REP private-reply leak — Fix · S
**Why:** a private reply becomes a public post today.
**Mechanics:** parse status byte 0 and the 25-byte `To:` field in `importRep`;
return `{ private, to }`. Route private replies to `privateMail`, public ones
to `messages.create` with the parsed recipient. Validate the recipient against
real users; strip control characters.
**Acceptance:** a REP marked private with `To: SysOp` creates local mail and
leaves no trace in the conference; a public REP still posts publicly.

### 2. Pre-auth node exhaustion and idle governor — Fix · M
**Why:** sixteen idle sockets take the board down.
**Mechanics:** reserve at most two *pending* sockets per normalized IP; allocate
a node on the first input byte rather than on connect. Replace the single 300 s
idle timeout with per-state clocks (60 s pre-username, 10 min logged in, 15 min
session, 60 min new user) with a 30 s warning and any-key extension. Share one
limiter across Telnet and WebSocket.
**Acceptance:** sixteen idle connections from one IP do not exhaust nodes; a
caller from another IP can still log in; a reader idle for six minutes is not
disconnected.

### 3. CP437 and iCE fidelity — Fix · M
**Why:** the gallery decodes box art with the wrong table.
**Mechanics:** replace `CP437_HIGH` with the verified CP437 mapping; add a
byte-level test covering the box-drawing and Greek ranges. Honour SAUCE
`TFlags` bit 0 by translating `SGR 5` + background `40–47` into `100–107`;
strip blink when the bit is clear.
**Acceptance:** `0xB5 → ╡`, `0xC6 → ╞`, `0xDD → ▌`; iCE art renders with
bright backgrounds; the full high half matches a reference table.

### 4. Wire the pager — Fix · S
**Why:** long content is silently cut off at the top of the screen.
**Mechanics:** use `ansi.morePrompt` in message reading, bulletins, gallery
captions and file listings: 22 lines, `[C]ontinue [S]top [N]onstop`, with
nonstop remembered per caller. Suppress in EXPERT and SUPER modes.
**Acceptance:** a 60-line message pages; `N` persists across sessions; `S`
returns to the message list.

### 5. Door local day and season rotation — Fix · M
**Why:** daily turns reset at UTC midnight and seasons never advance.
**Mechanics:** compute a `day_key` from a configurable reset hour and the
board's timezone instead of `date('now')`; store it on the usage row. Add the
season state machine (`scheduled → active → complete`) with lazy rotation on
the first run of a day, and show the reset countdown.
**Acceptance:** with an injected clock, the day key changes at the configured
local hour, not at UTC midnight; an expired season is closed and the next one
activated exactly once.

### 6. Call ledger — Fix · S
**Why:** `call_log` records six columns and no outcome.
**Mechanics:** add `transport`, `remote_addr_hash`, `duration_s`, `bytes_up`,
`bytes_down`, `messages_posted`, `messages_read`, `end_reason`
(`user_logoff|idle|time_limit|sysop_kick|carrier_lost|error`). Populate on
login, logout and disconnect; roll up daily.
**Acceptance:** a Telnet logoff records transport, duration and `user_logoff`;
an idle disconnect records `idle`; a kick records `sysop_kick`.

### 7. Guest line — Feature · S
**Why:** the lowest-friction way to convert a lurker, and it keeps anonymous
traffic out of the user table.
**Mechanics:** a `GUEST` identity at level 0 that can read public boards, list
files and take one door turn, with no mail or posting; 24-hour session cap.
`NEW` from a guest upgrades in place and carries the handle.
**Acceptance:** a guest can read General but cannot post; `NEW` creates a real
account; guests never appear in the member directory.

### 8. First Call Quest — Feature · M
**Why:** orientation that ends in a win, not a probation.
**Mechanics:** on first login, a three-item checklist pinned to the main menu —
read a thread, leave a one-liner, say hello in chat. Completion grants a badge
and one door turn, then the checklist disappears.
**Acceptance:** a fresh caller sees the checklist; completing all three marks
it done and grants the turn; it never returns.

### 9. Caller Log 2.0 — Feature · S
**Why:** social proof and memory, from data already collected.
**Mechanics:** dedupe by caller; show `NEW`/`RETURNING`/`ONLINE`, total calls,
last seen, and the since-last-call delta. Never show IP addresses or real names.
**Acceptance:** two calls by one user render as one row; a first-time caller is
marked `NEW`; a returning caller shows the delta.

### 10. Validation Desk — Feature · M
**Why:** open registration is an abuse hole; a CAPTCHA is not the period answer.
**Mechanics:** `users.state` (`pending|active|muted|suspended`), a pending queue
in the control desk with quick-validate presets, invite codes that skip the
queue, auto-promotion after N days plus one reply, and a welcome mail on
approval.
**Acceptance:** a new registration appears as pending; approving promotes to
level 10 and sends mail; an invite code skips the queue.

### 11. House Calendar — Feature · S
**Why:** rituals and warmth at almost no cost.
**Mechanics:** opt-in birthday stored as `MM-DD` only, call anniversaries
derived from `first_call_date`, a board anniversary, and a weekly "this week at
the House" card in the Daily Call.
**Acceptance:** a birthday appears on the day and not otherwise; no year is ever
displayed; opt-out is respected.

### 12. Note to the Next Caller — Feature · S
**Why:** asynchronous intimacy; the board feels handed over rather than empty.
**Mechanics:** one slot; the last caller writes up to 79 characters; it is shown
once at the next login and then cleared. The author is recorded.
**Acceptance:** write it, next login sees it exactly once, the following login
does not.

### 13. Scan Desk — Feature · M
**Why:** `[N]` is one fixed walk; period readers had a query language.
**Mechanics:** accept `Y` (to me), `U` (unread), `A` (all areas), `F <user>`,
`S <date>`, `L` (from last), `+`/`-`, and `NS`. Cap each area at 50 messages
before concatenating in subscription order.
**Acceptance:** `U` visits only unread with per-area caps; `A` visits all
accessible areas; `S 10/24` filters by date; `NS` suppresses pauses.

### 14. Quote Picker and editor commands — Feature · M
**Why:** the editor is append-only and every quote is a bare `>`.
**Mechanics:** number the source lines and accept ranges (`3-9,12`); prefix
with author initials (`IW> `); wrap at 76; strip signature, tear and origin
lines. Add `/L`, `/E n`, `/D n`, `/I n`, `/T`, `/?` and blank-line command mode.
**Acceptance:** quoting lines 2–3 produces exactly those lines with initials;
`/E 2` replaces line 2; `/L` lists the draft with numbers.

### 15. Draft Shelf — Feature · S
**Why:** drafts are stored but write-only.
**Mechanics:** list drafts with area, subject, age and size; resume, edit or
delete. Reuses `message_drafts` and the existing reader service.
**Acceptance:** save a draft, log off, log in, resume and post it.

### 16. Door Lobby — Feature · M
**Why:** the door menu is a static list with no clock and no pecking order.
**Mechanics:** per door show turns left, reset countdown, your rank and best,
the current leader, who is playing now, and an ANSI ad tile.
**Acceptance:** the lobby shows `5/5` turns and a countdown; after a run it shows
`4/5`; the leader matches the league table.

### 17. Time Bank — Feature · M
**Why:** the genre's economy, opt-in, without the punishment.
**Mechanics:** earn minutes for posts, uploads and one-liners; spend them for
extra door turns; cap the balance and allow one deposit per day. Disabled by
default; enabled per board.
**Acceptance:** earning adds to the balance; spending a turn deducts; the cap
and the daily deposit limit are enforced.

### 18. File Transfer Core — Feature · L
**Why:** file libraries are catalog-only; this is the roadmap's declared next.
**Mechanics:** upload into quarantine (`state`, SHA-256, magic-byte sniff, size
cap), operator approval into content-addressed storage, and download through a
signed expiring ticket with `Range` and `ETag`. Extract `FILE_ID.DIZ` into a
45×10 card. Tag files across areas and build one bounded ZIP batch.
**Acceptance:** an upload is quarantined, approved, then downloadable; a used
ticket returns 404; a ranged request resumes; the DIZ card renders 45×10.

### 19. Maintenance Window and Job Runner — Feature · M
**Why:** the backup contract is currently a human promise in the runbook.
**Mechanics:** a `drain → maintenance → open` state machine that rejects new
logins, broadcasts a countdown and waits for zero sessions; a `jobs` table with
cron, lock, dry-run and last status; a nightly `VACUUM INTO` backup followed by
`PRAGMA integrity_check` and a checksum manifest; one digest to the SysOp.
**Acceptance:** draining blocks new logins and proceeds at zero sessions; the
backup verifies; the digest lists each job and its status.

### 20. Full-80 chrome and status rail — Feature · M
**Why:** every screen occupies 58 of 80 columns and there is no persistent
orientation between screens.
**Mechanics:** rebuild `framedRow` around a 74-column content box; add a
row-25 status rail (conference, mail, new, node, time) updated by cursor
addressing rather than a full repaint. Keep the 80-column invariant.
**Acceptance:** every screen uses at least 74 of 80 columns; the rail persists
across screens; all existing 80-column tests pass.

## Part 3 — Deferred to the next cycle

These were proposed and deliberately cut from the first twenty: Board Health
Ledger, Dupe Firewall and Mailer Status, Signed Node Directory, TIC file echo,
Offline Config (QWK `CONFIG` messages), lightbar navigation, cell-buffer ANSI
loader, asynchronous grudge queue, season scoreboard artifacts, and the
PacketNet delivery layer.

## Part 4 — Build contract

Each feature ships on its own branch, merged only when green, with the full
gate: `npm run check`, the node suite, Playwright, `npm run smoke`, and the
production audit. Migrations are additive only, with a backup before any schema
change. The loop stops and asks on two consecutive CI failures, any change to
authentication or secrets, or a migration that is not purely additive.
