'use strict';

// File library transfers: upload to quarantine, operator approval, one-use
// download links that cannot be replayed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, register, adminLogin, adminFetch } = require('../helpers/board');

test('an upload is quarantined, approved, then downloadable exactly once', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await register(client, { username: 'FileE2E' });

    await client.sendAndWait('F', /Area #: /);
    await client.sendAndWait('1', /Command: /);
    await client.sendAndWait('U', /Upload filename: /);
    await client.sendAndWait('notes.txt', /Press Enter to continue/);
    const uploadPath = client.text().match(/\/transfers\/file\/upload\/\d+\/[A-Za-z0-9_-]+/);
    assert.ok(uploadPath, 'the upload link should be printed');
    await client.sendAndWait('', /Command: /);

    const payload = Buffer.from('hello file library\n');
    const uploaded = await board.fetch(uploadPath[0], {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payload,
    });
    assert.equal(uploaded.status, 201);

    const token = await adminLogin(board);
    const pending = await adminFetch(board, token, '/admin/api/files/pending');
    assert.equal(pending.status, 200);
    const queued = pending.body.find((file) => file.filename === 'notes.txt');
    assert.ok(queued, 'the upload should be waiting in quarantine');

    const approved = await adminFetch(board, token, `/admin/api/files/${queued.id}/approve`, { method: 'POST' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.state, 'published');

    await client.sendAndWait(`D${queued.id}`, /Press Enter to continue/);
    const downloadPath = client.text().match(/\/transfers\/file\/download\/\d+\/[A-Za-z0-9_-]+/);
    assert.ok(downloadPath, 'the download link should be printed');

    const downloaded = await board.fetch(downloadPath[0]);
    assert.equal(downloaded.status, 200);
    assert.equal(await downloaded.text(), 'hello file library\n');

    const replay = await board.fetch(downloadPath[0]);
    assert.equal(replay.status, 404, 'a used download link must not work twice');

    client.close();
  } finally {
    await board.stop();
  }
});
