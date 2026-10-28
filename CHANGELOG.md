# Changelog

## Unreleased

- Renamed the product to **The Nodehouse**, powered by **Nodehouse**, and renamed the repository/package identity to `Nodehouse`/`nodehouse`.
- Added `NODEHOUSE_*` configuration names and `nodehouse.db` defaults while retaining legacy PacketBBS settings and database discovery for existing installations.
- Added personal conference subscriptions and scan order, remembered conference state, catch-up, mark-unread, stable thread identity, thread view, and access-scoped literal message search.
- Added a guided Daily Call covering mail, subscribed conferences, bulletins, files, callers, and polls.
- Added private-by-default caller cards, the moderated Front Porch, role-separated community controls, a moderation queue, and bounded audit history.
- Added caller presence states, consent-based node pages/private chat, and telegram fallback to durable local E-Mail.
- Added trusted persistent doors with daily launch limits, scores, league tables, and season-ready storage.
- Added bounded Packet Briefcase and QWK/REP offline workflows with expiring one-use transfers, atomic import, access/parent validation, and replay protection.
- Added a curated 80-column ANSI art gallery with SAUCE metadata support and terminal-control sanitization.
- Kept PacketNet federation as an explicitly planned backlog item; this release does not create network peers or exchange federated messages.

### Fixed
- Repaired the SysOp panel: an invalid escape inside the panel's template literal emitted a client-side `SyntaxError`, so the entire `/admin` single-page app failed to run in a browser.
- Vibe Wars now charges the price it quotes. Sector prices are rolled once on arrival and held stable, instead of re-rolling on every redraw, quote, and charge.
- The sealed Dungeon of the Vibe Lords no longer consumes a daily door turn, and the door menu now says no turn was used.
- Front Porch expiry works: expiry timestamps are stored in SQLite's canonical form and compared with `datetime()`, so expiring cards actually disappear.
- Bulletins and the MOTD wrap their bodies to the frame instead of silently truncating long lines.
- The Voting Booth no longer reports "Vote recorded!" for a discarded duplicate vote.
- Page SysOp reports delivery honestly instead of always claiming the SysOp is unavailable.
- Admin API: `reset-password`, porch moderation, message delete, and bulletin delete/toggle now return `404` for an unknown target instead of a false success; `GET /admin/api/moderation` rejects an unknown state with `400`.
- Front Porch cards can be filed as a notice, event, classified, or help-wanted item (each still enters moderation), and the terminal directory is searchable.
- QWK `CONTROL.DAT` now carries the spec's total-message and conference-count lines, and a fresh board seeds the advertised Front Porch AutoMessage.
- Personal newscan default order no longer drifts with read history; it follows the conference list until the caller reorders it.
- The Daily Call counts the whole board on a first call instead of reporting zero bulletins and files.
- Removed a dead `MESSAGE_WRITE_CONFIRM` dispatch whose handler never existed.
- The main-menu entry for the node lobby now reads "Node Lobby", matching the documentation.

### Added
- End-to-end suite (`test/e2e/`) that boots the real server on ephemeral ports and drives the Telnet, WebSocket, HTTP, and admin REST surfaces across the advertised features.
- Real-browser Playwright suite (`test/browser/`) for the web terminal and the SysOp panel, wired into CI.
- Shared end-to-end harness (`test/helpers/board.js`) with Telnet and WebSocket clients.

### Changed
- `npm test` runs `test/**/*.test.js`; added `npm run test:e2e` and `npm run test:browser`.
- Updated the release gate and documented the VPS deployment contract in `docs/OPERATIONS.md`.
- Production dependency audit is clean again (`express`, `body-parser`, and `proxy-addr` updated; `qs` pinned via an override).
- Corrected README drift: main-menu labels, the database table count, and the deployment target.

## 1.2.1 — 2026-08-01

- Made HTTP and Telnet ports deployment-aware while keeping both transports active.
- Added `/healthz`, Railway config-as-code, a required `/app/data` volume contract, and an operations runbook.
- Removed the known production SysOp seed password on fresh databases.
- Added connection, login, registration, admin, payload, origin, and terminal-input guardrails.
- Added CI plus repeatable local and public HTTP/Telnet smoke checks.

## 1.2.0 — 2026-08-01

- Added the traditional caller summary, new-message scan, Last Callers, menu modes, and public/private reply split.
- Reframed the original Vibe content as Vibe Community inside the broader community BBS system.
- Added traditional-BBS research, migration-safe database updates, and caller-loop regression tests.
