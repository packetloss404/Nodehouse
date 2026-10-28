'use strict';

// End-to-end coverage of the advertised SysOp admin REST surface
// (`/admin/api/*`), driven against a real server process over HTTP.
//
// Advertised behavior quoted from README.md, "Admin Panel":
//   "The SysOp admin panel is a web-based single-file vanilla-JS SPA at /admin
//    ... served by Express with token auth (/admin/api/* routes gated by a
//    requireAuth middleware; login requires access level >= 200)."
//   "Dashboard — Live stats (users, messages, calls, uptime), online nodes,
//    recent call log"
//   "User Management — List, delete, reset passwords, edit access levels
//    (password hashes stripped from API responses)"
//   "Message Management — Browse by conference, delete individual messages"
//   "Bulletin Management — Create, toggle active/inactive, delete announcements"
//   "Node Monitoring — Real-time view of who's online and what they're doing"
//   "Community Moderation — Review Front Porch submissions, hide directory
//    profiles, inspect the moderation queue, and retain a bounded audit trail"
//   "Role Separation — Level-100 moderators can review community content;
//    level-200 SysOps retain user and system administration"
//
// README.md, "Constraints" (test/helpers/README.md): login failures are limited
// to 12/15min per process and registration to 3/hour, so this file registers
// exactly two callers and treats the admin login limiter as a shared, finite
// budget (the rate-limit case runs last and counts every login request).

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, register, adminLogin, adminFetch } = require('../helpers/board');

let board;
let sysopToken;
let sysopId;
let moderatorToken;
let callerA; // new level-10 caller, later promoted to 100 (moderator)
let callerB; // second level-10 caller, used for reset/delete coverage
const pendingPorchTitle = 'Moderation probe card';

// Every POST to /admin/api/login (success or failure) consumes one slot of the
// panel's fixed 10-per-15-minute limiter, so count them all.
let loginPosts = 0;

async function postLogin(body) {
  loginPosts += 1;
  return board.fetchJson('/admin/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function trackedAdminLogin(options) {
  loginPosts += 1;
  return adminLogin(board, options);
}

test.before(async () => {
  board = await startBoard();
  sysopToken = await trackedAdminLogin(); // loginPosts = 1

  // callerA registers as a level-10 caller. While still a caller we post a
  // Front Porch card so a moderation item exists for the control-desk tests.
  const clientA = await board.connectTelnet();
  const a = await register(clientA, { username: 'PorchE2E' });
  callerA = { username: a.username, password: a.password };
  await clientA.sendAndWait('H', /FRONT PORCH/);
  await clientA.sendAndWait('P', /Card type/);
  await clientA.sendAndWait('N', /Card title: /);
  await clientA.sendAndWait(pendingPorchTitle, /Card text: /);
  await clientA.sendAndWait('A card awaiting review from a new caller', /Porch card sent to the moderation desk/);
  clientA.close();

  // callerB registers as a second level-10 caller for reset/delete coverage.
  const clientB = await board.connectTelnet();
  const b = await register(clientB, { username: 'ResetE2E' });
  callerB = { username: b.username, password: b.password };
  clientB.close();

  const list = await adminFetch(board, sysopToken, '/admin/api/users');
  assert.equal(list.status, 200);
  const byName = (name) => list.body.find((u) => u.username === name);
  callerA.id = byName(callerA.username).id;
  callerB.id = byName(callerB.username).id;
  sysopId = byName('SysOp').id;
});

test.after(async () => {
  if (board) await board.stop();
});

test('POST /admin/api/login returns a bearer token for a staff account', async () => {
  const res = await postLogin({ username: 'SysOp', password: board.sysopPassword });
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, 'string');
  assert.ok(res.body.token.length >= 32, 'token should be a long opaque string');
  assert.equal(res.body.username, 'SysOp');
  assert.equal(res.body.accessLevel, 255);
});

test('POST /admin/api/login rejects a wrong password with 401', async () => {
  const res = await postLogin({ username: 'SysOp', password: 'not-the-real-password' });
  assert.equal(res.status, 401);
  assert.equal(typeof res.body.error, 'string');
});

