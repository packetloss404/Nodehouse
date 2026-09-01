# Traditional BBS Alignment

**Research and implementation pass:** 2026-08-01

**Status:** Caller-loop milestone implemented; deeper reader, file-transfer, and networking work remains staged for later loops.

## Objective

Make The Nodehouse feel like a useful community bulletin board first: a caller connects, learns what changed, reads and answers messages, checks local electronic mail, sees who called, visits files or doors, and deliberately logs off. The Vibe material remains part of the board, but it no longer defines the shell.

The Nodehouse should remain a self-hosted community node: local state is owned by the operator, behavior is explicit, and future network boundaries remain auditable and recoverable.

## Research note: Triad versus TriBBS

The DOS software matching the requested comparison is **TriBBS**, originally associated with the TriTEL name. The preserved TriBBS 11.0 distribution contains the menu, manager help, caller manual, message menu, file menu, and TeleChat material used for this analysis. The Swedish group TRIAD also operated C*Base boards, but that is a different lineage and was not treated as the Nodehouse model.

## What the old systems consistently got right

| System | Patterns worth carrying forward |
|---|---|
| TriBBS 11.0 | A short main command menu; separate message, file, door, bulletin, and TeleChat destinations; novice/expert-style display modes; a login preamble; conference scans and personal-message paths. |
| Spitfire 3.51 | A deliberate logon sequence with caller information and new activity; message, file, and door sections; bulletins, comments to the SysOp, active callers, Who's On, chat, system information, last callers, and Xpert mode. |
| PCBoard | Stable single-letter commands, conferences, file directories and search, comments to the SysOp, explicit goodbye, and an expert-mode toggle. |
| WWIV | “New messages in all subs” as a first-class command, last callers, auto-message, electronic mail, voting, user information, file transfer, doors/chains, and a remembered expert mode with `?` to restore the menu. |
| Renegade | Configurable last-caller and Who's Online displays, one-liners, global newscan, conference navigation, an offline-mail area, and highly configurable menus. |
| Synchronet | Groups/subboards, local E-Mail and NetMail separation, configurable newscan lists and pointers, new-file scan and search, batch transfers, QWK packets, chat, doors, and compact quick-key sequences. |

The common center is continuity, not decoration. ANSI art gives the board a face, but the product becomes a BBS when it remembers the caller, shows what changed, preserves reading state, and makes the next command predictable.

## Nodehouse design rules

1. Keep the core shell restrained: cyan, white, amber, an 80-column-safe layout, and conventional BBS nouns.
2. Use **Message Conferences**, **Electronic Mail**, **File Libraries**, **Door Games**, **Bulletins**, **TeleChat**, **Last Callers**, and **System Information** in the primary navigation.
3. Keep stable single-key commands. `?` always restores help; novice mode shows the full menu; expert modes reduce redraws.
4. Preserve the Vibe boards, Vibe Lounge, and named door games as destinations inside the system. Magenta/neon presentation belongs there, not in the system identity.
5. Treat “new since last call” as the caller's home context. Newscan must use persisted read state, never a decorative or date-only approximation.
6. Separate a public conference follow-up from a private electronic-mail reply.
7. Finish each connection exactly once: record logout, announce the departure, release the node, and tolerate a later transport-close event.
8. Do not reproduce period friction that no longer serves the community: punitive ratios, scarce-time pressure, insecure identity prompts, or forced collection of personal data.

## Target caller loop

```text
CONNECT
  -> username and password
  -> SINCE YOUR LAST CALL
       mail waiting
       unread conference messages
       new file entries
       callers since last call
       calls today and previous caller
  -> message of the day
  -> MAIN
       M Message Conferences    E Electronic Mail
       F File Libraries         D Door Games
       B Bulletins              T TeleChat
       N New Message Scan       L Last Callers
       W Who's Online           V Voting Booth
       O One-Liners             Y Your Settings
       P Page SysOp             S System Information
       X Menu Mode              G Goodbye
  -> deliberate logoff
```

## Autonomous implementation loop completed

### Loop 1 — Inspect and bound

