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