test('POST /admin/api/login rejects a non-staff caller with 401', async () => {
  // callerA is a real account with a correct password but access level 10.
  const res = await postLogin({ username: callerA.username, password: callerA.password });
  assert.equal(res.status, 401);
  assert.equal(typeof res.body.error, 'string');
});

test('protected /admin/api routes require a valid token', async () => {
  const paths = ['/admin/api/stats', '/admin/api/users', '/admin/api/moderation', '/admin/api/system/status'];
  for (const path of paths) {
    const anon = await board.fetchJson(path);
    assert.equal(anon.status, 401, `${path} without a token`);
    assert.equal(anon.body.error, 'Unauthorized');

    const garbage = await board.fetchJson(path, { headers: { 'x-admin-token': 'garbage-token' } });
    assert.equal(garbage.status, 401, `${path} with a garbage token`);
    assert.equal(garbage.body.error, 'Unauthorized');
  }
});

test('role separation: level-100 reads community data but not user/system admin', async () => {
  const promote = await adminFetch(board, sysopToken, `/admin/api/users/${callerA.id}`, {
    method: 'PUT',
    body: JSON.stringify({ access_level: 100 }),
  });
  assert.equal(promote.status, 200);
  assert.equal(promote.body.ok, true);

  moderatorToken = await trackedAdminLogin({ username: callerA.username, password: callerA.password });

  const readable = [
    '/admin/api/stats',
    '/admin/api/moderation',
    '/admin/api/community/porch',
    '/admin/api/community/profiles',
    '/admin/api/audit',
    '/admin/api/nodes',
    '/admin/api/messages/1',
    '/admin/api/bulletins',
    '/admin/api/system/status',
  ];
  for (const path of readable) {
    const res = await adminFetch(board, moderatorToken, path);
    assert.equal(res.status, 200, `moderator should be able to read ${path}`);
  }

  const refused = [
    { method: 'GET', path: '/admin/api/users' },
    { method: 'PUT', path: `/admin/api/users/${callerB.id}`, body: { access_level: 10 } },
    { method: 'POST', path: '/admin/api/bulletins', body: { title: 'nope', body: 'nope' } },
    { method: 'DELETE', path: '/admin/api/bulletins/1' },
    { method: 'POST', path: `/admin/api/users/${callerB.id}/reset-password`, body: { password: 'long-enough-password' } },
    { method: 'DELETE', path: `/admin/api/users/${callerB.id}` },
  ];
  for (const entry of refused) {
    const init = { method: entry.method };
    if (entry.body) init.body = JSON.stringify(entry.body);
    const res = await adminFetch(board, moderatorToken, entry.path, init);
    assert.equal(res.status, 403, `moderator should be refused ${entry.method} ${entry.path}`);
    assert.equal(res.body.error, 'Insufficient access');
  }
});

test('GET /admin/api/stats exposes the dashboard shape', async () => {
  const res = await adminFetch(board, sysopToken, '/admin/api/stats');
  assert.equal(res.status, 200);
  const stats = res.body;
  assert.equal(typeof stats.totalUsers, 'number');
  assert.equal(typeof stats.totalMessages, 'number');
  assert.equal(typeof stats.totalCalls, 'number');
  assert.equal(typeof stats.nodesOnline, 'number');
  assert.equal(typeof stats.maxNodes, 'number');
  assert.match(stats.uptime, /^\d+h \d+m$/, 'uptime is rendered as "Xh Ym"');
  assert.ok(Array.isArray(stats.onlineUsers), 'onlineUsers is a list');
  assert.ok(Array.isArray(stats.recentCalls), 'recentCalls is a list');
  assert.ok(stats.totalUsers >= 3, 'SysOp plus the two registered callers');
  assert.ok(stats.totalMessages >= 1, 'seeded welcome messages');
  assert.ok(stats.recentCalls.length >= 1, 'the telnet registrations were logged');
});

