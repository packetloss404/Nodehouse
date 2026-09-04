'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-caller-features-'));
const testDbPath = path.join(testDir, 'nodehouse.db');
const previousDbPath = process.env.NODEHOUSE_DB_PATH;
const previousNodeEnv = process.env.NODE_ENV;
process.env.NODEHOUSE_DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const database = require('../src/core/database');
const BBSSession = require('../src/core/bbs');
const NodeManager = require('../src/server/node-manager');
const ansi = require('../src/core/ansi');

let sqlite;

function makeCaller(nodeManager, user, packetService = null) {
  const output = [];
  const transport = {
    write(value) { output.push(String(value)); },
    end() {},
  };
  const nodeNum = nodeManager.allocateNode(null);
  const session = new BBSSession(transport, nodeNum, nodeManager, { packetService });
  nodeManager.getNode(nodeNum).session = session;
  session.loginUser(user);
  session.showMainMenu(true);
  output.length = 0;
  return { session, output, nodeNum };
}

function plain(chunks) {
  return ansi.stripCodes(chunks.join(''));
}

function takeScreen(caller, action) {
  const start = caller.output.length;
  action();
  return caller.output.slice(start);
}

function assertFramedScreen(chunks) {
  const lines = plain(chunks).split(/\r?\n/).filter(Boolean);
  const frameLines = lines.filter((line) => /[┌┐├┤└┘│]/.test(line));
  assert.ok(frameLines.length > 0, 'expected a framed terminal screen');
  for (const line of frameLines) assert.ok([...line].length <= 80, `screen exceeds 80 columns: ${line}`);
  const rows = frameLines.filter((line) => line.includes('│'));
  const rightEdges = new Set(rows.map((line) => line.lastIndexOf('│')));
  assert.equal(rightEdges.size, 1, `misaligned frame rows: ${[...rightEdges].join(', ')}`);
}

