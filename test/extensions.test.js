'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const { createZip, readZip } = require('../src/packets/archive');
const { exportBriefcase, importBriefcase } = require('../src/packets/briefcase');
const { exportQwk, importRep } = require('../src/packets/qwk');
const { AnsiGallery, sanitizeAnsi, decodeCp437 } = require('../src/services/ansi-gallery');
const { DoorService } = require('../src/services/door-service');
const { PacketService, hashToken } = require('../src/services/packet-service');

test('bounded ZIP packets round-trip and reject archive traversal', () => {
  const archive = createZip([{ name: 'HELLO.TXT', data: 'hello' }]);
  assert.equal(readZip(archive).get('HELLO.TXT').toString(), 'hello');
  assert.throws(() => createZip([{ name: '../escape', data: 'nope' }]), /paths/);
});

test('Packet Briefcase exports content and imports validated replies only', () => {
  const exported = exportBriefcase({ bbs: 'The Nodehouse', user: 'Caller', messages: [{ id: 1 }] });
  const packet = JSON.parse(readZip(exported).get('PACKET.JSON'));
  packet.replies = [{ baseId: 1, subject: 'Re: hello', body: 'Packet reply', replyTo: 1 }];
  const upload = createZip([{ name: 'PACKET.JSON', data: JSON.stringify(packet) }]);
  assert.deepEqual(importBriefcase(upload), [{ baseId: 1, subject: 'Re: hello', body: 'Packet reply', replyTo: 1 }]);
  packet.replies = [{ baseId: 0, subject: 'bad', body: 'bad' }];
  assert.throws(() => importBriefcase(createZip([{ name: 'PACKET.JSON', data: JSON.stringify(packet) }])), /conference/);
  packet.replies = [{ baseId: 1, subject: 'safe\x1b]0;spoof\x07', body: 'hello\x1b[2J\x9b31mworld' }];
  const sanitized = importBriefcase(createZip([{ name: 'PACKET.JSON', data: JSON.stringify(packet) }]))[0];
  assert.doesNotMatch(`${sanitized.subject}${sanitized.body}`, /[\x1b\x80-\x9f]/);
  assert.match(sanitized.body, /hello.*world/);
});

test('QWK messages export and REP replies parse using conference map', () => {
  const qwk = exportQwk({
    user: 'Caller', conferences: [{ id: 42, name: 'General' }],
    messages: [{ id: 9, base_id: 42, from_user: 'SysOp', to_user: 'All', subject: 'Welcome', body: 'Line one\r\nLine two' }],
  });
  const entries = readZip(qwk, { entries: 16, entryBytes: 4 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 });
  const records = entries.get('MESSAGES.DAT');
  const rep = createZip([{ name: 'MESSAGES.DAT', data: records }]);
  const replies = importRep(rep, new Map([[42, 42]]));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].baseId, 42);
  assert.equal(replies[0].subject, 'Welcome');
  assert.match(replies[0].body, /Line two/);

  const hostile = Buffer.from(records);
  hostile.write('\x1b]0;spoof\x07HELLO\x9b31m', 128, 'latin1');
  const hostileReplies = importRep(createZip([{ name: 'MESSAGES.DAT', data: hostile }]), new Map([[42, 42]]));
  assert.doesNotMatch(hostileReplies[0].body, /[\x1b\x80-\x9f]/);
});

test('ANSI gallery exposes curated 80-column art and strips dangerous controls', () => {
  const gallery = new AnsiGallery(path.join(__dirname, '..', 'art', 'gallery'));
  assert.ok(gallery.list().length >= 4);
  assert.match(gallery.read('01_nodehouse').content, /N O D E H O U S E/);
  assert.equal(sanitizeAnsi('\x1b]0;owned\x07safe\x1b[31mred'), 'safe\x1b[31mred');
  assert.equal(sanitizeAnsi('\x1b[2Jcannot-clear'), 'cannot-clear');
  assert.equal(sanitizeAnsi(`safe${String.fromCharCode(0x9b)}31m`), 'safe31m');
  assert.equal(decodeCp437(Buffer.from([0xdb, 0xb0])), '█░');
  assert.throws(() => gallery.read('../secrets'), /Invalid artwork/);
});