test('user listings strip password hashes and salts', async () => {
  const list = await adminFetch(board, sysopToken, '/admin/api/users');
  assert.equal(list.status, 200);
  assert.ok(list.body.length >= 3);
  for (const user of list.body) {
    assert.ok(!('password_hash' in user), 'list must not include password_hash');
    assert.ok(!('password_salt' in user), 'list must not include password_salt');
  }

  const detail = await adminFetch(board, sysopToken, `/admin/api/users/${callerA.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.username, callerA.username);
  assert.ok(!('password_hash' in detail.body), 'detail must not include password_hash');
  assert.ok(!('password_salt' in detail.body), 'detail must not include password_salt');

  const missing = await adminFetch(board, sysopToken, '/admin/api/users/999999');
  assert.equal(missing.status, 404);
});

test('PUT /admin/api/users/:id enforces access-level bounds of 10..255', async () => {
  for (const level of [0, 9, 256, 1000]) {
    const res = await adminFetch(board, sysopToken, `/admin/api/users/${callerB.id}`, {
      method: 'PUT',
      body: JSON.stringify({ access_level: level }),
    });
    assert.equal(res.status, 400, `access_level ${level} should be rejected`);
    assert.match(res.body.error, /10 to 255/);
  }

  const ok = await adminFetch(board, sysopToken, `/admin/api/users/${callerB.id}`, {
    method: 'PUT',
    body: JSON.stringify({ access_level: 100 }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);

  const missing = await adminFetch(board, sysopToken, '/admin/api/users/999999', {
    method: 'PUT',
    body: JSON.stringify({ access_level: 100 }),
  });
  assert.equal(missing.status, 404);
});

test('the last SysOp cannot be demoted (409)', async () => {
  const res = await adminFetch(board, sysopToken, `/admin/api/users/${sysopId}`, {
    method: 'PUT',
    body: JSON.stringify({ access_level: 100 }),
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /last SysOp/i);

  const detail = await adminFetch(board, sysopToken, `/admin/api/users/${sysopId}`);
  assert.equal(detail.body.access_level, 255, 'the SysOp account must be unchanged');
});

test('an operator cannot delete their own active account (400)', async () => {
  const res = await adminFetch(board, sysopToken, `/admin/api/users/${sysopId}`, { method: 'DELETE' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /own active account/i);
});

test('reset-password enforces 12 characters; DELETE removes the user', async () => {
  const short = await adminFetch(board, sysopToken, `/admin/api/users/${callerB.id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password: 'elevenchars' }), // exactly 11
  });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /at least 12/);

  const newPassword = 'Twelve-Char-Reset-2026';
  const ok = await adminFetch(board, sysopToken, `/admin/api/users/${callerB.id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password: newPassword }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);

  // callerB was promoted to level 100 above, so the new password now logs in.
  const relogin = await postLogin({ username: callerB.username, password: newPassword });
  assert.equal(relogin.status, 200);
  assert.equal(relogin.body.accessLevel, 100);

  const deleted = await adminFetch(board, sysopToken, `/admin/api/users/${callerB.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);

  const gone = await adminFetch(board, sysopToken, `/admin/api/users/${callerB.id}`);
  assert.equal(gone.status, 404, 'the deleted user should be gone');
});

test('messages can be listed by base and deleted', async () => {
  const list = await adminFetch(board, sysopToken, '/admin/api/messages/1');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body));
  assert.ok(list.body.length >= 1, 'the seeded welcome message is in base 1');

  const target = list.body[0];
  const deleted = await adminFetch(board, sysopToken, `/admin/api/messages/${target.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.ok, true);

  const after = await adminFetch(board, sysopToken, '/admin/api/messages/1');
  assert.equal(after.status, 200);
  assert.ok(!after.body.some((message) => message.id === target.id), 'the deleted message should be gone');
});

test('bulletins: list, require title+body, create, toggle, delete', async () => {
  const initial = await adminFetch(board, sysopToken, '/admin/api/bulletins');
  assert.equal(initial.status, 200);
  assert.ok(initial.body.length >= 1, 'the seeded welcome bulletin is listed');

  for (const payload of [{}, { title: 'Only a title' }, { body: 'Only a body' }]) {
    const res = await adminFetch(board, sysopToken, '/admin/api/bulletins', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 400, `POST ${JSON.stringify(payload)} should be rejected`);
    assert.match(res.body.error, /required/i);
  }

  const title = 'E2E bulletin';
  const created = await adminFetch(board, sysopToken, '/admin/api/bulletins', {
    method: 'POST',
    body: JSON.stringify({ title, body: 'Body text from the e2e suite.' }),
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.ok, true);

  const listed = await adminFetch(board, sysopToken, '/admin/api/bulletins');
  const bulletin = listed.body.find((item) => item.title === title);
  assert.ok(bulletin, 'the created bulletin should appear in the list');
  assert.equal(bulletin.active, 1);

  const toggled = await adminFetch(board, sysopToken, `/admin/api/bulletins/${bulletin.id}/toggle`, { method: 'POST' });
  assert.equal(toggled.status, 200);
  const afterToggle = await adminFetch(board, sysopToken, '/admin/api/bulletins');
  assert.equal(afterToggle.body.find((item) => item.id === bulletin.id).active, 0, 'toggle flips active to inactive');

  const deleted = await adminFetch(board, sysopToken, `/admin/api/bulletins/${bulletin.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const afterDelete = await adminFetch(board, sysopToken, '/admin/api/bulletins');
  assert.ok(!afterDelete.body.some((item) => item.id === bulletin.id), 'the deleted bulletin should be gone');
});

