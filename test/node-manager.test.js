'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const NodeManager = require('../src/server/node-manager');

function addCaller(manager, username) {
  const writes = [];
  const nodeNum = manager.allocateNode({ write: (value) => writes.push(value) });
  manager.setUsername(nodeNum, username);
  return { nodeNum, writes };
}

test('presence is validated and exposed without leaking session objects', () => {
  const manager = new NodeManager(2);
  const alice = addCaller(manager, 'Alice');
  const presence = manager.setPresence(alice.nodeNum, 'Away', 'getting coffee\r\n\x1b[31m');
  assert.equal(presence.presence, 'away');
  assert.equal(presence.statusMessage, 'getting coffee');
  assert.equal('session' in manager.getOnlineUsers()[0], false);
  assert.throws(() => manager.setPresence(alice.nodeNum, 'invisible'), /Unknown presence/);
});

test('pages require the target, respect DND, expire, and enforce cooldowns', () => {
  let now = 1_000;
  const manager = new NodeManager(3, { now: () => now, pageTtlMs: 100, pageCooldownMs: 50 });
  const alice = addCaller(manager, 'Alice');
  const bob = addCaller(manager, 'Bob');
  assert.equal(manager.pageUser(alice.nodeNum, 'nobody').code, 'OFFLINE');
  manager.setPresence(bob.nodeNum, 'dnd');
  assert.equal(manager.pageUser(alice.nodeNum, 'Bob').code, 'DO_NOT_DISTURB');
  manager.setPresence(bob.nodeNum, 'available');
  const page = manager.pageUser(alice.nodeNum, 'Bob', 'hi\r\nthere');
  assert.equal(page.ok, true);
  assert.equal(page.invitation.message, 'hi there');
  assert.equal(manager.pageUser(alice.nodeNum, 'Bob').code, 'COOLDOWN');
  assert.equal(manager.acceptPage(alice.nodeNum, page.invitation.id).code, 'FORBIDDEN');
  now += 101;
  assert.deepEqual(manager.getPendingPages(bob.nodeNum), []);
  assert.equal(manager.acceptPage(bob.nodeNum, page.invitation.id).code, 'NOT_FOUND');
});

test('accepted pages create authorized private chats and disconnect cleanly', () => {
  const manager = new NodeManager(3, { pageCooldownMs: 1 });
  const alice = addCaller(manager, 'Alice');
  const bob = addCaller(manager, 'Bob');
  const eve = addCaller(manager, 'Eve');
  const page = manager.pageUser(alice.nodeNum, bob.nodeNum, 'chat?');
  const accepted = manager.acceptPage(bob.nodeNum, page.invitation.id);
  assert.equal(accepted.ok, true);
  assert.equal(manager.sendPrivateChat(eve.nodeNum, 'snoop').code, 'NOT_IN_CHAT');
  assert.equal(manager.sendPrivateChat(alice.nodeNum, '\x1b[31mhello Bob').ok, true);
  assert.match(bob.writes.at(-1), /hello Bob/);
  assert.doesNotMatch(bob.writes.at(-1), /\x1b\[31m/);
  manager.releaseNode(alice.nodeNum);
  assert.equal(manager.getNode(bob.nodeNum).privateChatId, null);
  assert.match(bob.writes.at(-1), /disconnected/);
});

test('telegrams use the configured durable fallback', () => {
  const sent = [];
  let now = 1000;
  const manager = new NodeManager(1, { now: () => now, sendTelegram: (...args) => sent.push(args) });
  const alice = addCaller(manager, 'Alice');
  assert.equal(manager.telegram(alice.nodeNum, 'Bob', 'meet me on the porch').ok, true);
  assert.deepEqual(sent, [['Alice', 'Bob', 'meet me on the porch']]);
  assert.equal(manager.telegram(alice.nodeNum, 'Carol', 'too fast').code, 'COOLDOWN');
  now += 1000;
  assert.deepEqual(manager.pageOrTelegram(alice.nodeNum, 'OfflineBob', 'left a note'), { ok: true, telegram: true });
  assert.deepEqual(sent[1], ['Alice', 'OfflineBob', 'left a note']);
  manager.releaseNode(alice.nodeNum);
  const reconnected = addCaller(manager, 'Alice');
  assert.equal(manager.telegram(reconnected.nodeNum, 'Bob', 'reconnect bypass').code, 'COOLDOWN');
});
