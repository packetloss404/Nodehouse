'use strict';

// The First Call Quest: three steps on a first call, then a badge and a banked
// door turn. It is orientation, not probation — the caller can speak throughout.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startBoard, register } = require('../helpers/board');

test('a first call completes three steps and earns the badge', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await register(client, { username: 'QuestE2E' });

    assert.match(client.text(), /FIRST CALL 0\/3/);

    // Step 1 — read a thread.
    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);
    await client.sendAndWait('1', /F\/R\/T\/U\/N\/P\/Q: /);
    await client.sendAndWait('Q', /Message command:/);
    await client.sendAndWait('Q', /Conference #:/);
    await client.sendAndWait('Q', /Main command \(/);
    assert.match(client.text(), /FIRST CALL 1\/3/);

    // Step 2 — leave a one-liner.
    await client.sendAndWait('O', /Command: /);
    await client.sendAndWait('W', /One-liner \(max 38 chars\): /);
    await client.sendAndWait('Quest says hello', /Command: /);
    await client.sendAndWait('Q', /Main command \(/);
    assert.match(client.text(), /FIRST CALL 2\/3/);

    // Step 3 — say hello in chat.
    await client.sendAndWait('T', /Room #: /);
    await client.sendAndWait('1', /> /);
    await client.sendAndWait('hello nodehouse', /> /);
    await client.sendAndWait('/Q', /Room #: /);
    await client.sendAndWait('Q', /Main command \(/);
    assert.match(client.text(), /First Call complete/);
    assert.match(client.text(), /★ First Call/);

    const raw = new Database(path.join(board.dir, 'nodehouse.db'));
    const row = raw.prepare('SELECT quest_done_at, bonus_door_turns FROM users WHERE username = ?').get('QuestE2E');
    raw.close();
    assert.ok(row.quest_done_at, 'the quest should be marked complete');
    assert.equal(row.bonus_door_turns, 1, 'one bonus door turn should be banked');

    client.close();
  } finally {
    await board.stop();
  }
});