- Audited the shared Telnet/WebSocket session engine, SQLite read-state and call-log tables, menus, seed content, and sibling `packet*` naming conventions.
- Chose one bounded milestone: the caller shell plus correct global newscan. QWK, PacketNet, real file transfer, and message-schema replacement were kept out of scope.

### Loop 2 — Implement

- Added an additive `users.menu_mode` migration with `NOVICE`, `EXPERT`, and `SUPER` behavior.
- Added the post-authentication “Since Your Last Call” summary.
- Added a compact traditional main menu, `?` redisplay, legacy key aliases, and persistent menu-mode cycling.
- Added Last Callers and traditionalized the names of mail, files, chat, one-liners, settings, and system information.
- Replaced the old all-messages `[N]` behavior with persisted unread queries across accessible conferences.
- Made a message show its conference and split `[F]` public follow-up from `[R]` private mail reply.
- Made session cleanup idempotent so Goodbye followed by a socket-close cannot double-log or double-announce a caller.
- Kept message-base IDs stable and moved the existing special-interest boards under **Vibe Community**.
- Updated exact stock seed content without rewriting caller-authored content.

### Loop 3 — Verify and review

- Added an end-to-end state-machine test from logon summary through MOTD, main menu, cross-conference newscan, menu-mode persistence, Last Callers, and duplicate disconnect cleanup.
- Added 80-column assertions for the main caller screens.
- Retained the database override, exact-match seed migration, and stable-area-ID tests.
- Added `npm run verify` as the single syntax-and-test command.

## Next autonomous loops

### Loop 2 — Reader continuity

- Conference subscriptions and caller-controlled scan order
- Per-conference high-water pointers in addition to per-message read records
- Next unread thread, catch-up, mark unread, and remembered current conference
- Selectable quoting and compact signatures
- Header and body search

### Loop 3 — Electronic mail

- Inbox, Sent, Saved, and Drafts
- Durable sender/recipient state, forwards, CC, aliases, and thread identity
- A clear boundary between local E-Mail and future NetMail

### Loop 4 — File libraries and offline packets

- New-file scan, filename/description search, extended descriptions, archive inspection, and batch queue
- Safe upload/download paths for both browser and terminal callers
- Packet Briefcase first, then QWK/REP compatibility

### Loop 5 — Community and operator depth

- Compact caller profiles and opt-in directory
- Auto-message, caller statistics, conference charters, moderation queues, and activity summaries
- Door entry/return transitions and per-game daily-turn presentation

Networking, Usenet/NNTP, FTN, and PacketNet remain later layers. They should reuse the local message, reader-state, moderation, and delivery foundations rather than drive the schema prematurely.

## Primary sources

- [TriBBS 11.0 main menu](https://files.mpoli.fi/unpacked/software/dos/bbs/tbbs110.zip/main.mnu)
- [TriBBS 11.0 caller manual](https://files.mpoli.fi/unpacked/software/dos/bbs/tbbs110.zip/tribbs.doc)
- [TriBBS 11.0 message menu](https://files.mpoli.fi/unpacked/software/dos/bbs/tbbs110.zip/message.mnu)
- [TriBBS 11.0 file menu](https://files.mpoli.fi/unpacked/software/dos/bbs/tbbs110.zip/files.mnu)
- [TriBBS 11.0 TeleChat help](https://files.mpoli.fi/unpacked/software/dos/bbs/tbbs110.zip/tchat.bbs)
- [Spitfire 3.51 system disk](https://synchro.net/files/Simtel.Sep-1997/BBS/SF351-1.ZIP)
- [Spitfire 3.51 documentation and utilities](https://synchro.net/files/Simtel.Sep-1997/BBS/SF351-2.ZIP)
- [PCBoard user commands](https://kuehlbox.wtf/wiki/commands%3Auser%3Astart)
- [WWIV 5 main menu](https://wwivbbs.readthedocs.io/en/wwiv54/main_menu/)
- [Renegade DOS manual](https://renegadebbs.bbses.info/files/06-aug-1999.Rendocs.Pdf)
- [Synchronet user documentation](https://www.synchro.net/docs/user.html)
