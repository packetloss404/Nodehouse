'use strict';

// Validation: a new account can read immediately but cannot post until the
// SysOp approves it. No questionnaire, no CAPTCHA, no waiting to read.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, register, login, adminLogin, adminFetch } = require('../helpers/board');

test('a pending account reads but cannot post until validated', async () => {
  const board = await startBoard({ env: { NODEHOUSE_REQUIRE_VALIDATION: '1' } });
  try {
    const client = await board.connectTelnet();
    const creds = await register(client, { username: 'PendingE2E' });
    assert.match(client.text(), /pending validation/i);

    // Posting is refused.
    await client.sendAndWait('M', /Conference #:/);
    await client.sendAndWait('1', /Message command:/);
    const before = client.mark();
    await client.send('W');
    await client.waitFor(/awaiting validation/i, { from: before });
    client.close();

    // The control desk sees the pending account and approves it.
    const token = await adminLogin(board);
    const pending = await adminFetch(board, token, '/admin/api/users/pending');
    assert.equal(pending.status, 200);
    const row = pending.body.find((user) => user.username === 'PendingE2E');
    assert.ok(row, 'the new account should be pending');

    const approved = await adminFetch(board, token, `/admin/api/users/${row.id}/validate`, { method: 'POST' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.ok, true);

    const after = await adminFetch(board, token, '/admin/api/users/pending');
    assert.equal(after.body.some((user) => user.username === 'PendingE2E'), false);

    // Now the same caller can post.
    const second = await board.connectTelnet();
    await login(second, { username: creds.username, password: creds.password });
    await second.sendAndWait('M', /Conference #:/);
    await second.sendAndWait('1', /Message command:/);
    await second.sendAndWait('W', /To \(or "All"\): /);
    await second.sendAndWait('All', /Subject: /);
    await second.sendAndWait('Validated post', /│ /);
    await second.sendAndWait('It went through.', /│ /);
    await second.sendAndWait('/S', /Message command:/);
    second.close();

    const messages = await adminFetch(board, token, '/admin/api/messages/1');
    assert.ok(messages.body.some((message) => message.from_user === 'PendingE2E' && message.subject === 'Validated post'));
  } finally {
    await board.stop();
  }
});
