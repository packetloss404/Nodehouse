'use strict';

// End-to-end coverage of deployment guardrails, production bootstrap, and
// multi-node concurrency for The Nodehouse, driven against the real server
// process over its real transports (HTTP, raw Telnet, and WebSocket).
//
// Advertised behavior quoted from README.md:
//
//  - Features: "Deployment Guardrails — Docker- and Railway-aware HTTP/Telnet
//    ports, database health checks, secure production bootstrap, bounded
//    login/registration/admin attempts, origin-checked WebSockets, CI, and
//    end-to-end listener smoke tests".
//  - Quick Start: "A fresh production or Railway database instead requires
//    NODEHOUSE_SYSOP_PASSWORD with at least 12 characters; The Nodehouse will
//    not start with the known default."
//  - Features: "Multi-Node Concurrency — Up to 16 simultaneous users with
//    cross-protocol broadcasts: login/logout/disconnect notices, SysOp pages,
//    and new-mail alerts reach online users regardless of how they connected".
//  - Configuration table: "maxNodes | 16 | Maximum simultaneous connections";
//    config.json sets "maxNodes": 16.
//  - Electronic Mail: "Real-time 'you've got mail' push when the recipient is
//    online on any node".
//  - Configuration table: "NODEHOUSE_ALLOWED_ORIGINS | Optional comma-separated
//    additional browser WebSocket origins".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const { startBoard, login, register, delay, getFreePort } = require('../helpers/board');

let board;

test.before(async () => {
  board = await startBoard();
});

test.after(async () => {
  if (board) await board.stop();
});

// Polls an async predicate until it is true or the timeout elapses.
async function waitUntil(predicate, timeout = 6000, interval = 25) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await delay(interval);
  }
}

