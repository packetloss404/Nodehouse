'use strict';

// Node exhaustion and idle accounting, driven against the real server.
//
// Before this, a single address could open sockets and sit at the login prompt
// until every node was held. The idle governor also used one global timeout,
// so a bot got five free minutes and a reader got cut off mid-thread.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login } = require('../helpers/board');

test('one address cannot hold every node with idle sockets', async () => {
  const board = await startBoard({ env: { NODEHOUSE_PENDING_PER_IP: '2' } });
  try {
    const first = await board.connectTelnet();
    const second = await board.connectTelnet();
    await first.waitFor(/Username: /);
    await second.waitFor(/Username: /);

    // A third socket from the same address is refused before it takes a node.
    const third = await board.connectTelnet();
    await third.waitFor(/Too many pending connections/i, { timeout: 5000 });
    third.close();

    // Identifying frees the pending slot.
    await login(first, { username: 'SysOp', password: board.sysopPassword });
    const fourth = await board.connectTelnet();
    await fourth.waitFor(/Username: /, { timeout: 5000 });

    fourth.close();
    second.close();
    first.close();
  } finally {
    await board.stop();
  }
});

test('an unauthenticated socket is dropped on the short idle limit', async () => {
  const board = await startBoard({
    env: {
      NODEHOUSE_IDLE_PREAUTH_MS: '700',
      NODEHOUSE_IDLE_SESSION_MS: '60000',
      NODEHOUSE_IDLE_TICK_MS: '100',
    },
  });
  try {
    const client = await board.connectTelnet();
    await client.waitFor(/Username: /);
    const started = Date.now();
    await client.waitFor(/Idle timeout - disconnecting/i, { timeout: 5000 });
    assert.ok(Date.now() - started < 4000, 'the pre-auth idle limit should fire promptly');
    client.close();
  } finally {
    await board.stop();
  }
});

test('a logged-in caller gets the session limit and a warning first', async () => {
  const board = await startBoard({
    env: {
      NODEHOUSE_IDLE_PREAUTH_MS: '60000',
      NODEHOUSE_IDLE_SESSION_MS: '900',
      NODEHOUSE_IDLE_TICK_MS: '100',
    },
  });
  try {
    const client = await board.connectTelnet();
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await client.waitFor(/Idle: the line drops in 30 seconds/i, { timeout: 5000 });
    await client.waitFor(/Idle timeout - disconnecting/i, { timeout: 5000 });
    client.close();
  } finally {
    await board.stop();
  }
});
