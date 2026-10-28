'use strict';

// End-to-end coverage of the offline packet desk (Packet Briefcase + QWK/REP),
// the curated ANSI gallery, and the file libraries — driven against a real
// server process over its real transports.
//
// Advertised behaviour, quoted from README.md:
//
//   "Packet Briefcase & QWK/REP - One-time, expiring browser transfers export
//    readable offline packets and import bounded replies; ZIP traversal,
//    expansion, replay, conference access, and reply-parent checks guard the
//    boundary"
//   "Transfers use short-lived, one-use bearer links over the HTTP listener.
//    Imports are bounded, access checked, parent checked, replay protected by
//    caller/content hash, and committed atomically."
//   "The gallery reads curated .ans files from art/gallery, displays SAUCE
//    title/author/group metadata when present, enforces the 80-column house
//    layout, caps file size, and removes escape sequences that could manipulate
//    the terminal outside the allowed drawing controls."
//   "File Libraries - 4 browsable catalog areas for utilities, text files,
//    caller uploads, and ANSI art (listing/catalog; transfer not yet wired)"
//
// The QWK layout is checked against the historical QWK specification that
// HANDOFF.md points at (wmcbrine.com/mmail/specs/qwklay.html): CONTROL.DAT
// line 10 is the total number of messages and line 11 is the number of
// conferences minus one, then the (number, name) conference pairs follow.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login, register, adminLogin, adminFetch } = require('../helpers/board');
const { createZip, readZip } = require('../../src/packets/archive');
const { MAX_UPLOAD_BYTES } = require('../../src/services/packet-service');

let board;

test.before(async () => {
  board = await startBoard();
});

test.after(async () => {
  if (board) await board.stop();
});

// ─── Packet helpers ───────────────────────────────────────────────────────

const BLOCK = 128;
const EOL = 0xe3;

async function openClient() {
  const client = await board.connectTelnet();
  await login(client, { username: 'SysOp', password: board.sysopPassword });
  return client;
}

async function enterPacketMenu(client) {
  const before = client.mark();
  await client.send('K');
  await client.waitFor(/NODEHOUSE \/\/ PACKET BRIEFCASE/, { timeout: 8000, from: before });
  await client.waitFor(/Packet command: /, { timeout: 8000, from: before });
  return client.since(before);
}

// Runs a packet-menu command, captures its output segment, dismisses the pause
// screen and leaves the caller back at the packet prompt.
async function packetCommand(client, cmd) {
  const before = client.mark();
  await client.send(cmd);
  await client.waitFor(/Press Enter to continue/, { timeout: 8000, from: before });
  const segment = client.since(before);
  await client.send(''); // dismiss the pause screen
  await client.waitFor(/Packet command: /, { timeout: 8000 });
  return segment;
}

function extractToken(segment, format) {
  const match = segment.match(new RegExp(`/transfers/packet/${format}/([A-Za-z0-9_-]+)`));
  assert.ok(match, `expected a ${format} transfer link in:\n${segment}`);
  return match[1];
}

// Writes an ASCII field exactly as src/packets/qwk.js `field()` does.
function qwkField(buffer, offset, length, value) {
  buffer.fill(0x20, offset, offset + length);
  Buffer.from(String(value ?? '').replace(/[^\x20-\x7e]/g, '?'), 'ascii').copy(buffer, offset, 0, length);
}

// Writes raw latin1 bytes without escaping control characters, so a hostile
// reply can carry real terminal-control sequences into the importer.
function rawField(buffer, offset, length, value) {
  buffer.fill(0x20, offset, offset + length);
  Buffer.from(String(value), 'latin1').copy(buffer, offset, 0, length);
}