// Performs a raw WebSocket handshake with custom headers (the Origin header is
// what the server's verifyClient inspects) and reports whether it opened.
function wsHandshake(webPort, headers, timeout = 5000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${webPort}/ws`, { headers });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* already gone */ }
      resolve(result);
    };
    const timer = setTimeout(() => finish({ opened: false, error: 'handshake timed out' }), timeout);
    ws.once('open', () => finish({ opened: true }));
    ws.once('error', (error) => finish({ opened: false, error: error.message }));
  });
}

// Asserts that the server refuses to boot with the supplied environment, and
// that the captured boot log names the offending variable.
async function expectBootRefusal(env, pattern) {
  let failure;
  try {
    const started = await startBoard({ env });
    await started.stop();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, 'expected the server to refuse to start');
  assert.match(String(failure.message), pattern);
}

test('HTTP: /healthz returns the documented JSON shape with security headers', async () => {
  const health = await board.fetchJson('/healthz');

  // 200 only when the database answered the health query.
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.database, 'ok');
  assert.equal(health.body.service, 'nodehouse');
  assert.equal(typeof health.body.version, 'string');
  assert.equal(typeof health.body.uptimeSeconds, 'number');
  assert.equal(typeof health.body.nodesOnline, 'number');

  // Guardrail headers applied to every response, plus no-store on healthz.
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-frame-options'), 'DENY');
  assert.equal(health.headers.get('referrer-policy'), 'no-referrer');
});

test('Transfers: malformed formats and unknown tokens are rejected with 404', async () => {
  // Download side.
  assert.equal((await board.fetch('/transfers/packet/exe/not-a-real-token')).status, 404);
  assert.equal((await board.fetch('/transfers/packet/zip/not-a-real-token')).status, 404);
  assert.equal((await board.fetch('/transfers/packet/briefcase/not-a-real-token')).status, 404);
  assert.equal((await board.fetch('/transfers/packet/qwk/not-a-real-token')).status, 404);

  // Upload side: unknown format and unknown token.
  const badUpload = await board.fetch('/transfers/packet/exe/not-a-real-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('x'),
  });
  assert.equal(badUpload.status, 404);

  const unknownUpload = await board.fetch('/transfers/packet/rep/not-a-real-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('x'),
  });
  assert.equal(unknownUpload.status, 404);
});

test('Max nodes: the 17th simultaneous session is told all nodes are busy', async () => {
  const clients = [];
  try {
    for (let i = 0; i < 16; i += 1) {
      const client = await board.connectTelnet();
      clients.push(client);
      await client.waitFor(/Username: /, { timeout: 8000 });
    }

    const health = await board.fetchJson('/healthz');
    assert.equal(health.body.nodesOnline, 16, 'expected config.maxNodes (16) seated sessions');

    const overflow = await board.connectTelnet();
    clients.push(overflow);
    await overflow.waitFor(/all nodes are busy/i, { timeout: 8000 });
  } finally {
    for (const client of clients) client.close();
  }

  const released = await waitUntil(async () => (await board.fetchJson('/healthz')).body.nodesOnline === 0);
  assert.ok(released, 'expected every node to be released after the sockets closed');
});

test('Multi-node concurrency: login/logoff broadcasts, live new-mail push, and /healthz presence', async () => {
  const sysop = await board.connectTelnet();
  const peer = await board.connectTelnet();
  const browser = await board.connectWs();
  try {
    // Registering a caller logs them in and broadcasts across both transports.
    const credentials = await register(peer, { username: 'MailPal', realName: 'Mail Pal' });
    await sysop.waitFor(/MailPal has logged in on Node \d+/);
    await browser.waitFor(/MailPal has logged in on Node \d+/);

    // Logging the SysOp in on telnet is seen by the telnet peer and the browser.
    await login(sysop, { username: 'SysOp', password: board.sysopPassword });
    await peer.waitFor(/SysOp has logged in on Node \d+/);
    await browser.waitFor(/SysOp has logged in on Node \d+/);

    // SysOp writes E-Mail to the online peer; the peer gets a live push.
    await sysop.sendAndWait('E', /ELECTRONIC MAIL/);
    await sysop.sendAndWait('W', /To: /);
    await sysop.sendAndWait(credentials.username, /Subject: /);
    await sysop.sendAndWait('Hello from the concurrency test', /\/S to send/);
    await sysop.sendAndWait('Body line from SysOp.', /\u2502 /);
    await sysop.sendAndWait('/S', /Mail sent to MailPal/);
    await peer.waitFor(/New private mail from SysOp!/);

    // Logoff broadcasts to every other online node.
    await peer.send('G');
    await sysop.waitFor(/MailPal has logged off from Node \d+/);
    await browser.waitFor(/MailPal has logged off from Node \d+/);

    // Presence reflects the two remaining connections (SysOp telnet + browser).
    const health = await board.fetchJson('/healthz');
    assert.equal(health.body.nodesOnline, 2);
  } finally {
    sysop.close();
    peer.close();
    browser.close();
  }
});

test('Multi-node concurrency: an abrupt disconnect broadcasts to other nodes', async () => {
  const dropped = await board.connectTelnet();
  const observer = await board.connectTelnet();
  try {
    await login(dropped, { username: 'SysOp', password: board.sysopPassword });
    await login(observer, { username: 'SysOp', password: board.sysopPassword });

    const before = observer.mark();
    dropped.close(); // no deliberate 'G' logoff: the socket just drops
    await observer.waitFor(/SysOp has disconnected from Node \d+/, { timeout: 8000, from: before });
  } finally {
    dropped.close();
    observer.close();
  }
});

test('Multi-node concurrency: a WebSocket caller logs in and receives mail pushed from telnet', async () => {
  const sysop = await board.connectTelnet();
  const browser = await board.connectWs();
  try {
    await login(sysop, { username: 'SysOp', password: board.sysopPassword });

    // Registration over the WebSocket transport logs the caller in; the telnet
    // node sees the cross-protocol login broadcast.
    const credentials = await register(browser, { username: 'NodeWatcher', realName: 'Node Watcher' });
    await sysop.waitFor(/NodeWatcher has logged in on Node \d+/);

    await sysop.sendAndWait('E', /ELECTRONIC MAIL/);
    await sysop.sendAndWait('W', /To: /);
    await sysop.sendAndWait(credentials.username, /Subject: /);
    await sysop.sendAndWait('Cross-transport hello', /\/S to send/);
    await sysop.sendAndWait('Body from telnet SysOp.', /\u2502 /);
    await sysop.sendAndWait('/S', /Mail sent to NodeWatcher/);

    // The WebSocket recipient gets the live "you've got mail" push.
    await browser.waitFor(/New private mail from SysOp!/);
  } finally {
    sysop.close();
    browser.close();
  }
});

test('WebSocket origin enforcement: disallowed origins are rejected, same-host and configured origins accepted', async () => {
  const originBoard = await startBoard({ env: { NODEHOUSE_ALLOWED_ORIGINS: 'https://allowed.example' } });
  try {
    const sameHost = await wsHandshake(originBoard.webPort, {
      Origin: `http://127.0.0.1:${originBoard.webPort}`,
    });
    assert.equal(sameHost.opened, true, `same-host Origin should be accepted: ${sameHost.error}`);

    const configured = await wsHandshake(originBoard.webPort, { Origin: 'https://allowed.example' });
    assert.equal(configured.opened, true, `NODEHOUSE_ALLOWED_ORIGINS origin should be accepted: ${configured.error}`);

    const absent = await wsHandshake(originBoard.webPort, {});
    assert.equal(absent.opened, true, `a missing Origin should be accepted: ${absent.error}`);

    const disallowed = await wsHandshake(originBoard.webPort, { Origin: 'https://evil.example' });
    assert.equal(disallowed.opened, false, 'a disallowed Origin must be rejected');
    assert.match(String(disallowed.error), /403/);
  } finally {
    await originBoard.stop();
  }
});

