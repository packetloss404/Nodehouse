const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-caller-loop-'));
const testDbPath = path.join(testDir, 'nodehouse.db');
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODEHOUSE_DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const database = require('../src/core/database');
const BBSSession = require('../src/core/bbs');
const NodeManager = require('../src/server/node-manager');
const ansi = require('../src/core/ansi');
const config = require('../config.json');

let db;

test.after(() => {
  if (db && db.open) db.close();
  delete process.env.NODEHOUSE_DB_PATH;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('traditional caller loop preserves continuity from logon through newscan', () => {
  db = database.init();
  const output = [];
  const transport = {
    write(data) { output.push(data); },
    end() {},
  };
  const nodeManager = new NodeManager(4);
  const nodeNum = nodeManager.allocateNode(null);
  const session = new BBSSession(transport, nodeNum, nodeManager);
  nodeManager.nodes.get(nodeNum).session = session;

  const sysop = database.users.findByUsername('SysOp');
  session.loginUser(sysop);

  assert.equal(session.state, 'logon_summary');
  assert.match(ansi.stripCodes(output.join('')), /SINCE YOUR LAST CALL/);
  assert.equal(session.stateData.logonSummary.unreadMessages, 2);

  session.processInput('');
  assert.equal(session.state, 'motd');
  session.processInput('');
  assert.equal(session.state, 'main_menu');

  const mainScreen = ansi.stripCodes(output.join(''));
  assert.match(mainScreen, /Message Conferences/);
  assert.match(mainScreen, /Electronic Mail/);
  assert.match(mainScreen, /New Message Scan/);
  assert.match(mainScreen, /Last Callers/);

  for (const showScreen of [
    () => session.showFileAreas(),
    () => session.showChatRooms(),
    () => session.showGraffitiWall(),
    () => session.showPrivateMailMenu(),
    () => session.showUserSettings(),
  ]) {
    const start = output.length;
    showScreen();
    const screenLines = ansi.stripCodes(output.slice(start).join('')).split(/\r?\n/);
    assert.ok(screenLines.every((line) => line.length <= 80));
    const frameColumn = Math.max(...screenLines
      .filter((line) => /[┌├└]/.test(line))
      .map((line) => Math.max(line.lastIndexOf('┐'), line.lastIndexOf('┤'), line.lastIndexOf('┘'))));
    for (const line of screenLines.filter((candidate) => candidate.includes('│'))) {
      assert.equal(line.lastIndexOf('│'), frameColumn, `misaligned frame row: ${line}`);
    }
  }

  for (const base of config.messageBases) {
    for (const message of database.messages.getByBase(base.id)) {
      database.messages.markRead(message.id, sysop.id);
    }
  }

  const firstUnread = database.messages.create(1, 'SysOp', 'All', 'First unread', 'One');
  const alreadyRead = database.messages.create(2, 'SysOp', 'All', 'Already read', 'Two');
  const secondUnread = database.messages.create(3, 'SysOp', 'All', 'Second unread', 'Three');
  database.messages.markRead(alreadyRead, sysop.id);

  session.startNewMessageScan();
  assert.equal(session.state, 'message_read');
  assert.equal(session.stateData.scanMode, 'GLOBAL');
  assert.deepEqual(session.stateData.messages.map((message) => message.id), [firstUnread, secondUnread]);
  assert.equal(session.stateData.currentBase.name, 'General Discussion');

  session.processInput('F');
  assert.equal(session.state, 'message_write_subject');
  assert.equal(session.stateData.newMessage.to, 'All');
  assert.equal(session.stateData.newMessage.replyTo, firstUnread);
  session.processInput('');
  session.processInput('A public follow-up from the scan.');
  session.processInput('/S');
  assert.equal(session.state, 'message_read');
  assert.equal(session.stateData.scanMode, 'GLOBAL');
  assert.equal(session.stateData.messageIndex, 0);
  assert.equal(database.messages.getUnreadByBase(1, sysop.id).length, 0);

  session.processInput('N');
  assert.equal(session.stateData.currentBase.name, 'Show & Tell');
  session.processInput('R');
  assert.equal(session.state, 'private_mail_write_to');
  assert.equal(session.stateData.newMail.to, 'SysOp');
  session.processInput('');
  session.processInput('');
  session.processInput('/A');
  assert.equal(session.state, 'message_read');
  assert.equal(session.stateData.scanMode, 'GLOBAL');
  assert.equal(session.stateData.messageIndex, 1);

  session.processInput('N');
  assert.equal(session.state, 'main_menu');
  assert.equal(session.stateData.scanMode, null);

  session.cycleMenuMode();
  assert.equal(session.user.menu_mode, 'EXPERT');
  assert.match(ansi.stripCodes(output.at(-1)), /Mail:/);
  session.cycleMenuMode();
  assert.equal(session.user.menu_mode, 'SUPER');

  session.showLastCallers();
  assert.equal(session.state, 'last_callers');
  assert.match(ansi.stripCodes(output.at(-1)), /LAST CALLERS/);

  const callLogId = session.callLogId;
  session.disconnect();
  session.disconnect();
  assert.equal(nodeManager.getOnlineCount(), 0);
  assert.ok(db.prepare('SELECT logout_time FROM call_log WHERE id = ?').get(callLogId).logout_time);
});

test('caller guardrails bound input, registration, and failed logins', () => {
  if (!db || !db.open) db = database.init();

  const output = [];
  let transportEnds = 0;
  const transport = {
    write(data) { output.push(data); },
    end() { transportEnds += 1; },
  };
  const nodeManager = new NodeManager(4);
  const nodeNum = nodeManager.allocateNode(null);
  const session = new BBSSession(transport, nodeNum, nodeManager, {
    consumeRegistration() { return false; },
    recordLoginFailure() { return true; },
  });
  nodeManager.nodes.get(nodeNum).session = session;

  session.handleData('A'.repeat(5000));
  assert.equal(session.inputBuffer.length, 4096);
  session.inputBuffer = '';

  session.processInput('NEW');
  assert.equal(session.state, 'login_username');
  assert.match(ansi.stripCodes(output.join('')), /Registration limit reached/);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    session.processInput('SysOp');
    session.processInput('definitely-wrong');
  }

  assert.equal(session.sessionEnded, true);
  assert.equal(transportEnds, 1);
  assert.equal(nodeManager.getOnlineCount(), 0);
  assert.match(ansi.stripCodes(output.join('')), /Too many failed login attempts/);
});
