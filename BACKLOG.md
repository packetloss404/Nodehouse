# Backlog

## Portfolio audit backlog — 2026-07-17
_Findings from a 2026-07-17 code audit, preserved for later._

### Later / deferred
- **[medium/M]** Reader continuity still needs subscriptions and high-water pointers
  - The 1.2.0 caller-loop milestone fixed global/per-conference `[N]` scans using the existing `message_read` table. The next step is caller-controlled scan order, per-conference cursors, catch-up, mark-unread, remembered conference, and next-unread-thread behavior.
- **[low/L]** File libraries are list-only — `handleFileList` returns to the library selector, with no upload/download transfer
  - Real file transfer over Telnet/WebSocket (list contents, download/upload, protocol) is a substantial feature; `config.json` already defines file-library directories. Incomplete feature, not a defect.
- **[low/M]** Automated coverage is still narrow
  - Current tests cover Nodehouse branding, message-base grouping/ID stability, 80-column caller screens, fresh database setup, exact-match seed migration, and the logon-to-newscan caller loop. Next targets: `db.users.authenticate` / access levels, admin `requireAuth`, message-base access gating, mail composition, and door return transitions.

### Known limitations (deliberate — not planned)
- /admin static HTML served without requireAuth; only /admin/api/* routes gated
