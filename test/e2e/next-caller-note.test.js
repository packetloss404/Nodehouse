'use strict';

// A single note handed from one caller to the next, shown once at the next
// login and then cleared.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, register, login } = require('../helpers/board');

test('a note reaches exactly the next caller', async () => {
  const board = await startBoard();
  try {
    const writer = await board.connectTelnet();
    await register(writer, { username: 'NoteE2E' });
    await writer.sendAndWait('O', /Command: /);
    await writer.sendAndWait('N', /Note to the next caller: /);
    await writer.sendAndWait('Leave the porch light on.', /Command: /);
    await writer.sendAndWait('Q', /Main command \(/);
    await writer.sendAndWait('G', /Thanks for calling/);
    writer.close();

    const next = await board.connectTelnet();
    await login(next, { username: 'SysOp', password: board.sysopPassword });
    assert.match(next.text(), /A note from NoteE2E/);
    assert.match(next.text(), /Leave the porch light on/);
    next.close();

    const later = await board.connectTelnet();
    await login(later, { username: 'SysOp', password: board.sysopPassword });
    assert.doesNotMatch(later.text(), /A note from NoteE2E/);
    later.close();
  } finally {
    await board.stop();
  }
});
