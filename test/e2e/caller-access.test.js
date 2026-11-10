'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startBoard, login, register, adminLogin, adminFetch } = require('../helpers/board');

for (const guest of [true, false]) {
  test(`${guest ? 'Guest' : 'Pending'} callers can browse without changing the board`, async () => {
    const board = await startBoard({ env: { NODEHOUSE_REQUIRE_VALIDATION: '1' } });
    const sqlite = new Database(path.join(board.dir, 'nodehouse.db'), { readonly: true });
    try {
      const client = guest ? await board.connectTelnet() : await board.connectWs();
      const username = guest ? 'GUEST' : 'PendingBrowse';
      if (guest) await login(client, { username, password: 'ignored' });
      else await register(client, { username });
      const user = sqlite.prepare('SELECT id FROM users WHERE username = ?').get(username);
      const message = sqlite.prepare('SELECT id FROM messages WHERE base_id = 1 LIMIT 1').get();

      async function readMessage(command) {
        const prompt = await client.sendAndWait(command, /More: |F\/R\/T\/U\/N\/P\/C\/Q: /);
        if (prompt[0] === 'More: ') await client.sendAndWait('S', /F\/R\/T\/U\/N\/P\/C\/Q: /);
      }

      async function deny(command) {
        const from = client.mark();
        await client.sendAndWait(command, /cannot post or change|awaiting validation/);
        await client.waitForMainPrompt({ from });
        assert.doesNotMatch(client.since(from), /\/transfers\/(file|packet)\//);
      }

      await client.sendAndWait('Z', /Daily command: /);
      await readMessage('N');
      await deny('U');
      await client.sendAndWait('M', /Conference #: /);
      await client.sendAndWait('1', /Message command: /);
      await readMessage(String(message.id));
      await deny('C');
      await deny('X');
      await client.sendAndWait('O', /Command: /);
      await deny('N');
      await client.sendAndWait('H', /Porch command: /);
      await deny('V');
      await client.sendAndWait('F', /Area #: /);
      await client.sendAndWait('1', /Command: /);
      await deny('U');
      await client.sendAndWait('K', /Packet command: /);
      await deny('3');
      await client.sendAndWait('D', /Door #: /);
      await deny('1');

      const account = sqlite.prepare('SELECT menu_mode, quest_read, total_posts FROM users WHERE id = ?').get(user.id);
      assert.deepEqual(account, { menu_mode: 'NOVICE', quest_read: 0, total_posts: 0 });
      for (const table of ['message_read', 'reader_subscriptions', 'reader_preferences', 'file_transfers']) {
        assert.equal(sqlite.prepare(`SELECT count(*) AS count FROM ${table} WHERE user_id = ?`).get(user.id).count, 0, table);
      }
      client.close();
    } finally {
      sqlite.close();
      await board.stop();
    }
  });
}

test('an access change blocks outstanding uploads and a stale terminal action', async () => {
  const board = await startBoard();
  const sqlite = new Database(path.join(board.dir, 'nodehouse.db'));
  try {
    const client = await board.connectTelnet();
    const credentials = await register(client, { username: 'PreviouslyActive' });
    const user = sqlite.prepare('SELECT id FROM users WHERE username = ?').get(credentials.username);
    await client.sendAndWait('K', /Packet command: /);
    const packet = await client.sendAndWait('3', /\/transfers\/packet\/briefcase\/[A-Za-z0-9_-]+/);
    await client.sendAndWait('', /Packet command: /);
    await client.sendAndWait('Q', /Main command \(/);
    await client.sendAndWait('F', /Area #: /);
    await client.sendAndWait('1', /Command: /);
    await client.sendAndWait('U', /Upload filename: /);
    const file = await client.sendAndWait('queued.txt', /\/transfers\/file\/upload\/1\/[A-Za-z0-9_-]+/);
    await client.sendAndWait('', /Command: /);
    await client.sendAndWait('U', /Upload filename: /);

    // Model links issued before the caller became pending.
    sqlite.prepare("UPDATE users SET state = 'pending' WHERE id = ?").run(user.id);
    for (const [link] of [file, packet]) {
      const response = await board.fetch(link, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: 'blocked input',
      });
      assert.equal(response.status, 404);
    }
    await client.sendAndWait('stale.txt', /Account access changed/);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM files WHERE uploaded_by = ?').get(user.id).count, 0);
    assert.equal(sqlite.prepare('SELECT count(*) AS count FROM file_transfers WHERE user_id = ?').get(user.id).count, 2);

    const token = await adminLogin(board);
    const changed = await adminFetch(board, token, `/admin/api/users/${user.id}`, {
      method: 'PUT', body: JSON.stringify({ access_level: 200 }),
    });
    assert.equal(changed.status, 200);
    const pendingAdmin = await board.fetchJson('/admin/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    assert.equal(pendingAdmin.status, 401);

    const sysop = sqlite.prepare("SELECT id FROM users WHERE username = 'SysOp'").get();
    const reject = await adminFetch(board, token, `/admin/api/users/${sysop.id}/reject`, { method: 'POST' });
    assert.equal(reject.status, 409);
    const demote = await adminFetch(board, token, `/admin/api/users/${sysop.id}`, {
      method: 'PUT', body: JSON.stringify({ access_level: 100 }),
    });
    assert.equal(demote.status, 409);
  } finally {
    sqlite.close();
    await board.stop();
  }
});
