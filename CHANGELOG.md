# Changelog

## Unreleased

- Renamed the product to **The Nodehouse**, powered by **Nodehouse**, and renamed the repository/package identity to `Nodehouse`/`nodehouse`.
- Added `NODEHOUSE_*` configuration names and `nodehouse.db` defaults while retaining legacy PacketBBS settings and database discovery for existing installations.

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
