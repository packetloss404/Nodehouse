# The Nodehouse Community and Network Handoff

**Prepared:** 2026-07-30; implementation status updated 2026-08-01

**Status:** The traditional caller-shell milestone is implemented. Reader continuity, offline packets, networking, and compatibility sections remain proposals for review.

**Scope:** Product direction, historical BBS research, technical architecture, migration guardrails, and a phased implementation plan

## Executive recommendation

The Nodehouse should be the umbrella identity for a local-first community BBS, powered by Nodehouse. The existing Vibe personality should remain visible as one lively district inside that broader community rather than defining the entire system.

The product should recreate the behavior of a networked 1990s BBS before attempting every historical wire protocol:

- A deliberate caller session with a useful logon summary
- Local private mail
- Subscribed public conferences with reliable new-message scanning
- Offline message packets
- Curated file libraries
- Doors, chat, polls, graffiti, callers, and other small community surfaces
- Scheduled store-and-forward exchange between trusted Nodehouse nodes
- Optional compatibility adapters for QWK, FTN/FidoNet, and NNTP

The connective product idea is already in the name: messages, replies, files, and network traffic move in visible packets.

## Decisions recommended for approval

1. Keep **The Nodehouse** as the main product identity and **Nodehouse** as the powering platform and repository name.
2. Keep the implemented **Vibe Community** section as a special-interest district rather than the main shell identity.
3. Keep Vibe Coding, AI Workflows, Vibe Wars, Dungeon of the Vibe Lords, neon ANSI treatments, and experimental features inside that community.
4. Keep local mail, public conferences, network echoes, and external news as distinct user concepts.
5. Implement BBS-era reader behavior before exposing historical network protocols.
6. Use a canonical Nodehouse data model; treat QWK, FTN packets, NNTP articles, and SMTP messages as import/export adapters.
7. Begin PacketNet federation as a small authenticated hub-and-spoke network.
8. Treat public Usenet feeds and Internet email as later operational products, not simple feature toggles.

## Product model

| Nodehouse layer | Historical analogue | Intended behavior |
|---|---|---|
| Local E-Mail | BBS private mail | Private mail between callers on one board |
| Local Conferences | Message bases/subboards | Public discussions that never leave this system |
| PacketNet Echoes | FidoNet EchoMail | Public conferences replicated between trusted Nodehouse nodes |
| NetMail | FidoNet/WWIV network mail | Private queued mail addressed to another board |
| Offline Packets | QWK/REP | Download new content, read and reply offline, import replies later |
| NetNews | Usenet/NNTP | Subscriptions, newscan, threading, filters, and optional real NNTP access |
| File Libraries | BBS file areas | Curated, searchable, moderated file collections |
| Doors | LORD, TradeWars, BRE, utilities | Daily-turn games and external community modules |

### Terminology and provenance

Every conference should disclose its actual scope:

- `[LOCAL]` — exists only on this Nodehouse
- `[PACKETNET]` — replicated with Nodehouse peers
- `[FIDONET]` — imported from or exported to a configured FTN network
- `[USENET]` — backed by a real configured NNTP source
- `[READ ONLY]` — callers cannot post
- `[MODERATED]` — submissions wait for approval
- `[DELAYED]` — transfer is queued for a later mail run

Do not label a local discussion area “Usenet” until real NNTP-backed content exists.

## Proposed information architecture

```text
The Nodehouse
├── Start Here
│   ├── Announcements
│   ├── New User Help
│   └── Board Business
├── Local Boards                         [LOCAL]
│   ├── General Discussion
│   ├── Show & Tell
│   ├── Help Desk
│   └── Projects
├── Vibe Community                       [LOCAL]
│   ├── Vibe Lounge
│   ├── Vibe Coding
│   ├── AI Workflows
│   ├── Build Logs
│   └── Vibe Wars
├── Network Conferences
│   ├── PacketNet Echoes                 [PACKETNET]
│   ├── FidoNet Echoes                   [FIDONET]
│   └── Internet Newsgroups              [USENET]
├── E-Mail
│   ├── Inbox
│   ├── Sent
│   ├── Saved
│   ├── Drafts
│   └── Postmaster / SysOp
├── NetMail
│   ├── Compose
│   ├── Outbox / Queue
│   └── Mailer Status
├── Offline Packets
│   ├── Configure Newscan
│   ├── Download Packet Briefcase
│   ├── Download QWK
│   └── Upload REP
├── File Libraries
├── Door Arcade
└── Community
    ├── Who's Online
    ├── Last Callers
    ├── One-Liners
    ├── Voting Booth
    └── Member Directory
```

