'use strict';

// End-to-end coverage of the traditional caller loop and the message reader,
// driven against a real server process over the real Telnet transport.
//
// Advertised behaviour (README.md):
//  - "Traditional Caller Loop & Daily Call" — "'Since Your Last Call' ... and
//    persisted novice/expert/super menu modes remain intact".
//  - "Message Conferences" — section headings come from config.json; General
//    Discussion + Show & Tell form the Main Board, Vibe Coding + AI Workflows
//    form Vibe Community, and SysOp Corner is "SysOp only".
//  - "Threaded Message Reader" — "thread view, access-scoped literal
//    subject/body/author search, public follow-up versus private reply, and a
//    /S save / /A abort editor; bounded drafts, signatures ...".
//  - "Personal Newscan" — "opt-in conference subscriptions, caller-defined scan
//    order, remembered conference, durable high-water metadata, catch-up,
//    explicit mark-unread".
//  - "Electronic Mail" — "unread counts in the caller summary and main prompt".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { startBoard, login, register, delay } = require('../helpers/board');

const CALLER_A = 'E2EReaderA';
const CALLER_B = 'E2EReaderB';

// Prompts quoted from src/core/bbs.js (PROMPTS map).
const P = {
  conferences: 'Conference #: ',
  messageList: 'Message command: ',
  messageRead: 'F/R/T/U/N/P/Q: ',
  readerSetup: 'Reader command: ',
  searchPrompt: 'Search messages: ',
  searchResults: 'Result message #, or Q: ',
  settings: 'Setting #: ',
  mailMenu: 'Command: ',
  mailWriteTo: 'To: ',
};

const MAIN_PROMPT = /Main command \(|\bMain> /;

let board;
let callerAPassword;
let callerBPassword;

test.before(async () => {
  board = await startBoard();
});

test.after(async () => {
  if (board) await board.stop();
});

// ─── helpers ──────────────────────────────────────────────

async function connectAndLogin(username, password) {
  const client = await board.connectTelnet();
  await login(client, { username, password });
  return client;
}

function lastNumber(text, regex) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const global = new RegExp(regex.source, flags);
  let match;
  let last = null;
  while ((match = global.exec(text)) !== null) last = match;
  return last ? Number(last[1]) : null;
}

// Text from the most recent rendering of a screen identified by a marker.
function lastSection(text, marker) {
  const index = text.lastIndexOf(marker);
  return index >= 0 ? text.slice(index) : text;
}

// The "New" column of a conference row in the [M] listing.
function unreadFor(listing, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = listing.match(new RegExp(`${escaped}\\s+(\\d+)\\s+(\\d+)`));
  return match ? Number(match[2]) : null;
}

function parseReaderScreen(text) {
  const screen = lastSection(text, 'PERSONAL NEWSCAN');
  const entries = [];
  const re = /^\s*(\d+)\.\s+\[(X| )\]\s+(.+?)\s*$/gm;
  let match;
  while ((match = re.exec(screen)) !== null) {
    entries.push({ pos: Number(match[1]), subscribed: match[2] === 'X', name: match[3].trim() });
  }
  return entries;
}

async function gotoBase(client, baseId) {
  await client.sendAndWait('M', P.conferences);
  await client.sendAndWait(String(baseId), P.messageList);
}

async function backToMain(client) {
  await client.sendAndWait('Q', P.conferences);
  await client.sendAndWait('Q', MAIN_PROMPT);
}

async function postMessage(client, baseId, subject, bodyLines, to = 'All') {
  await gotoBase(client, baseId);
  await client.sendAndWait('W', 'To (or "All"): ');
  await client.sendAndWait(to, 'Subject');
  await client.sendAndWait(subject, 'Enter your message');
  for (const line of bodyLines) {
    await client.sendAndWait(line, '│ ');
  }
  await client.sendAndWait('/S', 'Message saved!');
  await backToMain(client);
}

async function catchUpBase(client, baseId) {
  await gotoBase(client, baseId);
  await client.sendAndWait('C', /Caught up \d+ message/);
  await backToMain(client);
}