// Builds a single QWK/REP message record: 128-byte header + padded body blocks.
function repRecord({ id = 1, conference = 1, subject = 'Subject', body = 'Body', replyTo = 0, from = 'SysOp', to = 'All', rawSubject = null }) {
  const normalized = String(body).replace(/\r?\n/g, String.fromCharCode(EOL));
  const raw = Buffer.from(normalized, 'latin1');
  const size = Math.ceil(raw.length / BLOCK) * BLOCK;
  const bodyBuffer = Buffer.alloc(Math.max(BLOCK, size), 0x20);
  raw.copy(bodyBuffer);

  const header = Buffer.alloc(BLOCK, 0x20);
  qwkField(header, 0, 1, ' ');
  qwkField(header, 1, 7, id);
  qwkField(header, 8, 8, '01-01-26');
  qwkField(header, 16, 5, '12:00');
  qwkField(header, 21, 25, to);
  qwkField(header, 46, 25, from);
  if (rawSubject === null) qwkField(header, 71, 25, subject);
  else rawField(header, 71, 25, rawSubject);
  qwkField(header, 108, 8, replyTo);
  qwkField(header, 116, 6, 1 + bodyBuffer.length / BLOCK);
  header[122] = 0xe1;
  header.writeUInt16LE(conference, 123);
  header[127] = 0x20;
  return Buffer.concat([header, bodyBuffer]);
}

// A valid REP archive: a 128-byte leading header record plus message records.
function buildRep(records) {
  const header = Buffer.alloc(BLOCK, 0x20);
  return createZip([{ name: 'MESSAGES.DAT', data: Buffer.concat([header, ...records]) }]);
}