## The caller experience

The defining BBS experience was a repeatable session, not merely ANSI styling:

```text
CONNECT
  -> identify caller and terminal
  -> last-call and system-news summary
  -> mail-waiting notice
  -> scan subscribed conferences
  -> scan new files, polls, and callers
  -> doors, chat, and local community
  -> deliberate logoff
```

### Highest-value caller features

- “What is new since your last call?” summary
- Per-user conference subscriptions and ordering
- Correct unread counts and last-read/high-water pointers
- Next unread, next unread thread, catch up, and mark unread
- Public follow-up versus private reply
- Editable `> ` quoted replies
- Compact signatures using the conventional `-- ` delimiter
- Novice menus and terse expert-mode prompts
- Last callers, member directory, caller spotlight, birthdays/anniversaries by opt-in
- A status line showing active conference, unread mail, online callers, and optional session time

## Communication layers

### Local E-Mail

Local mail should remain a simple, identity-bound mailbox:

- Inbox, Sent, Saved, and Drafts
- Reply, forward, CC, and multiple recipients
- Delivery/read receipts where appropriate
- Address book and aliases such as `SYSOP` and `POSTMASTER`
- Thread identity and quoted replies
- Immediate local delivery and live notification

Local mail should not be delayed artificially. The mail-run presentation belongs to network traffic.

### NetMail

NetMail is asynchronous private mail between boards:

```text
IAN @ CROSSTOWN.PACKET

COMPOSED -> QUEUED -> NEXT MAIL RUN -> ROUTED -> DELIVERED
```

Advanced routing flavors may preserve historical language:

- Normal — send during the next scheduled run
- Urgent/Crash — attempt prompt delivery
- Direct — bypass the usual hub when policy permits
- Hold — wait for the destination to poll

Network mail must not be described as end-to-end encrypted. Historical private mail could be visible to intermediate operators and mail software.

### Public conferences and PacketNet echoes

Local conferences stay local. PacketNet echoes replicate an article among subscribed nodes while retaining:

- A globally stable message identifier
- Original author and origin node
- Parent/reply identity
- Local publication number in each area
- Route/path and received time
- Moderation and delivery state

The first PacketNet trial should use a hub-and-spoke topology with two or three controlled nodes. Mesh routing can wait until deduplication, moderation, recovery, and operator tooling are proven.

### NetNews and NNTP

Implement the newsreader experience before connecting to an external feed:

- Subscribe and unsubscribe
- Newscan and catch-up
- Stable `Message-ID` and `References` thread trees
- Public follow-up versus private reply
- Crossposting as one article published in several groups
- Author, subject, thread, and subthread filters
- Conference charters and moderated submissions
- Per-group retention

If NNTP compatibility is added:

1. Expose Nodehouse areas to authenticated clients.
2. Start read-only.
3. Add authenticated posting with moderation and rate limits.
4. Optionally ingest a small allowlist of external groups.
5. Do not initially support arbitrary server-to-server transit, binary hierarchies, or external control messages.

### QWK and offline reading

Offline packets should be a product differentiator:

1. A caller selects conferences.
2. Nodehouse gathers new articles, mail, bulletins, and new-file listings.
3. The caller downloads a packet and disconnects.
4. The caller reads and composes replies offline.
5. A later upload imports replies and advances cursors.

Ship this in two levels:

- **Packet Briefcase:** a friendly ZIP containing Markdown/JSON content and a reply manifest
- **QWK/REP:** compatibility with historical offline readers

