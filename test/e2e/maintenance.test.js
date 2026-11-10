'use strict';

// Maintenance: draining refuses new calls, reopening restores them, and the
// backup job is reachable from the control desk.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, adminLogin, adminFetch } = require('../helpers/board');

test('draining refuses new calls until the board is reopened', async () => {
  const board = await startBoard();
  try {
    const token = await adminLogin(board);

    const drained = await adminFetch(board, token, '/admin/api/maintenance/drain', { method: 'POST' });
    assert.equal(drained.status, 200);
    assert.equal(drained.body.drained, true);

    const refused = await board.connectTelnet();
    await refused.waitFor(/maintenance/i, { timeout: 5000 });
    refused.close();

    const reopened = await adminFetch(board, token, '/admin/api/maintenance/open', { method: 'POST' });
    assert.equal(reopened.status, 200);

    const accepted = await board.connectTelnet();
    await accepted.waitFor(/Username: /, { timeout: 5000 });
    accepted.close();

    const status = await adminFetch(board, token, '/admin/api/maintenance');
    assert.equal(status.body.draining, false);
    assert.equal(status.body.jobs[0].name, 'backup');
  } finally {
    await board.stop();
  }
});