async function postPacket(format, token, body) {
  const response = await board.fetch(`/transfers/packet/${format}/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body,
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, text };
}

// Counts the message records in a MESSAGES.DAT: record 0 is the file header,
// each message is one header block plus its declared body blocks.
function countQwkMessages(dat) {
  let block = 1;
  let count = 0;
  while (block < dat.length / BLOCK) {
    const blocks = Number.parseInt(dat.subarray(block * BLOCK + 116, block * BLOCK + 122).toString('latin1').trim(), 10);
    if (!Number.isSafeInteger(blocks) || blocks < 2) break;
    count += 1;
    block += blocks;
  }
  return count;
}

// ─── Packet Briefcase export ──────────────────────────────────────────────

test('Briefcase export: menu issues a one-use ZIP link and the second GET is refused', async () => {
  const client = await openClient();
  try {
    await enterPacketMenu(client);
    const segment = await packetCommand(client, '1');

    assert.match(segment, /Packet ready \(\d+ messages, expires in 15 minutes\)/);
    const token = extractToken(segment, 'briefcase');

    const download = await board.fetch(`/transfers/packet/briefcase/${token}`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/zip');
    assert.match(download.headers.get('content-disposition') || '', /^attachment; filename="[A-Za-z0-9._-]+"$/);
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');

    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', 'briefcase download must be a ZIP');

    const entries = readZip(bytes);
    assert.ok(entries.has('PACKET.JSON'), 'briefcase ZIP must carry PACKET.JSON');
    assert.ok(entries.has('README.TXT'), 'briefcase ZIP must carry README.TXT');
    const packet = JSON.parse(entries.get('PACKET.JSON').toString('utf8'));
    assert.equal(packet.format, 'nodehouse-briefcase');
    assert.equal(packet.user, 'SysOp');
    assert.ok(Array.isArray(packet.replies));

    // One-use: the bearer link is dead the moment it has been served once.
    const replay = await board.fetch(`/transfers/packet/briefcase/${token}`);
    assert.equal(replay.status, 404);
    assert.match(await replay.text(), /expired or already used/i);

    // A briefcase reply upload round-trips through the real importer.
    packet.replies = [{ baseId: 1, subject: 'Re: Briefcase', body: 'Reply sent from the briefcase.', replyTo: null }];
    const replyZip = createZip([{ name: 'PACKET.JSON', data: JSON.stringify(packet) }]);
    const uploadSegment = await packetCommand(client, '3');
    const uploadToken = extractToken(uploadSegment, 'briefcase');
    const upload = await postPacket('briefcase', uploadToken, replyZip);
    assert.equal(upload.status, 200, `briefcase import failed: ${upload.status} ${upload.text}`);
    assert.equal(upload.json.ok, true);
    assert.equal(upload.json.imported, 1);

    // Replaying the same upload against the same consumed token is refused.
    const replayUpload = await postPacket('briefcase', uploadToken, replyZip);
    assert.equal(replayUpload.status, 404);
  } finally {
    client.close();
  }
});

// ─── QWK export ───────────────────────────────────────────────────────────

test('QWK export: menu issues a link whose ZIP carries a spec-shaped QWK control set', async () => {
  const client = await openClient();
  try {
    await enterPacketMenu(client);
    const segment = await packetCommand(client, '2');
    const token = extractToken(segment, 'qwk');

    const download = await board.fetch(`/transfers/packet/qwk/${token}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition') || '', /^attachment; filename="NODEHOUS\.QWK"$/);

    const bytes = Buffer.from(await download.arrayBuffer());
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'PK\u0003\u0004', 'QWK download must be a ZIP archive');

    const entries = readZip(bytes);
    for (const name of ['CONTROL.DAT', 'MESSAGES.DAT', 'DOOR.ID']) {
      assert.ok(entries.has(name), `QWK ZIP must contain ${name}`);
    }

    const messages = entries.get('MESSAGES.DAT');
    assert.ok(messages.length >= BLOCK, 'MESSAGES.DAT must hold at least the 128-byte header record');
    assert.equal(messages.length % BLOCK, 0, 'MESSAGES.DAT must be a whole number of 128-byte blocks');
    const messageCount = countQwkMessages(messages);

    // CONTROL.DAT layout per the QWK spec: nine fixed header lines, then the
    // total message count (line 10), then conferences-minus-one (line 11),
    // then (number, name) pairs, then HELLO / NEWS / GOODBYE.
    const control = entries.get('CONTROL.DAT').toString('latin1');
    const lines = control.replace(/\r\n$/, '').split('\r\n');
    assert.equal(lines[0], 'The Nodehouse', 'CONTROL.DAT line 1 must name the BBS');
    assert.deepEqual(lines.slice(-3), ['HELLO', 'NEWS', 'GOODBYE'], 'CONTROL.DAT must end with the screen files');

    assert.equal(lines[9], String(messageCount), 'CONTROL.DAT line 10 must be the total number of messages');
    const conferenceCount = (lines.length - 14) / 2;
    assert.ok(Number.isInteger(conferenceCount) && conferenceCount > 0,
      `CONTROL.DAT header/conference list is misaligned (${lines.length} lines): ${JSON.stringify(lines)}`);
    assert.equal(lines[10], String(conferenceCount - 1), 'CONTROL.DAT line 11 must be the number of conferences minus one');
    for (let index = 0; index < conferenceCount; index += 1) {
      assert.match(lines[11 + index * 2], /^\d+$/, `conference #${index + 1} number must be numeric`);
      assert.ok(lines[12 + index * 2].length > 0, `conference #${index + 1} must have a name`);
    }

    // One-use as well.
    const replay = await board.fetch(`/transfers/packet/qwk/${token}`);
    assert.equal(replay.status, 404);
    assert.match(await replay.text(), /expired or already used/i);
  } finally {
    client.close();
  }
});

// ─── REP import ───────────────────────────────────────────────────────────