QWK is a boundary format. Fixed-width fields, DOS code pages, ZIP traversal, decompression bombs, and replayed REP packets must not leak into the canonical storage model.

## Existing implementation baseline

The current code already provides:

- Shared Telnet and WebSocket `BBSSession` handling
- Multi-node presence and broadcasts
- A “Since Your Last Call” summary with mail, unread message, new-file, caller, and daily-call counts
- A compact traditional main command shell with persistent novice, expert, and super-expert modes
- A global new-message scan that uses per-user read records across accessible conferences
- Conference-aware message display with separate public follow-up and private E-Mail reply paths
- Last Callers and idempotent logoff/disconnect cleanup
- Local message bases and a reply pointer
- Per-message read records and conference unread counts
- Local private mail and online-recipient notification
- Bulletins, MOTD, chat rooms, polls, graffiti, caller logs, and SysOp paging
- Five door games
- File-area metadata
- A web SysOp panel
- SQLite persistence

The rename work preserves stable message-base IDs and existing `data/packetbbs.db` and `data/vibebbs.db` installations while using `data/nodehouse.db` for new installations.

The research and exact implementation boundary for this milestone are recorded in [docs/TRADITIONAL-BBS-RESEARCH.md](docs/TRADITIONAL-BBS-RESEARCH.md).

### Known architectural gaps

- Reader state is per-message only; subscriptions, scan order, high-water pointers, catch-up, and explicit mark-unread are not implemented.
- `messages` uses a local integer ID, username strings, and one local `reply_to` pointer.
- `private_mail` has one recipient, one shared read flag, and no durable sent/delivery/thread state.
- Message-base definitions live in `config.json` rather than the database.
- File areas are metadata-only; upload and download transfer are not implemented.
- The session state machine will become difficult to extend if all new reader, mail, file, and network states stay in one class.

## Recommended data model

Evolve incrementally; do not replace all message storage in one release.

### Core identity and areas

```text
users
  id, stable_uuid, handle, ...

nodes
  id, canonical_name, packetnet_address
  public_key, trust_state, capabilities, ...

areas
  id, stable_tag, display_name, section
  scope: local | echo | news
  posting_policy, moderation_mode, retention_policy, charter
```

### Articles and publication

```text
messages
  id, global_id, origin_node_id
  author_user_id, asserted_author
  subject, body, created_at
  parent_global_id, references
  content_hash, source_format, raw_ingress_id
  state: accepted | quarantined | rejected | tombstoned

message_publications
  message_id, area_id, local_sequence
```

One canonical article may have several publications. This is required for correct crossposting, per-area article numbers, read state, and reply routing.

### Reader state

```text
subscriptions
  user_id, area_id, subscribed, sort_order, high_water_mark

article_state
  user_id, publication_id
  read_at, explicitly_unread, saved, ignored

filter_rules
  user_id, area_id, field, pattern, action, expires_at
```

Prefer exact and glob filter rules initially. Unbounded regular expressions can become a denial-of-service vector.

### Mail and delivery

```text
mail_envelopes
  message_id, sender_identity
  recipient_user_id or destination_address
  privacy_class, priority, delivery_state

peers
  node_id, endpoint, key_fingerprint
  capabilities, trust_level, enabled, poll_schedule, limits

peer_subscriptions
  peer_id, area_id, direction, cursor, posting_allowed

deliveries
  message_id, peer_id, next_hop, transport
  flavor, state, attempts, next_attempt_at
  sent_at, acknowledged_at, error

transfer_batches
  id, peer_id, direction, content_hash
  created_at, state, attempts, raw_object_key

ingress_history
  id_scheme, external_id, content_hash
  source_peer_id, first_seen_at
  UNIQUE(id_scheme, external_id)
```

Content, publication, recipient state, and peer delivery are separate concerns. Deleting a message from one mailbox must not erase the sender's copy, another recipient's copy, or an audit record.

## Suggested service boundaries

The terminal remains the core user experience, but new functionality should move behind focused services:

```text
Telnet/Web UI ─┐
QWK importer ──┤
FTN adapter ───┼─> Canonical message/mail services
NNTP POST ─────┘          │
                          ├─> Local delivery and reader state
                          └─> Outbox/router
                                  │
                         scanner -> packer -> mailer
                                  │
                         PacketNet / FTN / NNTP
```

Likely modules:

- `message-service` — articles, publications, threads, moderation
- `reader-service` — subscriptions, cursors, newscan, filters
- `mail-service` — mailbox state, recipients, receipts, aliases
- `file-service` — libraries, upload quarantine, bundles
- `network-service` — peers, routes, queues, batches, retries
- `adapters/qwk` — QWK export and REP import
- `adapters/ftn` — packet/EchoMail codec and spool boundary
- `adapters/nntp` — authenticated reader/posting interface

## Phased implementation

### Phase 1 — Caller loop and reader correctness

- [x] Fix unread selection for `[N]`
- [x] Add the logon “what is new” summary
- [x] Distinguish public follow-up from private reply
- [x] Add Last Callers
- [x] Add persistent novice/expert/super menu modes
- Add subscribed-area scans
- Add per-area cursor/high-water state
- Add next unread, catch up, and mark unread
- Add quoted replies, signatures, and compact profiles

**Current result:** a caller can log in, see what changed, read only unread material, and choose a public or private response. The phase remains open until conference subscriptions and durable per-conference position are implemented.

### Phase 2 — Message and E-Mail foundation

- Add stable global IDs without changing existing local display IDs
- Add database-backed areas while preserving current numeric IDs
- Add parent/reference metadata and thread views
- Add Inbox/Sent/Saved/Drafts
- Add multiple recipients, CC, reply chains, and receipts
- Add conference charters, moderation queues, and bounded personal filters

**Exit condition:** local behavior is expressive enough to map cleanly to QWK, FTN, and Netnews without protocol-specific storage hacks.

### Phase 3 — Offline packets and file libraries

- Packet Briefcase export/import
- QWK download and REP import
- Replay protection and defensive archive handling
- New-file scans and search
- Extended descriptions and `FILE_ID.DIZ` extraction
- Batch ZIP downloads
- Upload quarantine and SysOp approval

**Exit condition:** callers can complete a useful offline message cycle, and file areas function as curated libraries rather than static catalogs.

### Phase 4 — PacketNet lab

- Signed node identities and directory
- Trusted hub plus two test nodes
- Scheduled mail runs
- Peer subscriptions and routing
- Idempotent batches, acknowledgements, retry/backoff
- Global-ID/content-hash deduplication
- Hop limits, quarantine, moderation, and audit logs
- A caller-facing Mailer Status screen

Suggested initial echoes:

- `PACKET.GENERAL`
- `PACKET.PROJECTS`
- `PACKET.BBSDEV`
- `VIBE.CODING`
- `VIBE.SHOWCASE`

**Exit condition:** a message can cross two nodes exactly once, preserve origin/thread identity, survive retries, and be rejected or quarantined safely.

### Phase 5 — Compatibility adapters

- Authenticated TLS-only NNTP reading
- Restricted NNTP posting
- Optional FTN address/nodelist/packet/EchoMail support through a spool boundary
- Curated read-only external newsgroups
- Internet email only after an explicit operational decision

## Migration guardrails

- Preserve message-base IDs 1 through 5 and existing post associations.
- Use additive SQLite migrations with an explicit schema version.
- Backfill existing content as local content with generated stable identifiers.
- Keep local numeric message numbers for the terminal UI.
- Move area definitions into the database only after a safe config-to-database seed migration exists.
- Match and replace only exact stock seed content; never rewrite caller-authored text because it contains “VibeBBS.”
- Preserve the legacy database fallback until a deliberate migration tool and rollback plan replace it.
- Keep canonical text as Unicode. Convert CP437 and other legacy encodings only at adapter/display boundaries.
- Preserve raw imported headers or packets outside normal render paths for diagnostics.

## Trust, moderation, and abuse controls

Before any node-to-node or public-network connection:

