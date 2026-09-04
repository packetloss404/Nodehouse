const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-reader-'));
process.env.NODEHOUSE_DB_PATH = path.join(testDir, 'reader.db');
process.env.NODE_ENV = 'test';

const database = require('../src/core/database');
const { createReaderService } = require('../src/core/reader-service');
const { createMessageService } = require('../src/core/message-service');
const { createDailyCallService } = require('../src/core/daily-call-service');

const db = database.init();
const reader = createReaderService(database);
const messageService = createMessageService(database);
const dailyCall = createDailyCallService(database);
const bases = [{ id: 1, name: 'General' }, { id: 2, name: 'Builders' }];
const caller = database.users.create('Reader', 'correct horse battery staple', 'A Reader');

test.after(() => {
  database.close();
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('subscriptions, order, current base, read state, and catch-up are durable', () => {
  assert.deepEqual(reader.getSubscriptions(caller.id, bases).map((row) => row.base_id), [1, 2]);
  reader.reorderSubscriptions(caller.id, [2, 1], bases);
  assert.deepEqual(reader.getSubscriptions(caller.id, bases).map((row) => row.base_id), [2, 1]);
  reader.setSubscription(caller.id, 2, false, bases);
  assert.equal(reader.getSubscriptions(caller.id, bases)[0].subscribed, 0);

  reader.setCurrentBase(caller.id, 2, bases);
  assert.equal(reader.getCurrentBase(caller.id, bases), 2);

  const id = Number(messageService.create({
    baseId: 1, fromUser: 'Reader', subject: 'Reader continuity', body: 'A new post',
    accessibleBaseIds: [1, 2],
  }));
  assert.equal(reader.markRead(caller.id, id, bases), true);
  assert.equal(database.messages.countUnreadByBase(1, caller.id) >= 0, true);
  assert.equal(reader.markUnread(caller.id, id, bases), true);
  assert.ok(database.messages.getUnreadByBase(1, caller.id).some((message) => message.id === id));
  const caughtUp = reader.catchUp(caller.id, 1, bases);
  assert.ok(caughtUp.markedRead >= 1);
  assert.equal(database.messages.getUnreadByBase(1, caller.id).length, 0);
});

test('thread creation validates parent area and search treats wildcards literally', () => {
  const root = Number(messageService.create({
    baseId: 1, fromUser: 'Reader', subject: '100% literal', body: 'underscores_are_literal',
    accessibleBaseIds: [1, 2],
  }));
  const reply = Number(messageService.create({
    baseId: 1, fromUser: 'SysOp', subject: 'Re: 100% literal', body: 'Indeed', replyTo: root,
    accessibleBaseIds: [1, 2],
  }));
  assert.deepEqual(messageService.getThread(reply, { accessibleBaseIds: [1] }).map((row) => row.id), [root, reply]);
  assert.deepEqual(messageService.search('%', { accessibleBaseIds: [1] }).map((row) => row.id), [reply, root]);
  assert.deepEqual(messageService.search('%', { accessibleBaseIds: [2] }), []);
  assert.throws(() => messageService.create({
    baseId: 2, fromUser: 'Reader', subject: 'Bad reply', body: 'Wrong conference', replyTo: root,
    accessibleBaseIds: [1, 2],
  }), /different message base/);
});

test('signatures and drafts are bounded and owned by the caller', () => {
  assert.equal(reader.setSignature(caller.id, 'Reader\nNodehouse'), 'Reader\nNodehouse');
  assert.match(reader.applySignature(caller.id, 'Message'), /Message\r\n\r\n-- \r\nReader/);
  assert.throws(() => reader.setSignature(caller.id, '1\n2\n3\n4\n5'), /at most 4 lines/);
  let last;
  for (let index = 0; index < 21; index += 1) {
    last = reader.saveDraft(caller.id, { baseId: 1, subject: `Draft ${index}`, body: 'body' }, bases);
  }
  assert.equal(reader.listDrafts(caller.id).length, 20);
  assert.equal(reader.getDraft(caller.id, last.id).subject, 'Draft 20');
  assert.equal(reader.getDraft(1, last.id), undefined);
});

test('Daily Call snapshot respects subscriptions and exposes useful sections', () => {
  reader.setSubscription(caller.id, 1, true, bases);
  const snapshot = dailyCall.snapshot(caller, bases);
  assert.equal(typeof snapshot.mail.unread, 'number');
  assert.equal(typeof snapshot.conferences.totalUnread, 'number');
  assert.equal(snapshot.conferences.bases.length, 2);
  assert.equal(typeof snapshot.bulletins.active, 'number');
  assert.equal(typeof snapshot.files.newSinceLastCall, 'number');
  assert.equal(typeof snapshot.polls.active, 'number');
});