test('REP import: valid reply imports once, hostile controls are stripped, replays do not double-post', async () => {
  const client = await openClient();
  try {
    const adminToken = await adminLogin(board);
    const countBase1 = async () => {
      const result = await adminFetch(board, adminToken, '/admin/api/messages/1');
      assert.equal(result.status, 200);
      return result.body.length;
    };

    await enterPacketMenu(client);

    // A well-formed REP carrying one reply with hostile terminal controls.
    const hostileRep = buildRep([repRecord({
      id: 1001, conference: 1,
      rawSubject: '\x1b]0;pwned\x07Hi there',
      body: 'First line\x1b[2J\x9b31msecond line',
      replyTo: 0,
    })]);

    // Garbage against a live token is rejected without consuming the token.
    const invalidSegment = await packetCommand(client, '4');
    const invalidToken = extractToken(invalidSegment, 'rep');
    const invalid = await postPacket('rep', invalidToken, Buffer.from('this is not a zip'));
    assert.equal(invalid.status, 400, `garbage REP must be 400, got ${invalid.status} ${invalid.text}`);

    const before = await countBase1();
    const accepted = await postPacket('rep', invalidToken, hostileRep);
    assert.equal(accepted.status, 200, `valid REP rejected: ${accepted.status} ${accepted.text}`);
    assert.equal(accepted.json.ok, true);
    assert.equal(accepted.json.imported, 1, 'the REP declared exactly one reply');
    assert.equal(await countBase1(), before + 1, 'a single accepted REP must post exactly one message');

    // The stored reply must not carry the hijack sequences that were smuggled in.
    const stored = (await adminFetch(board, adminToken, '/admin/api/messages/1')).body
      .find((message) => message.from_user === 'SysOp' && /second line/.test(message.body || ''));
    assert.ok(stored, 'expected the imported reply to be visible in conference 1');
    assert.doesNotMatch(`${stored.subject}${stored.body}`, /[\x1b\x80-\x9f]/, 'imported reply kept raw terminal controls');

    // Same token again: the bearer link was consumed.
    assert.equal((await postPacket('rep', invalidToken, hostileRep)).status, 404);

    // Fresh token, identical content: replay protection by caller/content hash.
    const replaySegment = await packetCommand(client, '4');
    const replayToken = extractToken(replaySegment, 'rep');
    const replay = await postPacket('rep', replayToken, hostileRep);
    assert.equal(replay.status, 400, `replayed content must be refused, got ${replay.status} ${replay.text}`);
    assert.equal(await countBase1(), before + 1, 'a replayed REP must not double-post');

    // A different packet on that same link still imports, and exactly once.
    const secondRep = buildRep([repRecord({ id: 2002, conference: 1, subject: 'Second packet', body: 'A different reply.' })]);
    const second = await postPacket('rep', replayToken, secondRep);
    assert.equal(second.status, 200, `second REP rejected: ${second.status} ${second.text}`);
    assert.equal(second.json.imported, 1);
    assert.equal(await countBase1(), before + 2);

    // Unknown tokens are 404 on both sides of the transfer.
    assert.equal((await postPacket('rep', 'not-a-real-token', hostileRep)).status, 404);
    assert.equal((await board.fetch('/transfers/packet/briefcase/not-a-real-token')).status, 404);
  } finally {
    client.close();
  }
});

// ─── Import boundary checks ───────────────────────────────────────────────

