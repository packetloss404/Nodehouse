'use strict';

// Last Callers: one row per caller, with a call count and a NEW/RETURNING/
// ONLINE badge. Before this it listed one row per call.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login, register, delay } = require('../helpers/board');

test('Last Callers shows one row per caller with a badge', async () => {
  const board = await startBoard();
  try {
    const fresh = await board.connectTelnet();
    await register(fresh, { username: 'LogE2E' });
    fresh.close();
    await delay(200);

    // SysOp calls twice; the list must still show a single SysOp row.
    const first = await board.connectTelnet();
    await login(first, { username: 'SysOp', password: board.sysopPassword });
    first.close();
    await delay(200);

    const second = await board.connectTelnet();
    await login(second, { username: 'SysOp', password: board.sysopPassword });
    const from = second.mark();
    await second.sendAndWait('L', /LAST CALLERS/);
    const screen = second.since(from);

    assert.match(screen, /LogE2E/);
    assert.match(screen, /NEW/);
    const sysopRows = screen.split('\r\n').filter((line) => /\bSysOp\b/.test(line));
    assert.equal(sysopRows.length, 1, 'one row per caller, not one per call');
    assert.match(sysopRows[0], /RETURNING|ONLINE/);

    second.close();
  } finally {
    await board.stop();
  }
});