test('GET /admin/api/nodes reports the online nodes', async () => {
  const client = await board.connectTelnet();
  try {
    await client.waitFor(/Username: /, { timeout: 12000 });
    const res = await adminFetch(board, sysopToken, '/admin/api/nodes');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.ok(res.body.length >= 1, 'the live telnet connection should appear as a node');
    const node = res.body[0];
    assert.equal(typeof node.nodeNum, 'number');
    assert.ok('username' in node);
    assert.equal(typeof node.activity, 'string');
    assert.ok(node.connectedAt, 'nodes carry a connectedAt timestamp');
  } finally {
    client.close();
  }
});

test('community profiles: list works and visibility only accepts visible:false', async () => {
  const list = await adminFetch(board, sysopToken, '/admin/api/community/profiles');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body));

  const refused = await adminFetch(board, sysopToken, `/admin/api/community/profiles/${callerA.id}/visibility`, {
    method: 'POST',
    body: JSON.stringify({ visible: true }),
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /only the caller/i);

  const hidden = await adminFetch(board, sysopToken, `/admin/api/community/profiles/${callerA.id}/visibility`, {
    method: 'POST',
    body: JSON.stringify({ visible: false }),
  });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body.username, callerA.username);
  assert.equal(Number(hidden.body.profile_visible), 0, 'the profile is hidden');

  const after = await adminFetch(board, sysopToken, '/admin/api/community/profiles');
  assert.ok(after.body.some((profile) => profile.user_id === callerA.id), 'the caller card is now listed');
});