test('Packet import boundary: caller access, reply-parent and reply-count checks hold', async () => {
  const client = await board.connectTelnet();
  try {
    await register(client, { username: 'PacketCaller' });
    await enterPacketMenu(client);

    const adminToken = await adminLogin(board);
    const base1 = (await adminFetch(board, adminToken, '/admin/api/messages/1')).body;
    assert.ok(base1.length > 0, 'conference 1 should have seeded messages');
    const base1MessageId = base1[base1.length - 1].id;

    // Conference 5 is SysOp Corner (accessLevel 200); a fresh caller may not
    // target it, but the same link still accepts a public reply.
    const forbiddenSegment = await packetCommand(client, '4');
    const forbiddenToken = extractToken(forbiddenSegment, 'rep');
    const forbidden = await postPacket('rep', forbiddenToken,
      buildRep([repRecord({ id: 6001, conference: 5, subject: 'Forbidden', body: 'nope' })]));
    assert.equal(forbidden.status, 400, `inaccessible conference must be refused, got ${forbidden.status} ${forbidden.text}`);
    const publicReply = await postPacket('rep', forbiddenToken,
      buildRep([repRecord({ id: 6002, conference: 1, subject: 'Public reply', body: 'hello' })]));
    assert.equal(publicReply.status, 200, `public reply rejected: ${publicReply.status} ${publicReply.text}`);
    assert.equal(publicReply.json.imported, 1);

    // A reply whose parent lives in another conference is refused.
    const parentSegment = await packetCommand(client, '4');
    const parentToken = extractToken(parentSegment, 'rep');
    const crossParent = await postPacket('rep', parentToken,
      buildRep([repRecord({ id: 6003, conference: 2, subject: 'Cross parent', body: 'bad parent', replyTo: base1MessageId })]));
    assert.equal(crossParent.status, 400, `cross-conference parent must be refused, got ${crossParent.status} ${crossParent.text}`);
    const cleanReply = await postPacket('rep', parentToken,
      buildRep([repRecord({ id: 6004, conference: 2, subject: 'Clean reply', body: 'ok' })]));
    assert.equal(cleanReply.status, 200, `clean reply rejected: ${cleanReply.status} ${cleanReply.text}`);

    // More than 100 replies in one REP is refused; a bounded packet still works.
    const bulkSegment = await packetCommand(client, '4');
    const bulkToken = extractToken(bulkSegment, 'rep');
    const bulk = [];
    for (let index = 0; index < 101; index += 1) {
      bulk.push(repRecord({ id: 7000 + index, conference: 1, subject: `Bulk ${index}`, body: `bulk ${index}` }));
    }
    const tooMany = await postPacket('rep', bulkToken, buildRep(bulk));
    assert.equal(tooMany.status, 400, `101 replies must be refused, got ${tooMany.status} ${tooMany.text}`);
    const bounded = await postPacket('rep', bulkToken,
      buildRep([repRecord({ id: 8001, conference: 1, subject: 'Bounded', body: 'one reply' })]));
    assert.equal(bounded.status, 200, `bounded reply rejected: ${bounded.status} ${bounded.text}`);
    assert.equal(bounded.json.imported, 1);
  } finally {
    client.close();
  }
});

// ─── Oversized upload ─────────────────────────────────────────────────────
test('Oversized packet upload is rejected and the active-transfer bound is enforced', async () => {
  const client = await openClient();
  try {
    await enterPacketMenu(client);

    const firstSegment = await packetCommand(client, '4');
    const firstToken = extractToken(firstSegment, 'rep');

    // One byte over the service's advertised maximum.
    const oversized = Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41);
    const rejected = await postPacket('rep', firstToken, oversized);
    assert.ok(rejected.status >= 400, `oversized upload should be refused, got ${rejected.status}`);

    // The rejected oversized body did not consume the token: one more upload
    // link still fits under MAX_ACTIVE_TRANSFERS (2) for this purpose.
    const secondSegment = await packetCommand(client, '4');
    extractToken(secondSegment, 'rep');

    // A third concurrent upload link must hit the active-transfer ceiling.
    const thirdSegment = await packetCommand(client, '4');
    assert.match(thirdSegment, /Too many active packet uploads/, `expected the active-transfer bound:\n${thirdSegment}`);
  } finally {
    client.close();
  }
});

// ─── ANSI gallery ─────────────────────────────────────────────────────────

