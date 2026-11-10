'use strict';

// The quote picker: C on a message quotes selected source lines with the
// author's initial, rather than dumping the whole body.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login, adminLogin, adminFetch } = require('../helpers/board');

test('C quotes only the selected lines', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await login(client, { username: 'SysOp', password: board.sysopPassword });

    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);
    await client.sendAndWait('1', /F\/R\/T\/U\/N\/P\/C\/Q: /);

    await client.sendAndWait('C', /Quote lines: /);
    await client.sendAndWait('2-3', /Subject \[Re: /);
    const prefill = client.mark();
    await client.sendAndWait('', /│ /);
    const editor = client.since(prefill);
    assert.match(editor, /S> /);
    assert.doesNotMatch(editor, /^W> /m);

    await client.sendAndWait('/S', /F\/R\/T\/U\/N\/P\/C\/Q: /);
    client.close();

    const token = await adminLogin(board);
    const messages = await adminFetch(board, token, '/admin/api/messages/1');
    const reply = messages.body.find((message) => /^Re: /.test(message.subject) && message.from_user === 'SysOp');
    assert.ok(reply, 'the quoted reply should be saved');
    assert.match(reply.body, /S> /);
  } finally {
    await board.stop();
  }
});