- Authenticate every peer; do not trust claimed node addresses alone.
- Sign or MAC batches and use idempotency tokens.
- Deduplicate by external/global ID plus content hash.
- Quarantine an existing ID that arrives with different content.
- Limit message size, batch size, file count, decompressed size, compression ratio, path length, hop count, attempts, and retention.
- Reject archive path traversal, absolute paths, symlinks, and duplicate filenames.
- Sanitize ANSI and terminal control sequences from network content by default.
- Rate-limit by user, peer, destination, and area.
- Support peer allowlists, area permissions, moderator queues, blocks, tombstones, and audit logs.
- Never let imported `cancel`, `newgroup`, `rmgroup`, or `Approved` fields directly authorize local mutations.
- Publish retention, deletion, gateway, privacy, abuse, and takedown policies before accepting public feeds.

## Features to preserve as flavor, not friction

Historically, time limits, upload ratios, credits, and scheduled mail existed because telephone lines and long-distance transfers were scarce. Modern Nodehouse can reuse the flavor without reproducing the punishment:

- Daily door turns
- Seasonal scoreboards
- Optional focus-session clock
- Contributor credits for cosmetics, extra door turns, or ANSI badges
- Time bank as a game currency

Do not block ordinary community participation behind upload ratios, download credits, or short session limits.

## Explicit non-goals for the first milestones

- An open SMTP relay or complete Internet mail provider
- An arbitrary public Usenet firehose
- Usenet binary groups
- A full peer-to-peer PacketNet mesh
- Treating QWK or FTN packet bytes as native database records
- Assigning every Nodehouse user a FidoNet point number
- Trusting historical control headers as authorization
- Rewriting the terminal product as a conventional social feed

## Review checklist

Current decisions and remaining approvals:

- [x] “Vibe Community” is the implemented section name.
- [ ] PacketNet is the preferred native-network name.
- [x] The first build target began with Caller Loop + Newscan and preserved the existing E-Mail path.
- [ ] Packet Briefcase should precede or ship alongside classic QWK.
- [ ] The first PacketNet topology will be a trusted hub and controlled test nodes.
- [ ] External NNTP groups begin read-only and allowlisted.
- [ ] Internet email remains out of scope until separately approved.
- [x] Stable current message-base IDs and legacy database fallback are preserved.

## Primary historical and protocol references

- [Synchronet User Manual](https://www.synchro.net/docs/user.html) — caller workflow, mail, message scans, files, chat, doors, and QWK
- [Synchronet 2.10 release notes](https://synchro.net/docs/v210_new.txt) — a 1995 local/Fido/Internet hybrid feature set
- [QWK packet layout](https://wmcbrine.com/mmail/specs/qwklay.html) — historical QWK/REP structure
- [FidoNet FTS-0001](https://telematique.org/fidonet/fts-0001.015) — packets, scheduled transfer, routing, and message attributes
- [FidoNet FTS-0004](https://telematique.org/fidonet/fts-0004.txt) — EchoMail areas, origin, `SEEN-BY`, and `PATH`
- [FidoNet FTS-0009](https://telematique.org/fidonet/fts-0009.001) — `MSGID` and `REPLY`
- [FidoNet FSC-0034](https://telematique.org/fidonet/fsc-0034.002) — gateway responsibilities and failure modes
- [RFC 976](https://www.rfc-editor.org/rfc/rfc976.html) — UUCP mail and store-and-forward routing
- [RFC 1036](https://www.rfc-editor.org/rfc/rfc1036.html) — historical Usenet article format and threading fields
- [RFC 1855](https://www.rfc-editor.org/rfc/rfc1855.html) — period Internet and NetNews etiquette
- [RFC 3977](https://www.rfc-editor.org/rfc/rfc3977.html) — current NNTP protocol
- [RFC 5536](https://www.rfc-editor.org/rfc/rfc5536.html) — current Netnews article format

## Recommended next implementation

Continue with **Reader Continuity**: subscriptions and scan ordering, high-water pointers, catch-up/mark-unread, remembered current conference, selected quoting, signatures, and search. That closes the remaining Phase 1 gap before the local E-Mail schema, offline packets, or external networking expand the system.
