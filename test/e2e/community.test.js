'use strict';

// End-to-end coverage for The Nodehouse community surface, driven against the
// real server over its real Telnet transport:
//
//   README.md "Electronic Mail" — "Person-to-person messaging backed by a
//   dedicated `private_mail` table: Send, inbox, read, reply, and delete;
//   Recipient existence validation with canonical casing; Unread counts
//   surfaced as a badge on login; Real-time 'you've got mail' push when the
//   recipient is online on any node."
//
//   README.md "Polls / Voting Booth" — "One vote per user, enforced by a
//   UNIQUE(poll_id, user_id) constraint; Live results rendered as percentage
//   ASCII bar charts; Ships with a seeded sample poll on first run."
//
//   README.md "TeleChat & One-Liners" — "One-Liners — Leave a compact message
//   for other callers. Usernames are ANSI-stripped before rendering so nobody
//   can break the layout."
//
//   README.md features list — Bulletins, "Last Callers", "Who's Online",
//   "System Information", and "SysOp pages ... reach online users regardless of
//   how they connected".

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login, register } = require('../helpers/board');

const MAIN = /Main command \(/;

let board;
let caller; // { username: 'E2eCaller', password }
let inky; // a handle that attempts an ANSI escape

test.before(async () => {
  board = await startBoard();

  const first = await board.connectTelnet();
  caller = await register(first, { username: 'E2eCaller' });
  first.close();

  // Registration input only accepts printable bytes, so the ESC byte never
  // reaches the database; the intent is still an ANSI-injecting handle and the
  // rendering path must stay escape-free.
  const second = await board.connectTelnet();
  inky = await register(second, { username: '\x1b[31mInky' });
  second.close();
});

test.after(async () => {
  if (board) await board.stop();
});

async function loginCaller() {
  const client = await board.connectTelnet();
  await login(client, { username: caller.username, password: caller.password });
  return client;
}

async function loginSysop() {
  const client = await board.connectTelnet();
  await login(client, { username: 'SysOp', password: board.sysopPassword });
  return client;
}

function pollTotal(viewText) {
  const match = viewText.match(/Votes:\s+(\d+)/);
  assert.ok(match, `expected a "Votes:" count in the poll view:\n${viewText}`);
  return Number(match[1]);
}

function controlCharacters(text) {
  return [...text].filter((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 && char !== '\r' && char !== '\n';
  });
}

// ─── [E] Electronic Mail ────────────────────────────────────────────────

test('Electronic Mail: send, recipient validation, unread badge, inbox, read, reply, delete', async () => {
  const sender = await loginCaller();
  try {
    // Recipient existence validation rejects an unknown user.
    await sender.sendAndWait('E', /ELECTRONIC MAIL/);
    await sender.sendAndWait('W', /To: /);
    await sender.sendAndWait('GhostNobody', /User not found!/);

    // Abort that compose, then send a real one to a lowercase handle: the
    // recipient is validated case-insensitively and stored with canonical casing.
    await sender.sendAndWait('SysOp', /Subject: /);
    await sender.sendAndWait('Aborted', /Enter your message/);
    await sender.sendAndWait('/A', /Mail aborted\./);

    await sender.sendAndWait('W', /To: /);
    await sender.sendAndWait('sysop', /Subject: /);
    await sender.sendAndWait('Hello SysOp', /Enter your message/);
    await sender.send('First line of the message');
    await sender.send('Second line');
    await sender.sendAndWait('/S', /Mail sent to SysOp!/);

    await sender.sendAndWait('Q', MAIN);
  } finally {
    sender.close();
  }

  const sysop = await loginSysop();
  try {
    // Unread count is surfaced in the logon summary and the main-prompt badge.
    assert.match(sysop.text(), /Electronic mail waiting:\s+1\b/);
    assert.match(sysop.text(), /Mail:\s+1\b/);

    await sysop.sendAndWait('E', /ELECTRONIC MAIL/);
    assert.match(sysop.text(), /Inbox: 1/);
    assert.match(sysop.text(), /Unread: 1/);

    const inboxMark = sysop.mark();
    await sysop.sendAndWait('I', /Mail #: /);
    const inbox = sysop.since(inboxMark);
    assert.match(inbox, /Hello SysOp/);
    assert.match(inbox, /E2eCaller/);
    assert.match(inbox, /NEW/);
    const idMatch = inbox.match(/(\d+)\s+Hello SysOp/);
    assert.ok(idMatch, `expected the mail id in the inbox listing:\n${inbox}`);
    const mailId = idMatch[1];

    const readMark = sysop.mark();
    await sysop.sendAndWait(mailId, /Command: /);
    const read = sysop.since(readMark);
    assert.match(read, /First line of the message/);
    assert.match(read, /Second line/);
    assert.match(read, /From:\s+E2eCaller/);
    // Canonical casing: the mail was addressed to "sysop".
    assert.match(read, /To:\s+SysOp/);

    // Reply to the sender.
    await sysop.sendAndWait('R', /Replying to E2eCaller/);
    await sysop.sendAndWait('', /Subject \[Re: Hello SysOp\]: /);
    await sysop.sendAndWait('', /Enter your message/);
    await sysop.send('Thanks for writing.');
    await sysop.sendAndWait('/S', /Mail sent to E2eCaller!/);

    // Reading it flipped the inbox status from NEW to read.
    const secondInboxMark = sysop.mark();
    await sysop.sendAndWait('I', /Mail #: /);
    const row = sysop.since(secondInboxMark).split(/\r?\n/).find((line) => line.includes('Hello SysOp'));
    assert.ok(row, 'expected the original mail still listed in the inbox');
    assert.match(row, /read/);
    assert.doesNotMatch(row, /NEW/);

    // Delete it.
    const deleteMark = sysop.mark();
    await sysop.sendAndWait(mailId, /Command: /);
    await sysop.sendAndWait('D', /Mail deleted\./);
    await sysop.waitFor(/No mail in your inbox/);
    assert.match(sysop.since(deleteMark), /No mail in your inbox/);

    // The badge drops to zero on the main menu.
    const menuMark = sysop.mark();
    await sysop.sendAndWait('Q', /ELECTRONIC MAIL/);
    assert.match(sysop.since(menuMark), /Unread: 0/);
    const mainMark = sysop.mark();
    await sysop.sendAndWait('Q', MAIN);
    assert.match(sysop.since(mainMark), /Mail:\s+0\b/);
  } finally {
    sysop.close();
  }
});

test('Electronic Mail: an online recipient receives a live new-mail push', async () => {
  const sender = await loginCaller();
  const recipient = await loginSysop();
  try {
    const mark = recipient.mark();

    await sender.sendAndWait('E', /ELECTRONIC MAIL/);
    await sender.sendAndWait('W', /To: /);
    await sender.sendAndWait('SysOp', /Subject: /);
    await sender.sendAndWait('Push test', /Enter your message/);
    await sender.send('live push');
    await sender.sendAndWait('/S', /Mail sent to SysOp!/);

    // The recipient never pressed a key; the alert arrives on its own.
    await recipient.waitFor(/New private mail from E2eCaller/);
    assert.match(recipient.since(mark), /New private mail from E2eCaller/);
  } finally {
    sender.close();
    recipient.close();
  }
});

// ─── [V] Voting Booth ───────────────────────────────────────────────────

test('Voting Booth: list, view, vote, percentage bars, and one vote per user', async () => {
  const client = await loginCaller();
  try {
    const listMark = client.mark();
    await client.sendAndWait('V', /Voting Booths/);
    const list = client.since(listMark);
    assert.match(list, /What brings you back to a BBS\?/);
    const pollMatch = list.match(/(\d+)\s+What brings you back/);
    assert.ok(pollMatch, `expected the seeded poll in the list:\n${list}`);
    const pollId = pollMatch[1];

    const viewMark = client.mark();
    await client.sendAndWait(pollId, /Choice: /);
    const view = client.since(viewMark);
    assert.match(view, /Messages/);
    assert.match(view, /The community/);
    const before = pollTotal(view);
    const optionMatch = view.match(/\[(\d+)\]\s+Messages/);
    assert.ok(optionMatch, `expected a numbered option in the poll view:\n${view}`);
    const optionId = optionMatch[1];

    const voteMark = client.mark();
    await client.sendAndWait(optionId, /Vote recorded!/);
    const results = client.since(voteMark);
    assert.match(results, /You have already voted/);
    assert.match(results, /%/);
    assert.match(results, /[█░]{25}/); // a 25-cell percentage bar
    assert.equal(pollTotal(results), before + 1);

    // A second attempt in the same session must not record another vote.
    const againMark = client.mark();
    await client.send(optionId);
    await client.waitFor(/Poll #: /, { from: againMark });
    assert.doesNotMatch(client.since(againMark), /Vote recorded/);

    const reviewMark = client.mark();
    await client.sendAndWait(pollId, /Choice: /);
    const review = client.since(reviewMark);
    assert.match(review, /You have already voted/);
    assert.equal(pollTotal(review), before + 1);

    await client.sendAndWait('Q', /Poll #: /);
    await client.sendAndWait('Q', MAIN);
  } finally {
    client.close();
  }
});

test('Voting Booth: two concurrent sessions cannot double-vote the same poll', async () => {
  const first = await loginSysop();
  const second = await loginSysop();
  try {
    // Both sessions open the poll before either one votes.
    const firstListMark = first.mark();
    await first.sendAndWait('V', /Voting Booths/);
    const pollMatch = first.since(firstListMark).match(/(\d+)\s+What brings you back/);
    assert.ok(pollMatch, 'expected the seeded poll in the list');
    const pollId = pollMatch[1];

    const firstViewMark = first.mark();
    await first.sendAndWait(pollId, /Choice: /);
    const firstView = first.since(firstViewMark);
    const before = pollTotal(firstView);
    const optionMatch = firstView.match(/\[(\d+)\]\s+Messages/);
    assert.ok(optionMatch, 'expected a numbered option in the poll view');
    const optionId = optionMatch[1];

    const secondViewMark = second.mark();
    await second.sendAndWait('V', /Voting Booths/);
    await second.sendAndWait(pollId, /Choice: /);
    const secondView = second.since(secondViewMark);
    assert.doesNotMatch(secondView, /already voted/);

    // Session one votes.
    await first.sendAndWait(optionId, /Vote recorded!/);

    // Session two votes on the same poll; the unique constraint must hold.
    const secondVoteMark = second.mark();
    await second.send(optionId);
    await second.waitFor(/Choice: /, { from: secondVoteMark });

    const reviewMark = first.mark();
    await first.sendAndWait('', /Poll #: /);
    await first.sendAndWait(pollId, /Choice: /);
    const review = first.since(reviewMark);
    assert.match(review, /You have already voted/);
    assert.equal(pollTotal(review), before + 1, 'the poll must count exactly one vote for the user');

    // The losing session must be told it already voted, not that its vote was
    // recorded. A silent "Vote recorded!" for a discarded vote misleads callers.
    assert.doesNotMatch(second.since(secondVoteMark), /Vote recorded/);
  } finally {
    first.close();
    second.close();
  }
});

// ─── [O] One-Liners ─────────────────────────────────────────────────────

test('One-Liners: a post reaches the wall and handles render without control characters', async () => {
  const client = await loginCaller();
  try {
    const wallMark = client.mark();
    await client.sendAndWait('O', /ONE-LINERS/);
    // The seeded one-liner is on the wall. The wall is a compact 38-column
    // board, so the seed's longer message is clipped; match its prefix.
    assert.match(client.since(wallMark), /SysOp\s+First caller on The Nodehouse/);

    await client.sendAndWait('W', /One-liner \(max 38 chars\)/);
    await client.sendAndWait('Hello from E2E', /One-liner posted!/);
    const wall = client.since(wallMark);
    assert.match(wall, /Hello from E2E/);
    assert.match(wall, /E2eCaller/);
    assert.deepEqual(controlCharacters(wall), [], 'the wall must not leak control characters');

    // Every framed row keeps the same right edge, so a hostile handle cannot
    // break the 80-column layout.
    const edges = new Set(wall.split(/\r?\n/).filter((line) => line.includes('│'))
      .map((line) => line.lastIndexOf('│')));
    assert.equal(edges.size, 1, `misaligned one-liner rows: ${[...edges].join(', ')}`);
  } finally {
    client.close();
  }

  // A handle that tries to inject an ANSI sequence is rendered as plain text.
  const inkyClient = await board.connectTelnet();
  try {
    await login(inkyClient, { username: inky.username, password: inky.password });
    const mark = inkyClient.mark();
    await inkyClient.sendAndWait('O', /ONE-LINERS/);
    await inkyClient.sendAndWait('W', /One-liner \(max 38 chars\)/);
    await inkyClient.sendKey('\x1b[31mANSI?');
    await inkyClient.send('');
    await inkyClient.waitFor(/One-liner posted!/, { from: mark });
    const wall = inkyClient.since(mark);
    assert.match(wall, /Inky/);
    assert.match(wall, /ANSI\?/);
    assert.deepEqual(controlCharacters(wall), [], 'the wall must not leak control characters');
  } finally {
    inkyClient.close();
  }
});

// ─── [B] Bulletins ──────────────────────────────────────────────────────

test('Bulletins: the seeded welcome bulletin is listed with its content', async () => {
  const client = await loginCaller();
  try {
    const mark = client.mark();
    await client.sendAndWait('B', /System Bulletins/);
    const screen = client.since(mark);
    assert.match(screen, /Welcome to The Nodehouse!/);
    // The seeded welcome body is listed "with its content": the end of its
    // first line must survive to the screen.
    assert.match(screen, /board system powered by Nodehouse/);
    await client.sendAndWait('', MAIN);
  } finally {
    client.close();
  }
});

// ─── [L] [W] [S] callers, presence, and stats ───────────────────────────

test("Last Callers, Who's Online, and System Information reflect the live board", async () => {
  const callerClient = await loginCaller();
  const sysopClient = await loginSysop();
  try {
    const lastCallersMark = callerClient.mark();
    await callerClient.sendAndWait('L', /LAST CALLERS/);
    const lastCallers = callerClient.since(lastCallersMark);
    assert.match(lastCallers, /E2eCaller/);
    assert.match(lastCallers, /SysOp/);
    await callerClient.sendAndWait('', MAIN);

    const whoMark = callerClient.mark();
    await callerClient.sendAndWait('W', /Who's Online/);
    const who = callerClient.since(whoMark);
    assert.match(who, /E2eCaller/);
    assert.match(who, /SysOp/);
    const rows = who.split(/\r?\n/).filter((line) => line.includes('│') && /(E2eCaller|SysOp)/.test(line));
    assert.ok(rows.length >= 2, `expected both sessions listed with node numbers:\n${who}`);
    for (const row of rows) assert.match(row, /\d+\s+\S/);
    await callerClient.sendAndWait('', MAIN);

    const statsMark = callerClient.mark();
    await callerClient.sendAndWait('S', /System Information/);
    const stats = callerClient.since(statsMark);
    assert.match(stats, /Total Users:\s+3\b/); // SysOp + E2eCaller + Inky
    assert.match(stats, /Total Messages:\s+2\b/);
    assert.match(stats, /Nodes Online:\s+2\b/);
    assert.match(stats, /Max Nodes:\s+16\b/);
    await callerClient.sendAndWait('', MAIN);
  } finally {
    callerClient.close();
    sysopClient.close();
  }
});

// ─── [P] Page SysOp ─────────────────────────────────────────────────────

test('Page SysOp reaches an online SysOp node', async () => {
  const callerClient = await loginCaller();
  const sysopClient = await loginSysop();
  try {
    const pageMark = callerClient.mark();
    await callerClient.sendAndWait('P', /Paging SysOp/);
    assert.match(callerClient.since(pageMark), /The SysOp has been notified/);

    await sysopClient.waitFor(/is paging you!/);
    assert.match(sysopClient.text(), /E2eCaller on Node \d+ is paging you!/);
  } finally {
    callerClient.close();
    sysopClient.close();
  }
});
