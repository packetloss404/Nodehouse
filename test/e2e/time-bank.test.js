'use strict';

// The Time Bank: contribution earns minutes, 30 minutes buys an extra door turn.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startBoard, register } = require('../helpers/board');

function readUser(board, username) {
  const raw = new Database(path.join(board.dir, 'nodehouse.db'));
  try {
    return raw.prepare('SELECT * FROM users WHERE username = ?').get(username);
  } finally {
    raw.close();
  }
}

test('posting earns banked minutes and 30 buys a door turn', async () => {
  const board = await startBoard({ env: { NODEHOUSE_TIME_BANK: '1' } });
  try {
    const client = await board.connectTelnet();
    await register(client, { username: 'BankE2E' });

    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);
    await client.sendAndWait('W', /To \(or "All"\): /);
    await client.sendAndWait('All', /Subject: /);
    await client.sendAndWait('Bank test', /│ /);
    await client.sendAndWait('Earning minutes.', /│ /);
    await client.sendAndWait('/S', /Message command:/);
    assert.ok(readUser(board, 'BankE2E').time_bank_minutes >= 2);

    await client.sendAndWait('Q', /Conference #:/);
    await client.sendAndWait('Q', /Main command \(/);

    // Top up directly so the spend path can be exercised.
    const raw = new Database(path.join(board.dir, 'nodehouse.db'));
    raw.prepare('UPDATE users SET time_bank_minutes = 60 WHERE username = ?').run('BankE2E');
    raw.close();

    await client.sendAndWait('D', /Door #: /);
    await client.sendAndWait('B', /extra door turn/);
    const user = readUser(board, 'BankE2E');
    assert.equal(user.time_bank_minutes, 30);
    assert.equal(user.bonus_door_turns, 1);

    client.close();
  } finally {
    await board.stop();
  }
});