test('DoorService uses the trusted registry, enforces admission, saves, and records scores', () => {
  const calls = [];
  const database = { doors: {
    beginRun: () => ({ allowed: true, remaining: 4, runId: 7 }),
    getSave: () => ({ state: { player: { credits: 4321, turnsLeft: 5, hull: 100 } } }),
    save: (...args) => calls.push(['save', ...args]),
    finishRun: (...args) => calls.push(['finish', ...args]),
    getLeaderboard: () => [{ username: 'Caller', score: 4321 }],
  } };
  const session = { user: { id: 3, username: 'Caller' }, write() {}, prompt() {}, exitDoor() { calls.push(['exit']); } };
  const service = new DoorService(database);
  assert.throws(() => service.launch(session, '../../evil'), /Unknown door/);
  const launched = service.launch(session, 1);
  assert.equal(launched.door.player.credits, 4321);
  launched.door.handleInput('M');
  session.exitDoor();
  assert.ok(calls.some(call => call[0] === 'finish' && call[1] === 7));
  assert.deepEqual(service.leaderboard(1), [{ username: 'Caller', score: 4321 }]);
});

test('PacketService issues hashed one-shot transfers and validates imports before posting', () => {
  const transferDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-packets-'));
  const transfers = new Map();
  const posts = [];
  const readMarks = [];
  let exportedPacket = null;
  let nextTransfer = 1;
  const database = {
    messages: {
      getUnreadByBases: () => [{ id: 1, base_id: 1, from_user: 'SysOp', subject: 'Hi', body: 'Welcome' }],
      getById: id => id === 1 ? { id: 1, base_id: 1 } : null,
      create: (...args) => posts.push(args),
      markRead: (...args) => readMarks.push(args),
    },
    privateMail: { getInbox: () => [] }, bulletins: { getActive: () => [] },
    users: { getById: () => ({ id: 2, username: 'Caller', access_level: 10 }), incrementPosts() {} },
    transfers: {
      create(userId, purpose, tokenHashValue, filename, mimeType, size, expiresAt) {
        const row = { id: nextTransfer++, user_id: userId, purpose, token_hash: tokenHashValue, filename, mime_type: mimeType, size, expires_at: expiresAt };
        transfers.set(tokenHashValue, row); return row;
      },
      consume(tokenHashValue, purpose) {
        const row = transfers.get(tokenHashValue);
        if (!row || row.purpose !== purpose || row.used) return null;
        row.used = true; return row;
      },
      get(tokenHashValue, purpose) {
        const row = transfers.get(tokenHashValue);
        return row && row.purpose === purpose && !row.used ? row : null;
      },
      countActive(userId, purpose) {
        return [...transfers.values()].filter(row => row.user_id === userId && row.purpose === purpose && !row.used).length;
      },
      countRecent(userId, purposePrefix) {
        return [...transfers.values()].filter(row => row.user_id === userId && row.purpose.startsWith(purposePrefix)).length;
      },
      revokeExpired: () => 0,
    },
    offlinePackets: {
      create(value) {
        const packet = { id: 'packet-id', metadata: value.metadata, ...value };
        if (value.direction === 'export') exportedPacket = packet;
        return packet;
      },
      markConsumed: () => true,
      findImportedHash: () => null,
      findByTransferId: () => exportedPacket,
      importReplies({ username, replies }) {
        for (const reply of replies) posts.push([reply.baseId, username, 'All', reply.subject, reply.body, reply.replyTo]);
        return { imported: replies.length };
      },
    },
  };
  const service = new PacketService({
    database, transferDir,
    config: { bbsName: 'The Nodehouse', sysopName: 'SysOp', messageBases: [{ id: 1, name: 'General', accessLevel: 10 }] },
  });
  const user = { id: 2, username: 'Caller', access_level: 10 };
  const exported = service.createExport(user, 'briefcase');
  assert.equal(transfers.has(exported.token), false);
  assert.equal(transfers.has(hashToken(exported.token)), true);
  const download = service.consumeDownload(exported.token, 'briefcase');
  assert.ok(download.content.length > 0);
  assert.deepEqual(readMarks, []);
  download.complete();
  assert.deepEqual(readMarks, [[1, user.id]]);
  assert.equal(service.consumeDownload(exported.token, 'briefcase'), null);
  service.createExport(user, 'briefcase');
  service.createExport(user, 'briefcase');
  assert.throws(() => service.createExport(user, 'briefcase'), /Too many active/);
  database.transfers.countRecent = () => 6;
  assert.throws(() => service.createExport(user, 'qwk'), /generation limit/);
  database.transfers.countRecent = () => 0;

  const upload = service.createImport(user, 'briefcase');
  const packet = { format: 'nodehouse-briefcase', version: 1, replies: [{ baseId: 1, subject: 'Re: Hi', body: 'Thanks', replyTo: 1 }] };
  const result = service.consumeUpload(upload.token, 'briefcase', createZip([{ name: 'PACKET.JSON', data: JSON.stringify(packet) }]));
  assert.equal(result.imported, 1);
  assert.equal(posts.length, 1);
  assert.equal(service.consumeUpload(upload.token, 'briefcase', Buffer.from('again')), null);
  fs.rmSync(transferDir, { recursive: true, force: true });
});