test('ANSI Gallery: curated works list with metadata, every piece fits 80 columns and pauses', async () => {
  const client = await openClient();
  try {
    const before = client.mark();
    await client.send('A');
    await client.waitFor(/NODEHOUSE \/\/ ANSI ART GALLERY/, { timeout: 8000, from: before });
    await client.waitFor(/Gallery #: /, { timeout: 8000, from: before });
    const listing = client.since(before);

    // The four curated works ship with derived title/author metadata.
    const works = [
      { number: 1, title: '01 nodehouse' },
      { number: 2, title: '02 wire city' },
      { number: 3, title: '03 sysop den' },
      { number: 4, title: '04 packet ship' },
    ];
    for (const work of works) {
      assert.match(listing, new RegExp(`${work.number}\\.\\s+${work.title}`), `gallery listing missing work ${work.number}`);
    }
    assert.match(listing, /Nodehouse Art Depa/, 'each work lists an author');

    // Every piece renders, is bounded to 80 columns, and pauses.
    for (const work of works) {
      const rawStart = client.raw.length;
      const viewBefore = client.mark();
      await client.send(String(work.number));
      await client.waitFor(/Press Enter to continue/, { timeout: 8000, from: viewBefore });
      const view = client.since(viewBefore);

      assert.doesNotMatch(view, /Artwork unavailable/, `work ${work.number} failed to render: ${view}`);
      assert.match(view, new RegExp(`${work.title} \/\/ Nodehouse Art Department`), `work ${work.number} footer missing`);
      for (const line of view.split(/\r?\n/)) {
        assert.ok([...line].length <= 80, `work ${work.number} line exceeds 80 columns: ${JSON.stringify(line)}`);
      }

      // The only escapes in the rendered screen are the screen clear and colour
      // SGRs; no cursor/title/device-control sequence survives to the terminal.
      const rawView = client.raw.subarray(rawStart).toString('utf8');
      const withoutClear = rawView.split('\x1b[2J\x1b[1;1H').join('');
      const strayEscapes = withoutClear.match(/\x1b(?!\[[0-9;]*m)/g) || [];
      assert.equal(strayEscapes.length, 0, `work ${work.number} leaked terminal-control escapes: ${JSON.stringify(rawView)}`);

      // Dismissing the pause returns to the gallery index.
      const afterView = client.mark();
      await client.send('');
      await client.waitFor(/Gallery #: /, { timeout: 8000, from: afterView });
    }

    await client.sendAndWait('Q', /Main command \(/, { timeout: 8000 });
  } finally {
    client.close();
  }
});

// ─── File libraries ───────────────────────────────────────────────────────

test('File Libraries: four advertised areas list and every catalog renders', async () => {
  const client = await openClient();
  try {
    const before = client.mark();
    await client.send('F');
    await client.waitFor(/File Libraries/, { timeout: 8000, from: before });
    await client.waitFor(/Area #: /, { timeout: 8000, from: before });
    const areas = client.since(before);

    const catalogs = [
      { number: 1, name: 'Utilities', description: 'Useful programs, scripts, and tools' },
      { number: 2, name: 'Text Files & Docs', description: 'Guides, references, and community text files' },
      { number: 3, name: 'Community Uploads', description: 'Files contributed by Nodehouse callers' },
      { number: 4, name: 'ANSI Art', description: 'ANSI art files and packs' },
    ];
    for (const area of catalogs) {
      assert.match(areas, new RegExp(escapeRegExp(area.name)), `missing file area: ${area.name}`);
    }

    // Entering each area opens its catalog screen (listing + metadata only;
    // README notes that upload/download transfer is not yet wired).
    for (const area of catalogs) {
      const listBefore = client.mark();
      await client.send(String(area.number));
      await client.waitFor(/Command: /, { timeout: 8000, from: listBefore });
      const list = client.since(listBefore);
      assert.match(list, new RegExp(escapeRegExp(area.name)), `area ${area.number} header missing`);
      assert.match(list, new RegExp(escapeRegExp(area.description)), `area ${area.number} description missing`);
      assert.match(list, /No files in this area yet|Filename/, `area ${area.number} catalog did not render`);
      await client.sendAndWait('Q', /Area #: /, { timeout: 8000 });
    }

    await client.sendAndWait('Q', /Main command \(/, { timeout: 8000 });
  } finally {
    client.close();
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
