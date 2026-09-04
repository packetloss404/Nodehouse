const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-test-'));
const testDbPath = path.join(testDir, 'nodehouse.db');
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODEHOUSE_DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';

const database = require('../src/core/database');

test.after(() => {
  delete process.env.NODEHOUSE_DB_PATH;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  fs.rmSync(testDir, { recursive: true, force: true });
});

test('database override, fresh content, and exact-match rename migration are safe', () => {
  assert.equal(database.resolveDatabasePath(), testDbPath);

  const preMenuModeDb = new Database(testDbPath);
  preMenuModeDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      real_name TEXT DEFAULT '',
      location TEXT DEFAULT '',
      email TEXT DEFAULT '',
      access_level INTEGER DEFAULT 10,
      total_calls INTEGER DEFAULT 0,
      total_posts INTEGER DEFAULT 0,
      total_uploads INTEGER DEFAULT 0,
      total_downloads INTEGER DEFAULT 0,
      last_call_date TEXT,
      first_call_date TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  preMenuModeDb.close();

  const db = database.init();
  const bulletin = db.prepare('SELECT title, body FROM bulletins LIMIT 1').get();
  const message = db.prepare('SELECT id, subject, body, global_id, root_id FROM messages WHERE base_id = 1 LIMIT 1').get();
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);

  assert.equal(bulletin.title, 'Welcome to The Nodehouse!');
  assert.match(bulletin.body, /multi-node bulletin board system/);
  assert.match(bulletin.body, /Vibe Community/);
  assert.equal(message.subject, 'Welcome to The Nodehouse!');
  assert.doesNotMatch(message.body, /VibeBBS/);
  assert.match(message.global_id, /^(nodehouse:local:|[0-9a-f-]{36})/);
  assert.equal(message.root_id, message.id);
  assert.ok(userColumns.includes('menu_mode'));
  const tables = new Set(db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).all().map((row) => row.name));
  for (const required of ['users', 'messages', 'message_read', 'reader_subscriptions',
    'reader_preferences', 'message_drafts', 'user_profiles', 'porch_notices',
    'moderation_items', 'audit_events', 'door_saves', 'door_runs', 'door_seasons',
    'offline_packets', 'offline_packet_tokens']) {
    assert.ok(tables.has(required), `expected additive table ${required}`);
  }

  const previousBulletinBody = 'Welcome to PacketBBS, a multi-node bulletin board system.\r\n\r\n' +
    'Check your electronic mail, scan the message conferences, browse the\r\n' +
    'file libraries, meet other callers, and try the doors.\r\n\r\n' +
    'The Vibe Community keeps the original experimental boards and games\r\n' +
    'alive inside the larger system.\r\n\r\n' +
    'Be excellent to each other. - SysOp';

  db.prepare('UPDATE bulletins SET title = ?, body = ? WHERE id = 1')
    .run('Welcome to PacketBBS!', previousBulletinBody);
  db.prepare('INSERT INTO bulletins (title, body, author) VALUES (?, ?, ?)')
    .run('Welcome to VibeBBS!', 'A caller-authored custom bulletin', 'Caller');

  const seededPoll = db.prepare(`
    SELECT id FROM polls WHERE author = 'SysOp' AND question = ?
  `).get('What brings you back to a BBS?');
  const seededOptions = db.prepare(`
    SELECT id FROM poll_options WHERE poll_id = ? ORDER BY sort_order, id
  `).all(seededPoll.id);
  const oldQuestion = 'What is your favorite AI coding assistant?';
  const oldOptions = ['Claude', 'ChatGPT', 'Copilot', 'Gemini', 'Other'];
  db.prepare('UPDATE polls SET question = ? WHERE id = ?').run(oldQuestion, seededPoll.id);
  const updateOption = db.prepare('UPDATE poll_options SET option_text = ? WHERE id = ?');
  seededOptions.forEach((option, index) => updateOption.run(oldOptions[index], option.id));
  const sysop = db.prepare("SELECT id FROM users WHERE username = 'SysOp'").get();
  db.prepare('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)')
    .run(seededPoll.id, seededOptions[0].id, sysop.id);
  db.close();

  const migratedDb = database.init();
  const migratedStock = migratedDb.prepare('SELECT title FROM bulletins WHERE id = 1').get();
  const custom = migratedDb.prepare("SELECT title FROM bulletins WHERE author = 'Caller'").get();
  assert.equal(migratedStock.title, 'Welcome to The Nodehouse!');
  assert.equal(custom.title, 'Welcome to VibeBBS!');
  const preservedVote = migratedDb.prepare(`
    SELECT p.question, po.option_text
    FROM poll_votes pv
    JOIN polls p ON p.id = pv.poll_id
    JOIN poll_options po ON po.id = pv.option_id
    WHERE pv.poll_id = ?
  `).get(seededPoll.id);
  assert.equal(preservedVote.question, oldQuestion);
  assert.equal(preservedVote.option_text, 'Claude');
  const replacementPoll = migratedDb.prepare(`
    SELECT id FROM polls WHERE author = 'SysOp' AND question = ?
  `).get('What brings you back to a BBS?');
  assert.ok(replacementPoll);
  assert.notEqual(replacementPoll.id, seededPoll.id);
  migratedDb.close();
});
