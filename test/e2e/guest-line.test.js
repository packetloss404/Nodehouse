'use strict';

// A read-only guest line: no password, full access to reading, no mutations.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login } = require('../helpers/board');

test('a guest can read the board but cannot post', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await login(client, { username: 'GUEST', password: 'anything' });

    assert.match(client.text(), /Guest line/i);

    // Reading works.
    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);
    assert.match(client.text(), /Welcome/);

    // Writing is refused, and the session returns to the main menu.
    await client.sendAndWait('W', /To \(or "All"\): /);
    const before = client.mark();
    await client.send('All');
    await client.waitFor(/cannot post/i, { from: before });
    await client.waitFor(/Main command \(/, { from: before });

    // Reading still works after the refusal.
    const after = client.mark();
    await client.send('M');
    await client.waitFor(/Conference #:/, { from: after });

    client.close();
  } finally {
    await board.stop();
  }
});