async function runSearch(client, query) {
  await client.sendAndWait('S', P.searchPrompt);
  const before = client.mark();
  await client.sendAndWait(query, P.searchResults);
  const text = client.since(before);
  await client.sendAndWait('Q', P.messageList);
  return text;
}

async function openReaderSetup(client) {
  await client.sendAndWait('M', P.conferences);
  await client.sendAndWait('R', P.readerSetup);
  return parseReaderScreen(client.text());
}

async function readerToggle(client, entries, name) {
  const entry = entries.find((item) => item.name === name);
  assert.ok(entry, `expected "${name}" in the personal newscan setup`);
  await client.sendAndWait(`T${entry.pos}`, P.readerSetup);
  return parseReaderScreen(client.text());
}

async function readerMoveUp(client, entries, name) {
  const entry = entries.find((item) => item.name === name);
  assert.ok(entry, `expected "${name}" in the personal newscan setup`);
  await client.sendAndWait(`U${entry.pos}`, P.readerSetup);
  return parseReaderScreen(client.text());
}

async function closeReaderSetup(client) {
  await client.sendAndWait('Q', P.conferences);
  await client.sendAndWait('Q', MAIN_PROMPT);
}

// Durability check for draft rows. Drafts have no terminal retrieval path, so
// the durable artifact (the SQLite row) is read from a snapshot copy.
function readDrafts(username) {
  const source = path.join(board.dir, 'nodehouse.db');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-read-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(source + suffix)) {
        fs.copyFileSync(source + suffix, path.join(tmpDir, `nodehouse.db${suffix}`));
      }
    }
    const db = new Database(path.join(tmpDir, 'nodehouse.db'), { fileMustExist: true });
    try {
      const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (!user) return [];
      return db.prepare('SELECT * FROM message_drafts WHERE user_id = ? ORDER BY id').all(user.id);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── tests ────────────────────────────────────────────────

test('logon summary counts and MOTD on a first call', async () => {
  const client = await board.connectTelnet();
  try {
    const credentials = await register(client, { username: CALLER_A });
    callerAPassword = credentials.password;

    const text = client.text();
    assert.match(text, /NODEHOUSE \/\/ SINCE YOUR LAST CALL/);
    assert.match(text, /Electronic mail waiting:\s+0/);
    // Two seeded conferences messages: General Discussion + Vibe Coding.
    assert.match(text, /New conference messages:\s+2/);
    assert.match(text, /New file entries:\s+0/);
    assert.match(text, /Callers since last call:\s+0/);
    assert.match(text, /Calls today:\s+1/);
    assert.match(text, /Last call: First call/);
    assert.match(text, /Previous caller: None recorded/);

    // MOTD is shown after the summary and before the main menu.
    assert.match(text, /── Message of the Day ──/);
    assert.match(text, /The Nodehouse is online/);

    assert.match(lastSection(text, 'MAIN MENU'), /Message Conferences/);
  } finally {
    client.close();
  }
});

test('main menu contents and persisted [X] menu modes', async () => {
  const client = await connectAndLogin('SysOp', board.sysopPassword);
  try {
    const menu = client.text();
    for (const label of [
      'Message Conferences', 'Electronic Mail', 'File Libraries', 'Door Games',
      'Bulletins', 'TeleChat', 'New Message Scan', 'Last Callers', "Who's Online",
      'Voting Booth', 'One-Liners', 'Your Settings', 'Front Porch',
      'ANSI Art Gallery', 'Packet Briefcase', 'Daily Call', 'Menu Mode', 'Goodbye / Logoff',
    ]) {
      assert.ok(menu.includes(label), `main menu should advertise "${label}"`);
    }
    assert.match(menu, /Main command \(\? for menu\): /);

    // NOVICE -> EXPERT: the full screen gives way to a one-line command bar.
    let before = client.mark();
    await client.sendAndWait('X', 'Menu mode set to EXPERT.');
    let view = client.since(before);
    assert.match(view, /\[M E F D B T N L W V O Y P H I A K Z S X G \?\]/);
    assert.match(view, /Main> /);
    assert.doesNotMatch(view, /Message Conferences/);

    // EXPERT -> SUPER: still terse, no command bar.
    before = client.mark();
    await client.sendAndWait('X', 'Menu mode set to SUPER.');
    view = client.since(before);
    assert.match(view, /Main> /);
    assert.doesNotMatch(view, /\[M E F/);

    // SUPER -> NOVICE: full menu returns.
    before = client.mark();
    await client.sendAndWait('X', 'Menu mode set to NOVICE.');
    assert.match(client.since(before), /Message Conferences/);
  } finally {
    client.close();
  }

  // The mode is persisted on the account: EXPERT survives a reconnect.
  const setter = await connectAndLogin('SysOp', board.sysopPassword);
  await setter.sendAndWait('X', 'Menu mode set to EXPERT.');
  setter.close();

  const returning = await connectAndLogin('SysOp', board.sysopPassword);
  try {
    // The login screen always renders the full menu, but it reports the
    // persisted mode; the next command drops to that mode's terse prompt.
    assert.match(returning.text(), /Mode: EXPERT/);
    const afterLogin = returning.mark();
    await returning.sendAndWait('Q', MAIN_PROMPT);
    assert.match(returning.since(afterLogin), /Main> /);
    assert.doesNotMatch(returning.since(afterLogin), /Message Conferences/);
    // Restore NOVICE for the rest of the suite.
    await returning.sendAndWait('X', 'Menu mode set to SUPER.');
    await returning.sendAndWait('X', 'Menu mode set to NOVICE.');
  } finally {
    returning.close();
  }
});

test('[M] conferences group by section and gate SysOp Corner', async () => {
  const caller = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    const before = caller.mark();
    await caller.sendAndWait('M', P.conferences);
    const listing = caller.since(before);
    assert.match(listing, /NODEHOUSE \/\/ MESSAGE CONFERENCES/);
    assert.match(listing, /MAIN BOARD/);
    assert.match(listing, /VIBE COMMUNITY/);
    assert.match(listing, /General Discussion/);
    assert.match(listing, /Show & Tell/);
    assert.match(listing, /Vibe Coding/);
    assert.match(listing, /AI Workflows/);
    assert.doesNotMatch(listing, /SysOp Corner/);
    assert.doesNotMatch(listing, /SYSTEM/);

    await caller.sendAndWait('5', /Invalid conference number!/);
  } finally {
    caller.close();
  }

  const sysop = await connectAndLogin('SysOp', board.sysopPassword);
  try {
    const before = sysop.mark();
    await sysop.sendAndWait('M', P.conferences);
    const listing = sysop.since(before);
    assert.match(listing, /SysOp Corner/);
    assert.match(listing, /SYSTEM/);
  } finally {
    sysop.close();
  }
});

test('reading a message, public follow-up [F], and private reply [R]', async () => {
  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    await client.sendAndWait('M', P.conferences);
    const list = client.mark();
    await client.sendAndWait('1', P.messageList);
    // The list truncates subjects to 24 columns.
    assert.match(client.since(list), /Welcome to The Nodehouse/);

    const read = client.mark();
    await client.sendAndWait('1', P.messageRead);
    const screen = client.since(read);
    assert.match(screen, /Conference: General Discussion/);
    assert.match(screen, /From: SysOp/);
    assert.match(screen, /Subj: Welcome to The Nodehouse!/);

    // Public follow-up stays in the conference, prefilled with a quote.
    const follow = client.mark();
    await client.sendAndWait('F', /Subject \[Re: Welcome to The Nodehouse!\]/);
    await client.sendAndWait('', 'Enter your message');
    await client.sendAndWait('my public reply', '│ ');
    await client.sendAndWait('/S', 'Message saved!');
    const followView = client.since(follow);
    assert.match(followView, /Public follow-up in General Discussion/);
    assert.match(followView, /Message saved!/);

    // Private reply goes to the author as local mail.
    const reply = client.mark();
    await client.sendAndWait('R', /Private reply to SysOp/);
    await client.sendAndWait('', /Subject \[Re: Welcome to The Nodehouse!\]/);
    await client.sendAndWait('', 'Enter your message');
    await client.sendAndWait('my private reply', '│ ');
    await client.sendAndWait('/S', /Mail sent to SysOp!/);
    assert.match(client.since(reply), /To \[SysOp\]: /);

    // [Q] returns to the message list, where the follow-up is visible.
    await client.sendAndWait('Q', P.messageList);
    assert.match(lastSection(client.text(), 'General Discussion'), /Re: Welcome to The Nodeh/);
  } finally {
    client.close();
  }
});

