# End-to-end test harness

`board.js` boots the **real** Nodehouse server as a child process against an
isolated temporary SQLite database on ephemeral ports, then hands back clients
for both advertised transports. Tests written against it exercise the shipped
product, not internals.

## Usage

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login, register, adminLogin, adminFetch } = require('../helpers/board');

let board;
test.before(async () => { board = await startBoard(); });
test.after(async () => { if (board) await board.stop(); });

test('something', async () => {
  const client = await board.connectTelnet();      // or board.connectWs()
  await login(client, { username: 'SysOp', password: board.sysopPassword });
  await client.sendAndWait('M', /Message Conferences/);
  assert.match(client.text(), /General Discussion/);
  client.close();
});
```

## What `startBoard()` returns

| Member | Purpose |
| --- | --- |
| `baseUrl` | `http://127.0.0.1:<webPort>` |
| `webPort`, `telnetPort`, `host` | Live ports |
| `sysopPassword` | Password for the seeded `SysOp` account |
| `connectTelnet()` / `connectWs()` | Open a transport client |
| `fetch(path, init)` / `fetchJson(path, init)` | HTTP against the board |
| `url(path)` | Absolute URL helper |
| `logs()` | Captured server stdout/stderr |
| `stop()` | Kill the server and delete the temp database |

`startBoard({ env: { ... } })` merges extra environment variables into the
server process — use it for guardrail or bootstrap cases.

## Clients

`TerminalClient` (base), `TelnetClient`, `WsClient`:

- `text()` — everything received, ANSI codes stripped
- `mark()` / `since(mark)` — slice output from a saved offset
- `waitFor(pattern, { timeout, from })` — poll for a regex/substring
- `waitForMainPrompt()` — wait for the main-menu prompt
- `send(line)` — write `line\r\n`
- `sendAndWait(line, pattern, opts)` — send, then wait for output after it
- `sendKey(key)` — raw bytes (no newline)
- `close()`

## Helpers

- `login(client, { username, password })` — walks the real login sequence
  (welcome → username → password → logon summary → MOTD → main prompt).
- `register(client, { username, password, realName })` — full NEW-user flow.
- `adminLogin(board, { username, password })` — returns an admin bearer token.
- `adminFetch(board, token, path, init)` — authenticated admin API call.

## Constraints worth knowing

- **Per-process rate limits.** Each board enforces limits per source IP:
  registration `3/hour`, login failures `12/15min`, connections `30/min`.
  Boot a fresh board per test file; keep registrations within a file to ≤ 3.
- **Door 5** (`Dungeon of the Vibe Lords`) needs `ANTHROPIC_API_KEY`; without it
  the entrance reports "sealed". The harness starts with the key blank.
- **`npm test`** runs `test/**/*.test.js`; files under `test/helpers/` and
  `test/browser/` are not collected by `node --test`.
- Prefer `node --test test/e2e/<file>.test.js` while iterating.
