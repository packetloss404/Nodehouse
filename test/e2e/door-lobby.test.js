'use strict';

// The door menu is a lobby: turns left, the reset countdown, your best and the
// current leader, instead of a static list.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login } = require('../helpers/board');

test('the door lobby shows turns, a reset countdown and the leader', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await login(client, { username: 'SysOp', password: board.sysopPassword });

    const from = client.mark();
    await client.sendAndWait('D', /Door #: /);
    const lobby = client.since(from);
    assert.match(lobby, /Daily reset in \d+h \d+m/);
    assert.match(lobby, /turns 5\/5/);
    assert.match(lobby, /leader/);

    await client.sendAndWait('1', /Command: /);
    const beforeQuit = client.mark();
    await client.sendAndWait('Q', /GAME OVER/);
    await client.sendAndWait('', /Door #: /);
    assert.match(client.since(beforeQuit), /turns 4\/5/);

    client.close();
  } finally {
    await board.stop();
  }
});
