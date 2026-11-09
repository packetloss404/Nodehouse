'use strict';

// Drafts were stored but write-only. The shelf lists them, resumes them, and
// removes a draft once it has been posted.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, register, adminLogin, adminFetch } = require('../helpers/board');

test('a saved draft can be resumed, posted, and is then gone', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await register(client, { username: 'DraftE2E' });

    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);
    await client.sendAndWait('W', /To \(or "All"\): /);
    await client.sendAndWait('All', /Subject: /);
    await client.sendAndWait('Draft subject', /│ /);
    await client.sendAndWait('Draft body', /│ /);
    await client.sendAndWait('/D', /Message command:/);

    await client.sendAndWait('D', /DRAFT SHELF/);
    assert.match(client.text(), /Draft subject/);

    await client.sendAndWait('R1', /│ /);
    await client.sendAndWait('/S', /Message command:/);

    const token = await adminLogin(board);
    const messages = await adminFetch(board, token, '/admin/api/messages/1');
    assert.ok(messages.body.some((message) => message.subject === 'Draft subject'));

    await client.sendAndWait('D', /DRAFT SHELF/);
    assert.match(client.text(), /No drafts saved/);
    client.close();
  } finally {
    await board.stop();
  }
});
