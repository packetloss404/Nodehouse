'use strict';

// The compose loop can edit what it has written: list, replace, insert, delete.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, register, adminLogin, adminFetch } = require('../helpers/board');

test('editor commands rewrite the message before it is saved', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await register(client, { username: 'EditE2E' });

    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);
    await client.sendAndWait('W', /To \(or "All"\): /);
    await client.sendAndWait('All', /Subject: /);
    await client.sendAndWait('Editor test', /│ /);
    await client.sendAndWait('one', /│ /);
    await client.sendAndWait('two', /│ /);

    const listed = client.mark();
    await client.sendAndWait('/L', /│ /);
    assert.match(client.since(listed), /1 one/);

    await client.sendAndWait('/E 1 one edited', /│ /);
    await client.sendAndWait('/D 2', /│ /);
    await client.sendAndWait('/I 2 inserted line', /│ /);
    await client.sendAndWait('/S', /Message command:/);
    client.close();

    const token = await adminLogin(board);
    const messages = await adminFetch(board, token, '/admin/api/messages/1');
    const post = messages.body.find((message) => message.subject === 'Editor test');
    assert.ok(post, 'the edited message should be saved');
    assert.match(post.body, /one edited/);
    assert.match(post.body, /inserted line/);
    assert.doesNotMatch(post.body, /^two$/m);
  } finally {
    await board.stop();
  }
});