test.after(() => {
  if (sqlite && sqlite.open) sqlite.close();
  if (previousDbPath === undefined) delete process.env.NODEHOUSE_DB_PATH;
  else process.env.NODEHOUSE_DB_PATH = previousDbPath;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('caller experience connects daily reading, porch, nodes, art, doors, and packets', () => {
  sqlite = database.init();
  const bobUser = database.users.create('Bob', 'correct-horse-battery', 'Robert');
  const nodeManager = new NodeManager(4, { pageCooldownMs: 1 });
  nodeManager.setTelegramSender((from, to, body) => {
    if (!database.users.findByUsername(to)) return false;
    database.privateMail.sendTelegram(from, to, body);
    return true;
  });
  const packetCalls = [];
  const packetService = {
    createExport(user, format) {
      packetCalls.push(['export', user.username, format]);
      return { token: 'caller-download-token', messageCount: 3 };
    },
    createImport(user, format) {
      packetCalls.push(['import', user.username, format]);
      return { token: 'caller-upload-token' };
    },
  };
  const sysop = makeCaller(nodeManager, database.users.findByUsername('SysOp'), packetService);
  const bob = makeCaller(nodeManager, bobUser);

  // The Daily Call is a useful, one-key route into the caller's day.
  const daily = takeScreen(sysop, () => sysop.session.showDailyCall());
  assert.match(plain(daily), /NODEHOUSE \/\/ THE DAILY CALL/);
  assert.match(plain(daily), /Mail waiting:/);
  assert.match(plain(daily), /Subscribed conference messages:/);
  assert.match(plain(daily), /\[N\] Newscan.*\[H\] Porch/);

  // Personalized newscan setup, search, thread view, and mark-unread all use durable state.
  sysop.session.showMessageBases();
  sysop.session.processInput('R');
  assert.equal(sysop.session.state, 'reader_setup');
  assert.match(plain(sysop.output), /PERSONAL NEWSCAN/);
  const before = database.readerSubscriptions.list(sysop.session.user.id)[0];
  sysop.session.processInput('T1');
  const toggled = database.readerSubscriptions.list(sysop.session.user.id)[0];
  assert.notEqual(toggled.subscribed, before.subscribed);
  sysop.session.processInput('T1');
  sysop.session.processInput('Q');

  const rootId = Number(database.messages.create(1, 'SysOp', 'All', 'Copper modem needle', 'Root of a useful thread'));
  const replyId = Number(database.messages.create(1, 'Bob', 'All', 'Re: Copper modem needle', 'A threaded reply', rootId));
  sysop.session.processInput('1');
  assert.equal(sysop.session.state, 'message_list');
  sysop.session.processInput('S');
  const search = takeScreen(sysop, () => sysop.session.processInput('needle'));
  assert.match(plain(search), /Search results/);
  assert.match(plain(search), /Copper modem needle/);
  sysop.session.processInput('');
  const reader = takeScreen(sysop, () => sysop.session.processInput(String(rootId)));
  assertFramedScreen(reader);
  const thread = takeScreen(sysop, () => sysop.session.processInput('T'));
  assert.match(plain(thread), /Thread \(2 messages\)/);
  assert.match(plain(thread), new RegExp(`#${replyId}`));
  sysop.session.processInput('U');
  assert.ok(database.messages.getUnreadByBase(1, sysop.session.user.id).some((message) => Number(message.id) === rootId));
  sysop.session.showMessageList();
  sysop.session.processInput('W');
  sysop.session.processInput('All');
  sysop.session.processInput('Saved for later');
  sysop.session.processInput('A draft body');
  sysop.session.processInput('/D');
  assert.ok(sysop.session.reader.listDrafts(sysop.session.user.id)
    .some((draft) => draft.subject === 'Saved for later'));
  sysop.session.showUserSettings();
  sysop.session.processInput('5');
  assert.doesNotThrow(() => sysop.session.processInput('x'.repeat(241)));
  assert.equal(sysop.session.state, 'user_settings_field');
  assert.match(plain(sysop.output), /Signature must be at most/);

  // Caller cards are private until the caller opts in; ordinary porch posts await moderation.
  bob.session.showFrontPorch();
  bob.session.processInput('E');
  bob.session.processInput('Bobby | modems, ANSI | Collector of strange serial cables');
  assert.equal(database.communityProfiles.getByUserId(bob.session.user.id).profile_visible, 0);
  const hiddenDirectory = takeScreen(sysop, () => sysop.session.showDirectory());
  assert.doesNotMatch(plain(hiddenDirectory), /Bobby/);
  bob.session.showFrontPorch();
  bob.session.processInput('V');
  assert.equal(database.communityProfiles.getByUserId(bob.session.user.id).profile_visible, 1);
  const visibleDirectory = takeScreen(sysop, () => sysop.session.showDirectory());
  assert.match(plain(visibleDirectory), /Bobby/);

  bob.session.showFrontPorch();
  bob.session.processInput('P');
  bob.session.processInput('Modem swap this Saturday');
  bob.session.processInput('Bring a 56K modem or help somebody repair one.');
  const porchPost = database.porchPosts.list({ includeInactive: true })
    .find((post) => post.title === 'Modem swap this Saturday');
  assert.equal(porchPost.status, 'pending');
  assert.ok(database.moderationQueue.list({ state: 'open' })
    .some((item) => item.target_type === 'porch_post' && Number(item.target_id) === porchPost.id));
  const pendingPorch = takeScreen(sysop, () => sysop.session.showFrontPorch());
  assert.doesNotMatch(plain(pendingPorch), /Modem swap this Saturday/);
  database.porchPosts.moderate(porchPost.id, { status: 'active' });
  const approvedPorch = takeScreen(sysop, () => sysop.session.showFrontPorch());
  assert.match(plain(approvedPorch), /Modem swap this Saturday/);

  // Node pages establish private chat only after the recipient accepts.
  sysop.session.showNodeLobby();
  sysop.session.processInput('P');
  sysop.session.processInput('Bob');
  sysop.session.processInput('Meet me in private chat');
  const invitation = nodeManager.getPendingPages(bob.nodeNum)[0];
  assert.equal(invitation.fromUsername, 'SysOp');
  bob.session.showNodeLobby();
  bob.session.processInput(`A ${invitation.id.slice(0, 8)}`);
  assert.equal(bob.session.state, 'private_chat');
  sysop.session.showNodeLobby();
  sysop.session.processInput('C');
  const bobOutputStart = bob.output.length;
  sysop.session.processInput('The house is on the wire.');
  assert.match(plain(bob.output.slice(bobOutputStart)), /\[private:SysOp\].*house is on the wire/);
  sysop.session.processInput('/Q');
  assert.equal(nodeManager.getNode(sysop.nodeNum).privateChatId, null);
  assert.equal(nodeManager.getNode(bob.nodeNum).privateChatId, null);

  sysop.session.showNodeLobby();
  sysop.session.processInput('T');
  sysop.session.processInput('Bob');
  sysop.session.processInput('Telegram survives even when chat does not.');
  const telegram = database.privateMail.getInbox('Bob').find((mail) => mail.kind === 'telegram');
  assert.match(telegram.body, /Telegram survives/);

  // The gallery exposes curated ANSI pieces and returns safely through a pause.
  const gallery = takeScreen(sysop, () => sysop.session.showAnsiGallery());
  assert.match(plain(gallery), /ANSI ART GALLERY/);
  assert.ok(sysop.session.stateData.galleryWorks.length >= 4);
  const art = takeScreen(sysop, () => sysop.session.processInput('1'));
  assert.equal(sysop.session.state, 'pause');
  assert.match(plain(art), /N O D E H O U S E/);
  assert.ok(plain(art).split(/\r?\n/).every((line) => [...line].length <= 80));

  // Door league scores are durable, and daily admission closes after the limit.
  const scoredRun = database.doors.beginRun(sysop.session.user.id, 'vibe_wars', 99);
  database.doors.finishRun(scoredRun.runId, 4242);
  const leagues = takeScreen(sysop, () => sysop.session.showDoorLeaderboard());
  assert.match(plain(leagues), /DOOR LEAGUE TABLES/);
  assert.match(plain(leagues), /SysOp\s+4242/);
  for (let count = 1; count < 5; count += 1) database.doors.beginRun(sysop.session.user.id, 'vibe_wars', 5);
  sysop.session.showDoorGames();
  const deniedDoor = takeScreen(sysop, () => sysop.session.processInput('1'));
  assert.match(plain(deniedDoor), /Daily turns used/);
  sysop.session.showDoorGames();
  assert.doesNotThrow(() => sysop.session.processInput('/D'));
  assert.equal(sysop.session.state, 'door_games');

  // Packet Briefcase issues recognizable, short-lived download and upload links.
  sysop.session.showPacketMenu();
  const download = takeScreen(sysop, () => sysop.session.processInput('1'));
  assert.match(plain(download), /\/transfers\/packet\/briefcase\/caller-download-token/);
  sysop.session.processInput('');
  const upload = takeScreen(sysop, () => sysop.session.processInput('3'));
  assert.match(plain(upload), /\/transfers\/packet\/briefcase\/caller-upload-token/);
  assert.deepEqual(packetCalls, [
    ['export', 'SysOp', 'briefcase'],
    ['import', 'SysOp', 'briefcase'],
  ]);
});
