# Backlog

## PacketNet — trusted store-and-forward federation [high/XL, planned]

PacketNet is feature 10 in the Nodehouse roadmap. It is intentionally backlog-only until local message identity, threading, moderation, offline-packet replay protection, and delivery auditability are proven.

### 1. Protocol and threat model

- Define versioned canonical JSON envelopes with stable global message IDs, parent IDs, content hashes, origin, path, hop limits, and timestamps.
- Use Ed25519 node identities with explicit operator-approved key fingerprints; claimed node addresses never establish trust.
- Sign bounded batches transported over TLS and document key rotation, retention, deletion, moderation, and gateway policy.

### 2. Local spool foundation

- Add peers, area subscriptions, delivery queues, batches, acknowledgements, ingress history, quarantine, audit records, and dead-letter state.
- Make queue transitions idempotent, bound message/batch sizes and retry counts, and quarantine global-ID/content-hash conflicts.
- Use exponential backoff and recover cleanly from process restarts during send or receive.

### 3. Controlled hub lab

- Begin with one trusted hub and two operator-controlled Nodehouse systems using scheduled poll-based mail runs.
- Allowlist initial echoes such as `PACKET.GENERAL`, `PACKET.PROJECTS`, and `PACKET.BBSDEV`.
- Exclude public discovery, arbitrary transit, binary files, and mesh routing from the pilot.

### 4. Operator and moderation controls

- Provide peer enable/disable, directional area subscriptions, posting permissions, quarantine review, retry/dead-letter controls, path inspection, and a caller-visible Mailer Status screen.
- Rate-limit by peer, user, area, and destination; imported control fields never grant local authorization.

### 5. Pilot exit criteria

- A threaded message crosses two nodes exactly once, including after retries and duplicate batch delivery.
- Invalid signatures, expired batches, unknown keys, excessive hops, unauthorized areas, and conflicting content are rejected or quarantined.
- Operators can trace, retry, quarantine, block, and audit every delivery without database surgery.
- FTN/FidoNet and NNTP remain later adapters across this spool boundary; imported packet bytes never become Nodehouse's canonical message model.

## Portfolio audit backlog — 2026-07-17
_Findings from a 2026-07-17 code audit, preserved for later._

### Later / deferred
- **[medium/M]** Complete the interactive editor around the shipped reader services
  - Subscriptions, scan order, high-water metadata, catch-up, mark-unread, stable threads, search, and remembered conference now ship. The terminal can save drafts, append compact signatures, and quote follow-ups; add draft browsing/resume and selectable quote ranges.
- **[low/L]** File libraries are list-only — `handleFileList` returns to the library selector, with no upload/download transfer
  - Real file transfer over Telnet/WebSocket (list contents, download/upload, protocol) is a substantial feature; `config.json` already defines file-library directories. Incomplete feature, not a defect.
- **[low/M]** Extend end-to-end coverage
  - The suite now drives the real server end to end: the Telnet and WebSocket transports, reader/newscan, mail and live new-mail push, polls, the Front Porch and caller cards, the Node Lobby, all five doors, offline packets over HTTP, the admin REST API, deployment guardrails, multi-node broadcasts, and a real-browser Playwright pass over the web terminal and SysOp panel. Remaining targets: long multi-user soak runs, the interactive editor UX, and file-library transfer once it exists.
- **[low/S]** QWK compatibility gaps
  - `DOOR.ID` declares `CONTROLTYPE` without the `CONTROLNAME` the QWK spec requires alongside it, and `importRep` does not verify the packet `BBSID` (Nodehouse's own export writes none). `CONTROL.DAT` now carries the spec's total-message and conference-count lines. The remaining deviations are interop-only and do not affect Nodehouse's own QWK/REP round trip.
- **[low/M]** Per-listener rate limits are independent
  - Telnet and WebSocket each construct their own connection/login/registration limiters, so one source address can consume both budgets (for example 30 connections/min per transport rather than a combined 30). A shared limiter would be stronger; the current split is a hardening item, not a live defect.
- **[low/S]** "Callers since last call" uses second-resolution timestamps
  - The count compares `login_time` at one-second resolution, so a caller who logs in within the same wall-clock second as the caller's previous call is not counted. Exact enough for a social summary; a higher-resolution or id-based cursor would make it precise.

### Known limitations (deliberate — not planned)
- /admin static HTML served without requireAuth; only /admin/api/* routes gated
