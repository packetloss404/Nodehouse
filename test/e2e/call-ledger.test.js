'use strict';

// The call ledger records what happened on a call: transport, duration and the
// reason it ended. Before this, call_log had six columns and no outcome.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startBoard, login, delay } = require('../helpers/board');

function lastCall(board, username = 'SysOp') {
  const raw = new Database(path.join(board.dir, 'nodehouse.db'));
  try {
    return raw.prepare('SELECT * FROM call_log WHERE username = ? ORDER BY id DESC LIMIT 1').get(username);
  } finally {
    raw.close();
  }
}

test('a telnet logoff records transport, duration and reason', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await client.sendAndWait('G', /Thanks for calling The Nodehouse/);
    client.close();
    await delay(300);

    const row = lastCall(board);
    assert.equal(row.transport, 'telnet');
    assert.ok(row.logout_time, 'logout time should be recorded');
    assert.equal(row.end_reason, 'user_logoff');
    assert.equal(typeof row.duration_s, 'number');
    assert.ok(row.remote_addr_hash.length > 0);
    assert.doesNotMatch(row.remote_addr_hash, /127\.0\.0\.1/);
  } finally {
    await board.stop();
  }
});

test('a websocket call records its transport', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectWs();
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await client.sendAndWait('G', /Thanks for calling The Nodehouse/);
    client.close();
    await delay(300);

    const row = lastCall(board);
    assert.equal(row.transport, 'websocket');
  } finally {
    await board.stop();
  }
});

test('an idle disconnect records the idle reason', async () => {
  const board = await startBoard({
    env: {
      NODEHOUSE_IDLE_PREAUTH_MS: '60000',
      NODEHOUSE_IDLE_SESSION_MS: '1500',
      NODEHOUSE_IDLE_TICK_MS: '100',
    },
  });
  try {
    const client = await board.connectTelnet();
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await client.waitFor(/Idle timeout - disconnecting/i, { timeout: 6000 });
    await delay(300);

    const row = lastCall(board);
    assert.equal(row.end_reason, 'idle');
  } finally {
    await board.stop();
  }
});
