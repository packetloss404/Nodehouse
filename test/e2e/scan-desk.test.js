'use strict';

// The Scan Desk: N opens a small query language instead of one fixed walk.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startBoard, register } = require('../helpers/board');

function insertMessage(board, { to, subject }) {
  const raw = new Database(path.join(board.dir, 'nodehouse.db'));
  try {
    const info = raw.prepare(`
      INSERT INTO messages (base_id, from_user, to_user, subject, body, global_id)
      VALUES (1, 'SysOp', ?, ?, 'Scan body', ?)
    `).run(to, subject, `scan-${Date.now()}-${Math.random()}`);
    raw.prepare('UPDATE messages SET root_id = id WHERE id = ?').run(info.lastInsertRowid);
    return Number(info.lastInsertRowid);
  } finally {
    raw.close();
  }
}

test('the scan desk filters unread and to-me', async () => {
  const board = await startBoard();
  try {
    insertMessage(board, { to: 'All', subject: 'Scan All Hands' });
    insertMessage(board, { to: 'ScanE2E', subject: 'Scan To Me' });

    const client = await board.connectTelnet();
    await register(client, { username: 'ScanE2E' });

    await client.sendAndWait('N', /SCAN DESK/);
    assert.match(client.text(), /Enter = unread/);

    // Y shows only messages addressed to this caller.
    const toMe = client.mark();
    await client.send('Y');
    await client.waitFor(/Scan To Me/, { from: toMe });
    assert.doesNotMatch(client.since(toMe), /Scan All Hands/);

    // Back to the main menu, then the default scan sees the rest.
    await client.sendAndWait('Q', /Main command \(/);
    await client.sendAndWait('N', /SCAN DESK/);
    const unread = client.mark();
    await client.send('');
    await client.waitFor(/Subj:/, { from: unread });
    const next = client.mark();
    await client.send('N');
    await client.waitFor(/Scan All Hands|Scan To Me/, { from: next });

    client.close();
  } finally {
    await board.stop();
  }
});
