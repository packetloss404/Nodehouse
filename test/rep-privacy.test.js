'use strict';

// A reply composed offline in a QWK reader carries a status byte and a To
// field. A private reply must become local mail, never a public conference
// post — that was a real disclosure bug.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-rep-privacy-'));
const previousDbPath = process.env.NODEHOUSE_DB_PATH;
const previousNodeEnv = process.env.NODE_ENV;
process.env.NODEHOUSE_DB_PATH = path.join(dir, 'nodehouse.db');
process.env.NODE_ENV = 'test';

const database = require('../src/core/database');
const { createZip, readZip } = require('../src/packets/archive');
const { exportQwk, importRep } = require('../src/packets/qwk');

const ZIP_LIMITS = { entries: 16, entryBytes: 4 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 };

let db;

test.after(() => {
  if (db && db.open) db.close();
  if (previousDbPath === undefined) delete process.env.NODEHOUSE_DB_PATH;
  else process.env.NODEHOUSE_DB_PATH = previousDbPath;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  fs.rmSync(dir, { recursive: true, force: true });
});

// Builds a REP from a real QWK export, then flips the status byte and To field.
function buildRep({ to, privateReply }) {
  const qwk = exportQwk({
    user: 'RepCaller',
    conferences: [{ id: 1, name: 'General' }],
    messages: [{ id: 9, base_id: 1, from_user: 'SysOp', to_user: to, subject: 'Offline reply', body: 'Written away from the board' }],
  });
  const entries = readZip(qwk, ZIP_LIMITS);
  const records = Buffer.from(entries.get('MESSAGES.DAT'));
  const offset = 128; // skip the packet header block
  records[offset] = privateReply ? 0x2a : 0x20;
  records.fill(0x20, offset + 21, offset + 46);
  Buffer.from(to, 'latin1').copy(records, offset + 21);
  return createZip([{ name: 'MESSAGES.DAT', data: records }]);
}

function ensureDb() {
  if (!db || !db.open) db = database.init();
  return db;
}

test('a private REP reply becomes mail and never appears in the conference', () => {
  ensureDb();
  const replies = importRep(buildRep({ to: 'SysOp', privateReply: true }), new Map([[1, 1]]));
  assert.equal(replies.length, 1);
  assert.equal(replies[0].private, true);
  assert.equal(replies[0].to, 'SysOp');

  const caller = database.users.create('RepPrivate', 'long-enough-password', 'Rep Private');
  database.offlinePackets.importReplies({
    userId: caller.id, username: 'RepPrivate', format: 'rep', contentHash: 'rep-private', replies,
  });

  const inbox = database.privateMail.getInbox('SysOp');
  assert.ok(
    inbox.some((mail) => mail.subject === 'Offline reply' && /Written away from the board/.test(mail.body)),
    'the private reply should arrive as local mail',
  );

  const publicPosts = database.messages.getByBase(1)
    .filter((message) => message.subject === 'Offline reply' && message.from_user === 'RepPrivate');
  assert.equal(publicPosts.length, 0, 'a private reply must not be posted publicly');
});

test('a public REP reply still posts to the conference', () => {
  ensureDb();
  const replies = importRep(buildRep({ to: 'All', privateReply: false }), new Map([[1, 1]]));
  assert.equal(replies[0].private, false);

  const caller = database.users.create('RepPublic', 'long-enough-password', 'Rep Public');
  database.offlinePackets.importReplies({
    userId: caller.id, username: 'RepPublic', format: 'rep', contentHash: 'rep-public', replies,
  });

  const posts = database.messages.getByBase(1)
    .filter((message) => message.subject === 'Offline reply' && message.from_user === 'RepPublic');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].to_user, 'All');
});

test('a private reply to an unknown recipient is rejected instead of leaked', () => {
  ensureDb();
  const replies = importRep(buildRep({ to: 'GhostCaller', privateReply: true }), new Map([[1, 1]]));
  const caller = database.users.create('RepGhost', 'long-enough-password', 'Rep Ghost');

  assert.throws(() => database.offlinePackets.importReplies({
    userId: caller.id, username: 'RepGhost', format: 'rep', contentHash: 'rep-ghost', replies,
  }), /unknown recipient/i);

  const posts = database.messages.getByBase(1)
    .filter((message) => message.subject === 'Offline reply' && message.from_user === 'RepGhost');
  assert.equal(posts.length, 0, 'a rejected private reply must not fall back to a public post');
  assert.equal(database.privateMail.getInbox('GhostCaller').length, 0);
});
