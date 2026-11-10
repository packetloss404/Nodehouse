'use strict';

// Long output pages at 22 lines with [C]ontinue / [S]top / [N]onstop.
// The pager was dead code before this: ansi.morePrompt existed but nothing used
// it, so long messages and bulletins scrolled past the top of the screen.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startBoard, login } = require('../helpers/board');

function insertLongMessage(board, lineCount) {
  const raw = new Database(path.join(board.dir, 'nodehouse.db'));
  try {
    const body = Array.from({ length: lineCount }, (_, index) => `Line ${index + 1} of a deliberately long message.`).join('\r\n');
    const info = raw.prepare(`
      INSERT INTO messages (base_id, from_user, to_user, subject, body, global_id)
      VALUES (1, 'SysOp', 'All', 'A long message', ?, ?)
    `).run(body, `test-long-${Date.now()}-${lineCount}`);
    raw.prepare('UPDATE messages SET root_id = id WHERE id = ?').run(info.lastInsertRowid);
    return Number(info.lastInsertRowid);
  } finally {
    raw.close();
  }
}

test('a long message pages, and N prints the rest', async () => {
  const board = await startBoard();
  try {
    const id = insertLongMessage(board, 80);
    const client = await board.connectTelnet();
    await login(client, { username: 'SysOp', password: board.sysopPassword });

    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);
    await client.sendAndWait(String(id), /More: /);
    assert.match(client.text(), /\[C\]ontinue, \[S\]top, \[N\]onstop/);

    const beforeContinue = client.mark();
    await client.send('C');
    await client.waitFor(/More: /, { from: beforeContinue });

    const beforeNonstop = client.mark();
    await client.send('N');
    await client.waitFor(/F\/R\/T\/U\/N\/P\/C\/Q: /, { from: beforeNonstop });
    assert.match(client.since(beforeNonstop), /Line 80/);

    client.close();
  } finally {
    await board.stop();
  }
});

test('EXPERT mode does not page', async () => {
  const board = await startBoard();
  try {
    const id = insertLongMessage(board, 80);
    const client = await board.connectTelnet();
    await login(client, { username: 'SysOp', password: board.sysopPassword });

    await client.sendAndWait('X', /Menu mode set to EXPERT/);
    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);

    const from = client.mark();
    await client.send(String(id));
    await client.waitFor(/F\/R\/T\/U\/N\/P\/C\/Q: /, { from });
    const screen = client.since(from);
    assert.doesNotMatch(screen, /\[N\]onstop/);
    assert.match(screen, /Line 80/);

    client.close();
  } finally {
    await board.stop();
  }
});
