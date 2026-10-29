'use strict';

// End-to-end coverage of the two advertised transports (Telnet + WebSocket)
// and the HTTP surface, driven against a real server process.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login, register, adminLogin, adminFetch } = require('../helpers/board');

let board;

test.before(async () => {
  board = await startBoard();
});

test.after(async () => {
  if (board) await board.stop();
});

test('HTTP serves the health check, web terminal, and admin panel', async () => {
  const health = await board.fetchJson('/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.database, 'ok');
  assert.equal(health.body.service, 'nodehouse');
  assert.equal(typeof health.body.version, 'string');

  const terminal = await board.fetch('/');
  assert.equal(terminal.status, 200);
  const terminalHtml = await terminal.text();
  assert.match(terminalHtml, /The Nodehouse/);
  assert.match(terminalHtml, /\/vendor\/xterm\.js/);
  assert.match(terminalHtml, /\/ws/);
  assert.doesNotMatch(terminalHtml, /cdn\.jsdelivr\.net/);

  // The terminal bundle and its stylesheet are served by this process.
  const xterm = await board.fetch('/vendor/xterm.js');
  assert.equal(xterm.status, 200);
  assert.match(xterm.headers.get('content-type') || '', /javascript/);
  assert.ok((await xterm.text()).length > 100000, 'expected the full xterm bundle');

  const xtermCss = await board.fetch('/vendor/xterm.css');
  assert.equal(xtermCss.status, 200);
  assert.match(xtermCss.headers.get('content-type') || '', /text\/css/);

  const missingAsset = await board.fetch('/vendor/does-not-exist.js');
  assert.equal(missingAsset.status, 404);

  const admin = await board.fetch('/admin');
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /SysOp Panel/);
});

test('Telnet: SysOp logs in, reaches the main menu, and logs off cleanly', async () => {
  const client = await board.connectTelnet();
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });

    const menu = client.text();
    assert.match(menu, /Message Conferences/);
    assert.match(menu, /Electronic Mail/);
    assert.match(menu, /Door Games/);
    assert.match(menu, /ANSI Art Gallery/);
    assert.match(menu, /Daily Call/);
    assert.match(menu, /Logoff/i);

    // A screen transition over the wire, then back to the prompt.
    const before = client.mark();
    await client.sendAndWait('L', /LAST CALLERS/, { from: before });
    await client.sendAndWait('', /Main command \(/, {});

    await client.sendAndWait('G', /Goodbye|Thanks for calling|Nodehouse/i);
  } finally {
    client.close();
  }

  // The logoff is durable: the SysOp call now has a logout time.
  const token = await adminLogin(board);
  const stats = await adminFetch(board, token, '/admin/api/stats');
  assert.equal(stats.status, 200);
  const sysopCall = stats.body.recentCalls.find((call) => call.username === 'SysOp' && call.logout_time);
  assert.ok(sysopCall, 'expected a closed SysOp call in the recent call log');
});

test('WebSocket: the browser transport drives the same session engine', async () => {
  const client = await board.connectWs();
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    assert.match(client.text(), /Message Conferences/);

    const before = client.mark();
    await client.sendAndWait('S', /System Information/, { from: before });
    assert.match(client.since(before), /Total Users:/);
  } finally {
    client.close();
  }
});

test('Telnet: a new caller can register and then reconnect', async () => {
  const username = 'WrenE2E';
  const client = await board.connectTelnet();
  let password;
  try {
    ({ password } = await register(client, { username }));
    assert.match(client.text(), /SINCE YOUR LAST CALL/);
    await client.send('G');
  } finally {
    client.close();
  }

  const second = await board.connectTelnet();
  try {
    await login(second, { username, password });
    assert.match(second.text(), /Message Conferences/);
    assert.match(second.text(), new RegExp(`SINCE YOUR LAST CALL`, 'i'));
  } finally {
    second.close();
  }
});