test('thread view [T] shows the parent/child pair', async () => {
  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    await client.sendAndWait('M', P.conferences);
    await client.sendAndWait('1', P.messageList);
    await client.sendAndWait('1', P.messageRead);

    const before = client.mark();
    await client.sendAndWait('T', /Thread message #, or Q: /);
    const thread = client.since(before);
    assert.match(thread, /Thread \(2 messages\)/);
    assert.match(thread, /#1 Welcome to The Nodehouse!/);
    assert.match(thread, /Re: Welcome to The Nodehouse!/);

    const childId = lastNumber(thread, /#(\d+) Re: Welcome to The Nodehouse!/);
    assert.ok(childId, 'expected the child message id in the thread view');

    const child = client.mark();
    await client.sendAndWait(String(childId), P.messageRead);
    assert.match(client.since(child), /Subj: Re: Welcome to The Nodehouse!/);

    // [Q] walks back out to the conference list.
    await client.sendAndWait('Q', P.messageList);
  } finally {
    client.close();
  }
});

test('reader: [N]/[P] navigation and [U] mark-unread', async () => {
  const cleaner = await connectAndLogin(CALLER_A, callerAPassword);
  await catchUpBase(cleaner, 4);
  cleaner.close();

  const sysop = await connectAndLogin('SysOp', board.sysopPassword);
  await postMessage(sysop, 4, 'E2E-NP-Alpha', ['alpha body']);
  await postMessage(sysop, 4, 'E2E-NP-Bravo', ['bravo body']);
  await postMessage(sysop, 4, 'E2E-NP-Charlie', ['charlie body']);
  sysop.close();

  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    await gotoBase(client, 4);

    let before = client.mark();
    await client.sendAndWait('N', 'E2E-NP-Alpha');
    assert.match(client.since(before), /Subj: E2E-NP-Alpha/);
    const alphaId = lastNumber(client.since(before), /Msg#:\s+(\d+)/);
    assert.ok(alphaId, 'expected the scanned message id');

    before = client.mark();
    await client.sendAndWait('N', 'E2E-NP-Bravo');
    assert.match(client.since(before), /Subj: E2E-NP-Bravo/);

    before = client.mark();
    await client.sendAndWait('P', 'E2E-NP-Alpha');
    assert.match(client.since(before), /Subj: E2E-NP-Alpha/);

    before = client.mark();
    await client.sendAndWait('N', 'E2E-NP-Bravo');
    assert.match(client.since(before), /Subj: E2E-NP-Bravo/);

    before = client.mark();
    await client.sendAndWait('N', 'E2E-NP-Charlie');
    assert.match(client.since(before), /Subj: E2E-NP-Charlie/);

    // The end of a base scan returns to the message list.
    await client.sendAndWait('N', P.messageList);
    assert.match(client.since(before), /End of new-message scan/);

    // [U] marks a read message unread again.
    await client.sendAndWait(String(alphaId), P.messageRead);
    before = client.mark();
    await client.sendAndWait('U', 'Marked unread.');
    assert.match(client.since(before), /Marked unread\./);
    await client.sendAndWait('Q', P.messageList);

    before = client.mark();
    await client.sendAndWait('N', 'E2E-NP-Alpha');
    assert.match(client.since(before), /Subj: E2E-NP-Alpha/);

    // [Q] leaves the read view for the conference list, then the conferences.
    await client.sendAndWait('Q', P.messageList);
    await backToMain(client);
  } finally {
    client.close();
  }
});

test('reader: [S] search matches literally, not as SQL LIKE', async () => {
  const sysop = await connectAndLogin('SysOp', board.sysopPassword);
  await postMessage(sysop, 1, 'E2E-Zebra-Marker', ['A quokka crosses the road.']);
  // A restricted SysOp Corner post that callers must not be able to search.
  await postMessage(sysop, 5, 'E2E-SysOp-Secret', ['classified aardvark notes']);
  sysop.close();

  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    await gotoBase(client, 1);

    const subject = await runSearch(client, 'Zebra');
    assert.match(subject, /Search results for "Zebra"/);
    assert.match(subject, /E2E-Zebra-Marker/);

    const body = await runSearch(client, 'quokka');
    assert.match(body, /E2E-Zebra-Marker/);

    const author = await runSearch(client, 'SysOp');
    assert.match(author, /Welcome to The Nodehouse/);

    // Search is access-scoped: SysOp Corner stays invisible to callers.
    const restrictedSubject = await runSearch(client, 'SysOp-Secret');
    assert.match(restrictedSubject, /No matching messages/);
    const restrictedBody = await runSearch(client, 'aardvark');
    assert.match(restrictedBody, /No matching messages/);

    // A wildcard must be literal: "%" is not "match everything".
    const percent = await runSearch(client, '%');
    assert.match(percent, /No matching messages/);
    assert.doesNotMatch(percent, /E2E-Zebra-Marker/);
    assert.doesNotMatch(percent, /Welcome to The Nodehouse/);

    const underscore = await runSearch(client, '_');
    assert.match(underscore, /No matching messages/);

    const combined = await runSearch(client, 'Zebra%');
    assert.match(combined, /No matching messages/);

    await backToMain(client);
  } finally {
    client.close();
  }
});

test('reader: personal newscan [R] skips unsubscribed conferences', async () => {
  const cleaner = await connectAndLogin(CALLER_A, callerAPassword);
  for (const baseId of [1, 2, 3, 4]) await catchUpBase(cleaner, baseId);
  cleaner.close();

  const sysop = await connectAndLogin('SysOp', board.sysopPassword);
  await postMessage(sysop, 1, 'E2E-Sub-Base1', ['base one']);
  await postMessage(sysop, 3, 'E2E-Sub-Base3', ['base three']);
  sysop.close();

  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    let entries = await openReaderSetup(client);
    assert.ok(entries.length >= 4, 'expected every accessible conference in the newscan setup');
    assert.equal(entries.find((entry) => entry.name === 'General Discussion').subscribed, true);

    entries = await readerToggle(client, entries, 'General Discussion');
    assert.equal(entries.find((entry) => entry.name === 'General Discussion').subscribed, false);
    await closeReaderSetup(client);

    const before = client.mark();
    await client.sendAndWait('N', 'E2E-Sub-Base3');
    const scan = client.since(before);
    assert.match(scan, /New-message scan: 1 message/);
    assert.match(scan, /E2E-Sub-Base3/);
    assert.doesNotMatch(scan, /E2E-Sub-Base1/);

    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('reader: personal newscan [R] honours the caller-defined scan order', async () => {
  const cleaner = await connectAndLogin(CALLER_A, callerAPassword);
  for (const baseId of [1, 3]) await catchUpBase(cleaner, baseId);
  cleaner.close();

  const sysop = await connectAndLogin('SysOp', board.sysopPassword);
  await postMessage(sysop, 1, 'E2E-Order-Base1', ['order one']);
  await postMessage(sysop, 3, 'E2E-Order-Base3', ['order three']);
  sysop.close();

  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    let entries = await openReaderSetup(client);
    if (!entries.find((entry) => entry.name === 'General Discussion').subscribed) {
      entries = await readerToggle(client, entries, 'General Discussion');
    }
    for (let i = 0; i < entries.length && entries[0].name !== 'Show & Tell'; i += 1) {
      entries = await readerMoveUp(client, entries, 'Show & Tell');
    }
    assert.equal(entries[0].name, 'Show & Tell');
    await closeReaderSetup(client);

    let before = client.mark();
    await client.sendAndWait('N', 'E2E-Order-Base3');
    assert.match(client.since(before), /Subj: E2E-Order-Base3/);

    before = client.mark();
    await client.sendAndWait('N', 'E2E-Order-Base1');
    assert.match(client.since(before), /Subj: E2E-Order-Base1/);

    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('reader: per-conference unread counts and catch-up', async () => {
  const sysop = await connectAndLogin('SysOp', board.sysopPassword);
  await postMessage(sysop, 4, 'E2E-Catchup-One', ['one']);
  await postMessage(sysop, 4, 'E2E-Catchup-Two', ['two']);
  sysop.close();

  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    await client.sendAndWait('M', P.conferences);
    let listing = lastSection(client.text(), 'MESSAGE CONFERENCES');
    assert.equal(unreadFor(listing, 'AI Workflows'), 2);

    await client.sendAndWait('4', P.messageList);
    await client.sendAndWait('C', /Caught up \d+ message/);
    await client.sendAndWait('Q', P.conferences);
    listing = lastSection(client.text(), 'MESSAGE CONFERENCES');
    assert.equal(unreadFor(listing, 'AI Workflows'), 0);

    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('reader: [C] continues the remembered conference', async () => {
  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    await client.sendAndWait('M', P.conferences);
    const entered = client.mark();
    await client.sendAndWait('3', P.messageList);
    assert.match(client.since(entered), /Show & Tell/);

    await client.sendAndWait('Q', P.conferences);
    const continued = client.mark();
    await client.sendAndWait('C', P.messageList);
    assert.match(client.since(continued), /Show & Tell/);

    await backToMain(client);
  } finally {
    client.close();
  }
});

test('reader: Daily Call [Z] is a repeatable check-in', async () => {
  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    const before = client.mark();
    await client.sendAndWait('Z', 'Daily command: ');
    const report = client.since(before);
    assert.match(report, /NODEHOUSE \/\/ THE DAILY CALL/);
    assert.match(report, /Mail waiting:\s+\d+/);
    assert.match(report, /Subscribed conference messages:\s+\d+/);
    assert.match(report, /New bulletins \/ files:\s+\d+ \/ \d+/);
    assert.match(report, /Callers since last call:\s+\d+/);
    assert.match(report, /Active voting booths:\s+\d+/);
    assert.match(report, /\[N\] Newscan\s+\[E\] Mail\s+\[B\] Bulletins\s+\[F\] Files\s+\[H\] Porch\s+\[Q\] Main/);
    await client.sendAndWait('Q', MAIN_PROMPT);

    // Repeatable: the same route opens the check-in again.
    const again = client.mark();
    await client.sendAndWait('Z', 'Daily command: ');
    assert.match(client.since(again), /NODEHOUSE \/\/ THE DAILY CALL/);
    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('reader: [Y] signature bounds and signature applied to a post', async () => {
  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    await client.sendAndWait('Y', P.settings);
    await client.sendAndWait('5', 'New compact signature: ');
    await client.sendAndWait('E2E Sig Line', 'Signature updated!');
    await client.sendAndWait('Q', MAIN_PROMPT);

    // The signature is appended to a message saved with /S.
    await postMessage(client, 3, 'E2E-Sig-Post', ['sig body']);
    await gotoBase(client, 3);
    const listView = lastSection(client.text(), 'Show & Tell');
    const postId = lastNumber(listView, /(\d+)\s+E2E-Sig-Post/);
    assert.ok(postId, 'expected the signed post in the conference list');
    const read = client.mark();
    await client.sendAndWait(String(postId), P.messageRead);
    const screen = client.since(read);
    assert.match(screen, /sig body/);
    assert.match(screen, /E2E Sig Line/);

    await client.sendAndWait('Q', P.messageList);
    await backToMain(client);

    // A signature beyond the advertised bound is rejected.
    await client.sendAndWait('Y', P.settings);
    await client.sendAndWait('5', 'New compact signature: ');
    const tooLong = 'x'.repeat(300);
    const before = client.mark();
    await client.sendAndWait(tooLong, 'Try again: ');
    assert.match(client.since(before), /Signature must be at most 4 lines and 240 bytes\./);

    // Clearing it succeeds and leaves the setting clean.
    await client.sendAndWait('', 'Signature updated!');
    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('reader: [W] ... /D drafts are durable', async () => {
  const client = await connectAndLogin(CALLER_A, callerAPassword);
  let draftId;
  try {
    await gotoBase(client, 3);
    await client.sendAndWait('W', 'To (or "All"): ');
    await client.sendAndWait('All', 'Subject');
    await client.sendAndWait('E2E-Draft-Subject', 'Enter your message');
    await client.sendAndWait('draft body one', '│ ');
    await client.sendAndWait('draft body two', '│ ');
    const before = client.mark();
    await client.sendAndWait('/D', /Draft #\d+ saved/);
    draftId = lastNumber(client.since(before), /Draft #(\d+) saved/);
    assert.ok(draftId, 'expected the draft number in the terminal output');
    await backToMain(client);
  } finally {
    client.close();
  }

  const drafts = readDrafts(CALLER_A);
  const draft = drafts.find((row) => row.id === draftId);
  assert.ok(draft, `expected draft #${draftId} to persist in storage`);
  assert.equal(draft.subject, 'E2E-Draft-Subject');
  assert.match(draft.body, /draft body one/);
  assert.match(draft.body, /draft body two/);
});

test('reader: cross-user mail shows on the next logon summary and main prompt', async () => {
  // "Callers since last call" is compared with second-resolution timestamps,
  // so space the intervening caller a clear second past the last call.
  await delay(1200);

  const sender = await board.connectTelnet();
  try {
    const credentials = await register(sender, { username: CALLER_B });
    assert.ok(credentials.password);
    callerBPassword = credentials.password;
    await sender.sendAndWait('E', P.mailMenu);
    await sender.sendAndWait('W', P.mailWriteTo);
    await sender.sendAndWait(CALLER_A, 'Subject');
    await sender.sendAndWait('E2E Mail Badge', 'Enter your message');
    await sender.sendAndWait('hello from B', '│ ');
    await sender.sendAndWait('/S', /Mail sent to E2EReaderA!/);
  } finally {
    sender.close();
  }

  const client = await connectAndLogin(CALLER_A, callerAPassword);
  try {
    const text = client.text();
    assert.match(text, /Electronic mail waiting:\s+1/);
    assert.match(lastSection(text, 'MAIN MENU'), /Mail: 1\b/);
    assert.match(text, /Callers since last call:\s+[1-9]/);
    assert.doesNotMatch(text, /Last call: First call/);
    assert.doesNotMatch(text, /Previous caller: None recorded/);
  } finally {
    client.close();
  }
});

test('reader: a fresh caller default newscan order matches the conference list', async () => {
  // CALLER_B has never opened the personal newscan, so this is its first
  // subscription read. Reading Show & Tell first must not disturb the default
  // scan order, which should mirror the [M] conference order (config.json).
  const client = await connectAndLogin(CALLER_B, callerBPassword);
  try {
    await client.sendAndWait('M', P.conferences);
    const listed = client.mark();
    await client.sendAndWait('3', P.messageList);
    const listView = client.since(listed);
    const firstId = lastNumber(listView, /(\d+)\s+E2E-/);
    assert.ok(firstId, 'expected a Show & Tell message to read first');
    await client.sendAndWait(String(firstId), P.messageRead);
    await client.sendAndWait('Q', P.messageList);
    await client.sendAndWait('Q', P.conferences);

    await client.sendAndWait('R', P.readerSetup);
    const order = parseReaderScreen(client.text()).map((entry) => entry.name);
    assert.deepEqual(order, [
      'General Discussion', 'Show & Tell', 'Vibe Coding', 'AI Workflows',
    ]);

    await closeReaderSetup(client);
  } finally {
    client.close();
  }
});
