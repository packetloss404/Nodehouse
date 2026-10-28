'use strict';

// Shared end-to-end harness for The Nodehouse.
//
// Boots the real server (server.js) as a child process against an isolated
// temporary SQLite database on ephemeral ports, then exposes thin clients for
// the two advertised transports: raw Telnet and the browser WebSocket.
//
// Nothing here is imported by production code; it exists so tests can exercise
// the shipped product over its real transports instead of calling internals.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const ansi = require('../../src/core/ansi');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_SYSOP_PASSWORD = 'Nodehouse-E2E-SysOp-2026';
const DEFAULT_CALLER_PASSWORD = 'Nodehouse-E2E-Caller-2026';
const BOOT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_MS = 8000;

const MAIN_PROMPT = /Main command \(|\bMain> /;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

// Telnet streams carry IAC negotiation bytes (0xFF cmd opt) that the session
// engine strips; the test client strips them the same way before decoding.
function stripTelnetIac(buffer) {
  const out = [];
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0xff) {
      i += 2;
      continue;
    }
    out.push(buffer[i]);
  }
  return Buffer.from(out);
}

class TerminalClient {
  constructor() {
    this.raw = Buffer.alloc(0);
    this.plainText = '';
    this.closed = false;
  }

  _append(chunk) {
    const cleaned = stripTelnetIac(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    this.raw = Buffer.concat([this.raw, cleaned]);
    this.plainText = ansi.stripCodes(this.raw.toString('utf8'));
  }

  // Visible text with ANSI escape codes removed.
  text() {
    return this.plainText;
  }

  // Everything received since a marker captured by `mark()`.
  since(mark) {
    return this.plainText.slice(mark);
  }

  mark() {
    return this.plainText.length;
  }

  reset() {
    this.raw = Buffer.alloc(0);
    this.plainText = '';
  }

  async waitFor(pattern, { timeout = DEFAULT_WAIT_MS, from = 0 } = {}) {
    const regex = pattern instanceof RegExp ? pattern : new RegExp(escapeRegExp(pattern));
    const deadline = Date.now() + timeout;
    for (;;) {
      const match = this.plainText.slice(from).match(regex);
      if (match) return match;
      if (Date.now() > deadline) {
        throw new Error(`Timed out after ${timeout}ms waiting for ${regex}.\n--- tail ---\n${this.plainText.slice(-3000)}`);
      }
      await delay(20);
    }
  }

  async waitForMainPrompt(options) {
    return this.waitFor(MAIN_PROMPT, options);
  }

  async send(line) {
    await this._write(`${line}\r\n`);
  }

  // Sends a line and waits for a response pattern that appears after the send.
  async sendAndWait(line, pattern, options = {}) {
    const from = this.plainText.length;
    await this.send(line);
    return this.waitFor(pattern, { ...options, from });
  }

  async sendKey(key) {
    await this._write(key);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class TelnetClient extends TerminalClient {
  constructor(socket) {
    super();
    this.socket = socket;
    socket.on('data', (chunk) => this._append(chunk));
    socket.on('close', () => { this.closed = true; });
    socket.on('error', () => { this.closed = true; });
  }

  static connect(host, port, { timeout = DEFAULT_WAIT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const client = new TelnetClient(socket);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('Telnet connection timed out.'));
      }, timeout);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve(client);
      });
      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  _write(data) {
    return new Promise((resolve, reject) => {
      this.socket.write(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  close() {
    if (!this.socket.destroyed) this.socket.end();
    this.socket.destroy();
  }
}

class WsClient extends TerminalClient {
  constructor(ws) {
    super();
    this.ws = ws;
    ws.on('message', (data) => this._append(data));
    ws.on('close', () => { this.closed = true; });
    ws.on('error', () => { this.closed = true; });
  }

  static connect(url, { timeout = DEFAULT_WAIT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const client = new WsClient(ws);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error('WebSocket connection timed out.'));
      }, timeout);
      ws.once('open', () => {
        clearTimeout(timer);
        resolve(client);
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  _write(data) {
    return new Promise((resolve, reject) => {
      this.ws.send(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let lastError;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`The Nodehouse exited during boot (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(new URL('/healthz', baseUrl));
      const body = await response.json();
      if (response.ok && body.status === 'ok' && body.database === 'ok') return body;
      lastError = new Error(`Health check returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) throw lastError || new Error('Health check timed out.');
    await delay(150);
  }
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolve();
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Boots a complete Nodehouse instance. Returns connection helpers and stop().
async function startBoard(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-e2e-'));
  const webPort = await getFreePort();
  let telnetPort = await getFreePort();
  while (telnetPort === webPort) telnetPort = await getFreePort();

  const sysopPassword = options.sysopPassword || DEFAULT_SYSOP_PASSWORD;
  let logs = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      NODEHOUSE_DB_PATH: path.join(dir, 'nodehouse.db'),
      NODEHOUSE_SYSOP_PASSWORD: sysopPassword,
      PORT: String(webPort),
      TELNET_PORT: String(telnetPort),
      NODEHOUSE_ALLOWED_ORIGINS: '',
      ANTHROPIC_API_KEY: '',
      ...(options.env || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-20000); });
  child.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-20000); });

  const baseUrl = `http://127.0.0.1:${webPort}`;

  try {
    const health = await waitForHealth(baseUrl, child);
    return {
      child,
      dir,
      host: '127.0.0.1',
      webPort,
      telnetPort,
      baseUrl,
      sysopPassword,
      health,
      url: (pathname) => new URL(pathname, baseUrl).toString(),
      logs: () => logs,
      connectTelnet: (opts) => TelnetClient.connect('127.0.0.1', telnetPort, opts),
      connectWs: (opts) => WsClient.connect(`ws://127.0.0.1:${webPort}/ws`, opts),
      async fetch(pathname, init) {
        return fetch(new URL(pathname, baseUrl), init);
      },
      async fetchJson(pathname, init) {
        const response = await fetch(new URL(pathname, baseUrl), init);
        const text = await response.text();
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        return { status: response.status, ok: response.ok, body, headers: response.headers };
      },
      async stop() {
        if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
        await waitForExit(child, 5000);
        fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`${error.message}\n--- server log ---\n${logs}`);
  }
}

// Walks a fresh connection through the real login sequence to the main prompt.
async function login(client, { username = 'SysOp', password = DEFAULT_SYSOP_PASSWORD } = {}) {
  await client.waitFor(/Username: /, { timeout: 12000 });
  await client.sendAndWait(username, /Password: /, { timeout: 12000 });
  await client.sendAndWait(password, /SINCE YOUR LAST CALL/, { timeout: 12000 });

  const afterSummary = client.mark();
  await client.send('');
  await client.waitFor(/Message of the Day|Main command \(|\bMain> /, { timeout: 12000, from: afterSummary });
  if (/Message of the Day/.test(client.since(afterSummary))) {
    const afterMotd = client.mark();
    await client.send('');
    await client.waitFor(MAIN_PROMPT, { timeout: 12000, from: afterMotd });
  }
  return client;
}

// Registers a brand-new caller over the live transport and lands them on the
// main prompt. Returns the credentials used.
async function register(client, { username, password = DEFAULT_CALLER_PASSWORD, realName = 'E2E Caller' } = {}) {
  await client.waitFor(/Username: /, { timeout: 12000 });
  await client.sendAndWait('NEW', /Choose a username: /, { timeout: 12000 });
  await client.sendAndWait(username, /Choose a password: /, { timeout: 12000 });
  await client.sendAndWait(password, /Confirm password: /, { timeout: 12000 });
  await client.sendAndWait(password, /real name/i, { timeout: 12000 });
  await client.sendAndWait(realName, /SINCE YOUR LAST CALL/, { timeout: 12000 });

  const afterSummary = client.mark();
  await client.send('');
  await client.waitFor(/Message of the Day|Main command \(|\bMain> /, { timeout: 12000, from: afterSummary });
  if (/Message of the Day/.test(client.since(afterSummary))) {
    const afterMotd = client.mark();
    await client.send('');
    await client.waitFor(MAIN_PROMPT, { timeout: 12000, from: afterMotd });
  }
  return { username, password };
}

// Logs into the admin REST API and returns the bearer token.
async function adminLogin(board, { username = 'SysOp', password } = {}) {
  const result = await board.fetchJson('/admin/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: password || board.sysopPassword }),
  });
  if (result.status !== 200 || !result.body || !result.body.token) {
    throw new Error(`Admin login failed (${result.status}): ${JSON.stringify(result.body)}`);
  }
  return result.body.token;
}

async function adminFetch(board, token, pathname, init = {}) {
  const headers = { 'x-admin-token': token, 'Content-Type': 'application/json', ...(init.headers || {}) };
  return board.fetchJson(pathname, { ...init, headers });
}

module.exports = {
  DEFAULT_SYSOP_PASSWORD,
  DEFAULT_CALLER_PASSWORD,
  MAIN_PROMPT,
  startBoard,
  login,
  register,
  adminLogin,
  adminFetch,
  TelnetClient,
  WsClient,
  delay,
  getFreePort,
};