test('front porch: list includes unapproved posts, create works, moderation validates state', async () => {
  const list = await adminFetch(board, sysopToken, '/admin/api/community/porch');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body));
  const pending = list.body.find((post) => post.title === pendingPorchTitle);
  assert.ok(pending, 'the pending caller post should be visible to the control desk');
  assert.equal(pending.status, 'pending', 'a new caller post awaits review');

  const created = await adminFetch(board, sysopToken, '/admin/api/community/porch', {
    method: 'POST',
    body: JSON.stringify({ type: 'notice', title: 'Admin notice', body: 'Posted by the SysOp.' }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.notice_type, 'notice');
  assert.equal(created.body.status, 'active', 'a moderator post goes live immediately');

  const badType = await adminFetch(board, sysopToken, '/admin/api/community/porch', {
    method: 'POST',
    body: JSON.stringify({ type: 'nonsense', title: 'x', body: 'y' }),
  });
  assert.equal(badType.status, 400);

  const noTitle = await adminFetch(board, sysopToken, '/admin/api/community/porch', {
    method: 'POST',
    body: JSON.stringify({ type: 'notice', body: 'y' }),
  });
  assert.equal(noTitle.status, 400);

  const approved = await adminFetch(board, sysopToken, `/admin/api/community/porch/${pending.id}/moderate`, {
    method: 'POST',
    body: JSON.stringify({ state: 'active' }),
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.status, 'active');

  for (const state of ['bogus', 'pending']) {
    const res = await adminFetch(board, sysopToken, `/admin/api/community/porch/${pending.id}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
    assert.equal(res.status, 400, `porch moderation state ${state} should be rejected`);
  }
});

test('moderation queue: state filter, valid/invalid transitions, 404 for unknown', async () => {
  const open = await adminFetch(board, sysopToken, '/admin/api/moderation');
  assert.equal(open.status, 200);
  assert.ok(Array.isArray(open.body));
  const item = open.body.find((entry) => entry.target_type === 'porch_post');
  assert.ok(item, 'the caller porch post should be in the moderation queue');
  assert.equal(item.state, 'open');

  const all = await adminFetch(board, sysopToken, '/admin/api/moderation?state=all');
  assert.ok(all.body.some((entry) => entry.id === item.id), 'state=all includes the open item');

  const dismissed = await adminFetch(board, sysopToken, '/admin/api/moderation?state=dismissed');
  assert.ok(!dismissed.body.some((entry) => entry.id === item.id), 'state=dismissed filters it out');

  for (const state of ['in_review', 'resolved', 'dismissed', 'open']) {
    const res = await adminFetch(board, sysopToken, `/admin/api/moderation/${item.id}`, {
      method: 'POST',
      body: JSON.stringify({ state }),
    });
    assert.equal(res.status, 200, `state ${state} should be accepted`);
    assert.equal(res.body.state, state);
  }

  const invalid = await adminFetch(board, sysopToken, `/admin/api/moderation/${item.id}`, {
    method: 'POST',
    body: JSON.stringify({ state: 'bogus' }),
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /unknown moderation state/i);

  const unknown = await adminFetch(board, sysopToken, '/admin/api/moderation/999999', {
    method: 'POST',
    body: JSON.stringify({ state: 'resolved' }),
  });
  assert.equal(unknown.status, 404);
});

test('GET /admin/api/audit returns a bounded audit trail', async () => {
  const res = await adminFetch(board, sysopToken, '/admin/api/audit');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.ok(res.body.length >= 1, 'the admin operations above were audited');
  assert.ok(res.body.length <= 100, 'the default page is bounded');

  const entry = res.body[0];
  assert.equal(typeof entry.action, 'string');
  assert.equal(typeof entry.target_type, 'string');

  const limited = await adminFetch(board, sysopToken, '/admin/api/audit?limit=5');
  assert.equal(limited.status, 200);
  assert.ok(limited.body.length <= 5, 'an explicit limit is honored');
});

test('GET /admin/api/system/status exposes the control-desk shape', async () => {
  const res = await adminFetch(board, sysopToken, '/admin/api/system/status');
  assert.equal(res.status, 200);
  const status = res.body;
  assert.equal(typeof status.database, 'boolean');
  assert.equal(typeof status.uptimeSeconds, 'number');
  assert.equal(typeof status.nodesOnline, 'number');
  assert.equal(typeof status.maxNodes, 'number');
  assert.equal(typeof status.pendingPages, 'number');
  assert.equal(typeof status.activePrivateChats, 'number');
  assert.equal(typeof status.memory, 'object');
  assert.equal(typeof status.memory.rss, 'number');
  assert.equal(typeof status.memory.heapUsed, 'number');
});

// Runs last: it deliberately exhausts the shared admin-login limiter for the
// rest of the process, so no later test may attempt an admin login.
test('login rate limit: the 11th login request in the window is refused with 429', async () => {
  assert.ok(loginPosts < 11, `expected fewer than 11 login requests before this test, saw ${loginPosts}`);

  let first429 = null;
  for (let attempt = 0; attempt < 11; attempt += 1) {
    const res = await postLogin({ username: 'SysOp', password: 'definitely-wrong-password' });
    if (res.status === 429) { first429 = res; break; }
    assert.equal(res.status, 401, `bad-login attempt ${attempt + 1} should be 401 until the limit is reached`);
  }

  assert.ok(first429, 'expected a 429 once the window limit is reached');
  assert.equal(loginPosts, 11, 'the 11th login request in the window is the first refused');
  assert.match(first429.body.error, /too many admin login attempts/i);

  const retryAfter = first429.headers.get('retry-after');
  assert.ok(retryAfter !== null, 'a 429 must carry a Retry-After header');
  assert.ok(Number(retryAfter) >= 1, 'Retry-After should be a positive number of seconds');
});
