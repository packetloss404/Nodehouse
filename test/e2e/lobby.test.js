'use strict';

// End-to-end coverage of the Front Porch, caller cards, and the Node Lobby,
// driven against a real server process over the real Telnet transport and the
// shipped admin REST API.
//
// Advertised behaviour under test (README.md):
//   * Line 39  "Front Porch & Caller Cards - Expiring notices, events,
//               classifieds, help-wanted posts, the AutoMessage, and an
//               alias-first directory; profiles are hidden until their caller
//               explicitly opts in"
//   * Line 176 "Front Porch (H) collects expiring community notices, events,
//               classifieds, help-wanted posts, and the AutoMessage. Caller
//               submissions enter moderation; operator posts can publish
//               directly."
//   * Line 177 "Caller Cards expose a searchable handle-first directory with
//               optional bio, interests, favorites, and ANSI avatar. New and
//               migrated profiles are private until the caller opts in."
//   * Line 178 "Node Lobby (I) adds Available, Away, Busy, and DND presence,
//               caller-to-caller page requests, accepted private chat, and
//               one-line telegrams. An unavailable recipient receives the
//               telegram as durable local E-Mail."

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login, register, adminLogin, adminFetch, delay } = require('../helpers/board');

const MAIN_PROMPT = /Main command \(/;
const PORCH_PROMPT = /Porch command: /;
const LOBBY_PROMPT = /Node command: /;
const PRIVATE_PROMPT = /private> /;

let board;
let adminToken;
let pipCreds;
let quillCreds;

// Registering is limited to 3/hour per process, so register each caller exactly
// once up front and reconnect with the stored credentials inside the tests.
test.before(async () => {
  board = await startBoard();
  adminToken = await adminLogin(board);

  const pip = await board.connectTelnet();
  try {
    pipCreds = await register(pip, { username: 'PipE2E', realName: 'Pip Caller' });
  } finally {
    pip.close();
  }

  const quill = await board.connectTelnet();
  try {
    quillCreds = await register(quill, { username: 'QuillE2E', realName: 'Quill Caller' });
  } finally {
    quill.close();
  }
});

test.after(async () => {
  if (board) await board.stop();
});

async function openSysop() {
  const client = await board.connectTelnet();
  await login(client, { username: 'SysOp', password: board.sysopPassword });
  return client;
}

async function openCaller(creds) {
  const client = await board.connectTelnet();
  await login(client, { username: creds.username, password: creds.password });
  return client;
}

async function openPorch(client) {
  await client.sendAndWait('H', /NODEHOUSE \/\/ FRONT PORCH/);
  await client.waitFor(PORCH_PROMPT);
}

async function openLobby(client) {
  await client.sendAndWait('I', /NODEHOUSE \/\/ OCCUPIED NODES/);
  await client.waitFor(LOBBY_PROMPT);
}

async function backToMain(client) {
  await client.sendAndWait('Q', MAIN_PROMPT);
}

async function setPresence(client, state) {
  const from = client.mark();
  await client.send(`S ${state}`);
  await client.waitFor(LOBBY_PROMPT, { from });
}

function adminPorch() {
  return adminFetch(board, adminToken, '/admin/api/community/porch?limit=100');
}

async function createAdminPost(fields) {
  const response = await adminFetch(board, adminToken, '/admin/api/community/porch', {
    method: 'POST',
    body: JSON.stringify(fields),
  });
  assert.equal(response.status, 201, `admin porch create failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

// ─── Front Porch ─────────────────────────────────────────

test('Front Porch carries the advertised AutoMessage for a fresh caller', async () => {
  const sysop = await openSysop();
  try {
    await openPorch(sysop);
    const porch = sysop.text();
    assert.match(porch, /NODEHOUSE \/\/ FRONT PORCH/);
    // README:176 - the Front Porch collects "... and the AutoMessage".
    assert.match(porch, /auto[-_ ]?message/i,
      'a fresh Front Porch should carry the AutoMessage the docs promise');
  } finally {
    sysop.close();
  }
});

test('a caller Front Porch submission is moderated before it appears', async () => {
  const pip = await openCaller(pipCreds);
  try {
    await openPorch(pip);

    // A caller (access level 10) posts; the product says it goes to moderation.
    await pip.sendAndWait('P', /Card type/);
    await pip.sendAndWait('N', /Card title: /);
    await pip.sendAndWait('Pip Modem Swap', /Card text: /);
    const beforeBody = pip.mark();
    await pip.send('Bring a 56K modem and a soldering iron to the porch.');
    await pip.waitFor(/sent to the moderation desk/, { from: beforeBody });

    // The pending card is not on the porch (the re-render that follows the post).
    assert.doesNotMatch(pip.since(beforeBody), /Pip Modem Swap/);

    // The admin control desk sees it as pending and queued for moderation.
    const listed = await adminPorch();
    assert.equal(listed.status, 200);
    const pending = listed.body.find((post) => post.title === 'Pip Modem Swap');
    assert.ok(pending, 'admin porch list should include the caller submission');
    assert.equal(pending.status, 'pending');
    assert.equal(pending.notice_type, 'notice');

    const moderation = await adminFetch(board, adminToken, '/admin/api/moderation?state=open');
    assert.equal(moderation.status, 200);
    assert.ok(
      moderation.body.some((item) => item.target_type === 'porch_post' && Number(item.target_id) === pending.id),
      'a moderation item should be queued for the porch post',
    );

    // Still hidden after re-rendering the porch.
    const beforeHidden = pip.mark();
    await backToMain(pip);
    await openPorch(pip);
    assert.doesNotMatch(pip.since(beforeHidden), /Pip Modem Swap/);

    // Operator approval through the shipped admin API publishes it.
    const approved = await adminFetch(board, adminToken, `/admin/api/community/porch/${pending.id}/moderate`, {
      method: 'POST',
      body: JSON.stringify({ state: 'active' }),
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'active');

    const beforeVisible = pip.mark();
    await backToMain(pip);
    await openPorch(pip);
    const published = pip.since(beforeVisible);
    assert.match(published, /Pip Modem Swap/);
    assert.match(published, /\[notice\]/);
  } finally {
    pip.close();
  }
});

test('Front Porch shows events, classifieds, and help-wanted notices', async () => {
  const sysop = await openSysop();
  try {
    const created = await Promise.all([
      createAdminPost({ type: 'event', title: 'Porch Cookout', body: 'Bring a dish on Saturday.' }),
      createAdminPost({ type: 'classified', title: 'For Sale: 2400 baud modem', body: 'Works, cheap.' }),
      createAdminPost({ type: 'help_wanted', title: 'Need a hand with my serial cable', body: 'Any soldering wizards?' }),
    ]);
    for (const post of created) assert.equal(post.status, 'active');

    await openPorch(sysop);
    const porch = sysop.text().slice(-6000);
    assert.match(porch, /Porch Cookout/);
    assert.match(porch, /\[event\]/);
    assert.match(porch, /For Sale: 2400 baud modem/);
    assert.match(porch, /\[classified\]/);
    assert.match(porch, /Need a hand with my serial cable/);
    assert.match(porch, /\[help_wanted\]/);
  } finally {
    sysop.close();
  }
});

test('an expiring Front Porch notice disappears once its expiry passes', async () => {
  const sysop = await openSysop();
  try {
    const expiresAt = new Date(Date.now() + 2500).toISOString();
    await createAdminPost({
      type: 'notice',
      title: 'Ephemeral Porch Notice',
      body: 'This card should not survive its expiry.',
      expires_at: expiresAt,
    });

    await openPorch(sysop);
    assert.match(sysop.text().slice(-4000), /Ephemeral Porch Notice/);

    await delay(3500);

    await backToMain(sysop);
    const beforeReopen = sysop.mark();
    await openPorch(sysop);
    // README:39/176 promise *expiring* notices.
    assert.doesNotMatch(sysop.since(beforeReopen), /Ephemeral Porch Notice/,
      'a notice past its expiry should no longer be listed on the porch');
  } finally {
    sysop.close();
  }
});

// ─── Caller cards ────────────────────────────────────────

test('caller cards are private by default and only a caller opt-in publishes them', async () => {
  const pip = await openCaller(pipCreds);
  const sysop = await openSysop();
  try {
    // The card starts hidden.
    await openPorch(pip);
    assert.match(pip.text().slice(-2000), /Profile hidden/);

    // Editing the card does not opt the caller in.
    await pip.sendAndWait('E', /Card as display name \| interests \| short bio: /);
    const afterEdit = pip.mark();
    await pip.send('Pipster | packet radio, ANSI art | Keeper of old modems');
    await pip.waitFor(/Caller card saved/, { from: afterEdit });
    await pip.waitFor(PORCH_PROMPT, { from: afterEdit });
    assert.match(pip.since(afterEdit), /Profile hidden/);

    // Another caller's directory does not list the private card.
    await openPorch(sysop);
    await sysop.sendAndWait('D', /NODEHOUSE \/\/ HOUSE DIRECTORY/);
    assert.doesNotMatch(sysop.text().slice(-4000), /Pipster/);
    await sysop.sendAndWait('Q', PORCH_PROMPT);

    // The caller opts in.
    const afterOptIn = pip.mark();
    await pip.send('V');
    await pip.waitFor(/Profile visible/, { from: afterOptIn });

    // Now the directory lists the card for another caller.
    await sysop.sendAndWait('D', /NODEHOUSE \/\/ HOUSE DIRECTORY/);
    const directory = sysop.text().slice(-4000);
    assert.match(directory, /PipE2E/);
    assert.match(directory, /Pipster/);
    assert.match(directory, /packet radio, ANSI art/);
    await sysop.sendAndWait('Q', PORCH_PROMPT);
  } finally {
    pip.close();
    sysop.close();
  }
});

// ─── Node Lobby ──────────────────────────────────────────

test('Node Lobby presence states are settable and visible, and /W lists who is present', async () => {
  const pip = await openCaller(pipCreds);
  const sysop = await openSysop();
  try {
    await openLobby(pip);
    assert.match(pip.text().slice(-4000), /PipE2E\s+available/);

    await setPresence(pip, 'away');
    assert.match(pip.text().slice(-4000), /PipE2E\s+away/);

    await openLobby(sysop);
    assert.match(sysop.text().slice(-4000), /PipE2E\s+away/,
      "another caller's lobby should show the updated presence");

    await setPresence(pip, 'busy');
    await backToMain(sysop);
    await openLobby(sysop);
    assert.match(sysop.text().slice(-4000), /PipE2E\s+busy/);

    await setPresence(pip, 'dnd');
    await backToMain(sysop);
    await openLobby(sysop);
    assert.match(sysop.text().slice(-4000), /PipE2E\s+dnd/);

    await setPresence(pip, 'available');

    // /W shows who is online.
    await backToMain(sysop);
    await sysop.sendAndWait('W', /Who's Online/);
    const who = sysop.text().slice(-4000);
    assert.match(who, /SysOp/);
    assert.match(who, /PipE2E/);
    await sysop.sendAndWait('', MAIN_PROMPT);
  } finally {
    pip.close();
    sysop.close();
  }
});

test('paging a caller who does not exist is refused', async () => {
  const sysop = await openSysop();
  try {
    await openLobby(sysop);
    await sysop.sendAndWait('P', /Page caller or node #: /);
    await sysop.sendAndWait('GhostCallerZZZ', /Page note: /);
    await sysop.sendAndWait('are you there?', /Page not sent \(OFFLINE\)/);
  } finally {
    sysop.close();
  }
});

test('paging a DND caller is refused', async () => {
  const pip = await openCaller(pipCreds);
  const sysop = await openSysop();
  try {
    await openLobby(pip);
    await setPresence(pip, 'dnd');

    await openLobby(sysop);
    await sysop.sendAndWait('P', /Page caller or node #: /);
    await sysop.sendAndWait('PipE2E', /Page note: /);
    await sysop.sendAndWait('quick ping', /Page not sent \(DO_NOT_DISTURB\)/);

    await setPresence(pip, 'available');
  } finally {
    pip.close();
    sysop.close();
  }
});

test('a page is accepted into a private chat that relays both ways and closes for both', async () => {
  const pip = await openCaller(pipCreds);
  const sysop = await openSysop();
  try {
    await openLobby(pip);

    await openLobby(sysop);
    await sysop.sendAndWait('P', /Page caller or node #: /);
    await sysop.sendAndWait('PipE2E', /Page note: /);
    await sysop.sendAndWait('Meet me in private chat', /Page sent\./);

    // The recipient sees the page and its short id in the lobby.
    await pip.waitFor(/PAGE from SysOp/);
    const afterPage = pip.mark();
    await pip.send('I');
    await pip.waitFor(LOBBY_PROMPT, { from: afterPage });
    const match = pip.since(afterPage).match(/PAGE ([0-9a-f]{8}) from SysOp/);
    assert.ok(match, 'the lobby should show the page id to accept or decline');

    await pip.sendAndWait(`A ${match[1]}`, /Private chat with SysOp opened/);
    await pip.waitFor(PRIVATE_PROMPT);

    await sysop.waitFor(/PipE2E accepted your page/);
    await sysop.sendAndWait('C', PRIVATE_PROMPT);

    // Messages relay in both directions.
    const pipChatStart = pip.mark();
    await sysop.send('The house is on the wire.');
    await pip.waitFor(/\[private:SysOp\] The house is on the wire\./, { from: pipChatStart });

    const sysopChatStart = sysop.mark();
    await pip.send('Copy that, Nodehouse.');
    await sysop.waitFor(/\[private:PipE2E\] Copy that, Nodehouse\./, { from: sysopChatStart });

    // Leaving closes the chat for both sides.
    const pipAfterLeave = pip.mark();
    await sysop.sendAndWait('/Q', LOBBY_PROMPT);
    await pip.waitFor(/SysOp left private chat\./, { from: pipAfterLeave });

    const pipAfterClose = pip.mark();
    await pip.send('anyone there?');
    await pip.waitFor(/Private chat closed\./, { from: pipAfterClose });
    await pip.waitFor(LOBBY_PROMPT, { from: pipAfterClose });
  } finally {
    pip.close();
    sysop.close();
  }
});

test('declining a page notifies the sender', async () => {
  const quill = await openCaller(quillCreds);
  const sysop = await openSysop();
  try {
    await openLobby(sysop);
    await openLobby(quill);
    await quill.sendAndWait('P', /Page caller or node #: /);
    await quill.sendAndWait('SysOp', /Page note: /);
    await quill.sendAndWait('Fancy a chat?', /Page sent\./);

    await sysop.waitFor(/PAGE from QuillE2E/);
    const afterPage = sysop.mark();
    await sysop.send('I');
    await sysop.waitFor(LOBBY_PROMPT, { from: afterPage });
    const match = sysop.since(afterPage).match(/PAGE ([0-9a-f]{8}) from QuillE2E/);
    assert.ok(match, 'the lobby should show the page id to accept or decline');

    const quillAfterPage = quill.mark();
    await sysop.sendAndWait(`D ${match[1]}`, LOBBY_PROMPT);
    await quill.waitFor(/SysOp declined your page\./, { from: quillAfterPage });
  } finally {
    quill.close();
    sysop.close();
  }
});

test('a telegram to an offline caller falls back to durable local E-Mail', async () => {
  const sysop = await openSysop();
  try {
    await openLobby(sysop);
    await sysop.sendAndWait('T', /Telegram to: /);
    await sysop.sendAndWait('QuillE2E', /Telegram text: /);
    await sysop.sendAndWait('Save me a seat on the porch.', /Telegram queued\./);
  } finally {
    sysop.close();
  }

  // Quill was never online for this call: the telegram must be waiting as mail.
  const quill = await openCaller(quillCreds);
  try {
    await quill.sendAndWait('E', /NODEHOUSE \/\/ ELECTRONIC MAIL/);
    await quill.sendAndWait('I', /Mail #: /);
    const inbox = quill.text().slice(-4000);
    assert.match(inbox, /Telegram/);
    assert.match(inbox, /SysOp/);
  } finally {
    quill.close();
  }
});