test('Connection guardrail: the 30/min per-IP limiter refuses further connections', async () => {
  const limitBoard = await startBoard();
  const clients = [];
  try {
    for (let i = 0; i < 31; i += 1) {
      clients.push(await limitBoard.connectTelnet());
    }

    // The first 30 pass the limiter: 16 seat a node, 14 are told the board is
    // full. The 31st is refused by the connection limiter itself.
    const classify = () => {
      const texts = clients.map((client) => client.text());
      return {
        welcomed: texts.filter((text) => /Username: /.test(text)).length,
        busy: texts.filter((text) => /all nodes are busy/i.test(text)).length,
        refused: texts.filter((text) => /Too many connections/.test(text)).length,
      };
    };

    await waitUntil(() => {
      const counts = classify();
      return counts.welcomed === 16 && counts.busy === 14 && counts.refused === 1;
    });

    const counts = classify();
    assert.equal(counts.refused, 1, `expected exactly one limiter refusal, got ${counts.refused}`);
    assert.equal(counts.busy, 14, `expected 14 node-cap refusals, got ${counts.busy}`);
    assert.equal(counts.welcomed, 16, `expected 16 seated sessions, got ${counts.welcomed}`);
  } finally {
    for (const client of clients) client.close();
    await limitBoard.stop();
  }
});

test('Production bootstrap: a fresh database with no NODEHOUSE_SYSOP_PASSWORD refuses to start', async () => {
  await expectBootRefusal(
    { NODEHOUSE_SYSOP_PASSWORD: undefined, PACKETBBS_SYSOP_PASSWORD: undefined },
    /NODEHOUSE_SYSOP_PASSWORD/,
  );
});

test('Production bootstrap: a password shorter than 12 characters is rejected', async () => {
  await expectBootRefusal({ NODEHOUSE_SYSOP_PASSWORD: 'Abcdefgh123' }, /at least 12 characters/);
});

test('Production bootstrap: a 12-character password is accepted (inclusive boundary)', async () => {
  const password = 'Abcdefgh1234'; // exactly the documented minimum
  const boundary = await startBoard({ sysopPassword: password, env: { NODEHOUSE_SYSOP_PASSWORD: password } });
  try {
    const client = await boundary.connectTelnet();
    try {
      await login(client, { username: 'SysOp', password });
      assert.match(client.text(), /Message Conferences/);
    } finally {
      client.close();
    }
  } finally {
    await boundary.stop();
  }
});

test('Production bootstrap: an empty NODEHOUSE_SYSOP_PASSWORD is refused', async () => {
  await expectBootRefusal({ NODEHOUSE_SYSOP_PASSWORD: '' }, /NODEHOUSE_SYSOP_PASSWORD/);
});

test('Production bootstrap: development mode seeds the documented SysOp/sysop login', async () => {
  const dev = await startBoard({
    env: {
      NODE_ENV: 'development',
      NODEHOUSE_SYSOP_PASSWORD: undefined,
      PACKETBBS_SYSOP_PASSWORD: undefined,
    },
  });
  try {
    const client = await dev.connectTelnet();
    try {
      await login(client, { username: 'SysOp', password: 'sysop' });
      assert.match(client.text(), /Message Conferences/);
    } finally {
      client.close();
    }
  } finally {
    await dev.stop();
  }
});

test('Production bootstrap: an existing database keeps its SysOp password across a restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-e2e-persist-'));
  const dbPath = path.join(dir, 'nodehouse.db');
  const firstPassword = 'FirstSysopPass1';
  const secondPassword = 'SecondSysopPass2';
  let first;
  try {
    first = await startBoard({ sysopPassword: firstPassword, env: { NODEHOUSE_DB_PATH: dbPath } });
    const initial = await first.connectTelnet();
    try {
      await login(initial, { username: 'SysOp', password: firstPassword });
    } finally {
      initial.close();
    }
    await first.stop();
    first = null;

    // A second boot with a different NODEHOUSE_SYSOP_PASSWORD must not overwrite
    // the seeded credential on a database that already has users.
    const second = await startBoard({ sysopPassword: secondPassword, env: { NODEHOUSE_DB_PATH: dbPath } });
    try {
      const returning = await second.connectTelnet();
      try {
        await login(returning, { username: 'SysOp', password: firstPassword });
        assert.match(returning.text(), /Message Conferences/);
      } finally {
        returning.close();
      }
    } finally {
      await second.stop();
    }
  } finally {
    if (first) await first.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Deployment guardrail: identical HTTP and Telnet ports refuse to start', async () => {
  const port = await getFreePort();
  await expectBootRefusal({ PORT: String(port), TELNET_PORT: String(port) }, /must be different/);
});

test('Deployment guardrail: a non-numeric port refuses to start', async () => {
  await expectBootRefusal({ PORT: 'not-a-port' }, /HTTP port must be an integer between 1 and 65535/);
});
