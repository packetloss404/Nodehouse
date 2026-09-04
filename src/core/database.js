const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { isProductionEnvironment } = require('../server/runtime-config');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'nodehouse.db');
const LEGACY_DB_PATHS = [
  path.join(PROJECT_ROOT, 'data', 'packetbbs.db'),
  path.join(PROJECT_ROOT, 'data', 'vibebbs.db'),
];
const MIN_BOOTSTRAP_PASSWORD_LENGTH = 12;

function resolveDatabasePath(env = process.env) {
  const configuredPath = env.NODEHOUSE_DB_PATH || env.PACKETBBS_DB_PATH;
  if (configuredPath) {
    return path.resolve(PROJECT_ROOT, configuredPath);
  }
  if (env.RAILWAY_VOLUME_MOUNT_PATH) {
    return path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'nodehouse.db');
  }
  if (fs.existsSync(DEFAULT_DB_PATH)) return DEFAULT_DB_PATH;
  return LEGACY_DB_PATHS.find((candidate) => fs.existsSync(candidate)) || DEFAULT_DB_PATH;
}

function resolveBootstrapSysopPassword(env = process.env) {
  const configured = env.NODEHOUSE_SYSOP_PASSWORD || env.PACKETBBS_SYSOP_PASSWORD;
  if (configured !== undefined) {
    if (configured.length < MIN_BOOTSTRAP_PASSWORD_LENGTH) {
      throw new Error(`NODEHOUSE_SYSOP_PASSWORD must be at least ${MIN_BOOTSTRAP_PASSWORD_LENGTH} characters.`);
    }
    return configured;
  }

  const insecureDevelopmentMode = env.NODE_ENV === 'development' ||
    env.NODE_ENV === 'test' ||
    env.NODEHOUSE_ALLOW_INSECURE_DEV_PASSWORD === '1' ||
    env.PACKETBBS_ALLOW_INSECURE_DEV_PASSWORD === '1';
  if (!insecureDevelopmentMode || isProductionEnvironment(env)) {
    throw new Error(
      'A fresh Nodehouse database requires NODEHOUSE_SYSOP_PASSWORD. ' +
      'The built-in development password is disabled outside explicit development/test mode.'
    );
  }

  return 'sysop';
}

const DB_PATH = resolveDatabasePath();

const seedContent = {
  legacy: {
    bulletinTitle: 'Welcome to VibeBBS!',
    bulletinBody: 'Welcome to VibeBBS, the bulletin board system for vibe coders!\r\n\r\n' +
      'This is a place where retro meets the future. Share your AI-assisted\r\n' +
      'coding projects, swap prompts, play door games, and connect with\r\n' +
      'fellow vibe coders.\r\n\r\n' +
      'Check out the Message Bases to start chatting, or hit up the Door\r\n' +
      'Games for some classic fun.\r\n\r\n' +
      'Keep vibing! - SysOp',
    messageSubject: 'Welcome to VibeBBS!',
    messageBody: 'Welcome to VibeBBS! This is the General Discussion area.\r\n' +
      'Feel free to introduce yourself and start chatting.\r\n\r\n' +
      'Remember: Be excellent to each other!',
    motdBody: 'Welcome to VibeBBS! Check out the Message Bases, play some Door Games,\r\n' +
      'and leave your mark on the Graffiti Wall. New features added regularly!\r\n' +
      '\r\n' +
      'Remember: Be excellent to each other. Keep vibing!',
    graffitiMessage: 'First! Welcome to VibeBBS - leave your mark here!',
  },
  packetbbs: {
    bulletinTitle: 'Welcome to PacketBBS!',
    bulletinBody: 'Welcome to PacketBBS, a terminal community for builders and curious minds!\r\n\r\n' +
      'This is where retro BBS culture meets modern projects. Share what you are\r\n' +
      'building, swap tools and workflows, play door games, and meet callers.\r\n\r\n' +
      'The Vibe Sub-BBS keeps the AI-assisted experiments glowing without\r\n' +
      'defining the whole board. Find it inside the Message Bases.\r\n\r\n' +
      'Dial in. Drop a packet. Stay awhile. - SysOp',
    messageSubject: 'Welcome to PacketBBS!',
    messageBody: 'Welcome to PacketBBS! This is the General Discussion board.\r\n' +
      'Introduce yourself, share what you are building, or start a conversation.\r\n\r\n' +
      'Remember: Be excellent to each other!',
    motdBody: 'Welcome to PacketBBS! Browse the boards, play some Door Games,\r\n' +
      'and leave your mark on the Graffiti Wall.\r\n\r\n' +
      'Dial in. Drop a packet. Stay awhile.',
    graffitiMessage: 'First! Welcome to PacketBBS - leave your mark here!',
  },
  packetbbsCurrent: {
    bulletinTitle: 'Welcome to PacketBBS!',
    bulletinBody: 'Welcome to PacketBBS, a multi-node bulletin board system.\r\n\r\n' +
      'Check your electronic mail, scan the message conferences, browse the\r\n' +
      'file libraries, meet other callers, and try the doors.\r\n\r\n' +
      'The Vibe Community keeps the original experimental boards and games\r\n' +
      'alive inside the larger system.\r\n\r\n' +
      'Be excellent to each other. - SysOp',
    messageSubject: 'Welcome to PacketBBS!',
    messageBody: 'Welcome to the General Discussion conference.\r\n' +
      'Introduce yourself, join a thread, or tell us what brought you here.\r\n\r\n' +
      'Be excellent to each other.',
    motdBody: 'PacketBBS is online. Check your mail, run a new-message scan,\r\n' +
      'browse the file libraries, and visit the doors.\r\n\r\n' +
      'Press ? at the Main prompt to redisplay the command menu.',
    graffitiMessage: 'First caller on the PacketBBS one-liner board!',
  },
  current: {
    bulletinTitle: 'Welcome to The Nodehouse!',
    bulletinBody: 'Welcome to The Nodehouse, a multi-node bulletin board system powered by Nodehouse.\r\n\r\n' +
      'Check your electronic mail, scan the message conferences, browse the\r\n' +
      'file libraries, meet other callers, and try the doors.\r\n\r\n' +
      'The Vibe Community keeps the original experimental boards and games\r\n' +
      'alive inside the larger system.\r\n\r\n' +
      'Be excellent to each other. - SysOp',
    messageSubject: 'Welcome to The Nodehouse!',
    messageBody: 'Welcome to the General Discussion conference.\r\n' +
      'Introduce yourself, join a thread, or tell us what brought you here.\r\n\r\n' +
      'Be excellent to each other.',
    motdBody: 'The Nodehouse is online. Check your mail, run a new-message scan,\r\n' +
      'browse the file libraries, and visit the doors.\r\n\r\n' +
      'Press ? at the Main prompt to redisplay the command menu.',
    graffitiMessage: 'First caller on The Nodehouse one-liner board!',
  },
};

let db;

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const result = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return result.length === expected.length && crypto.timingSafeEqual(result, expected);
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function init() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
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
      menu_mode TEXT NOT NULL DEFAULT 'NOVICE',
      last_call_date TEXT,
      first_call_date TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_id INTEGER NOT NULL,
      from_user TEXT NOT NULL,
      to_user TEXT DEFAULT 'All',
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      reply_to INTEGER DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS message_read (
      user_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, message_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (message_id) REFERENCES messages(id)
    );

    CREATE TABLE IF NOT EXISTS call_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      login_time TEXT DEFAULT (datetime('now')),
      logout_time TEXT,
      node_num INTEGER
    );

    CREATE TABLE IF NOT EXISTS bulletins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      author TEXT DEFAULT 'SysOp',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      description TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      uploaded_by TEXT NOT NULL,
      download_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS graffiti (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS private_mail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS polls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT NOT NULL,
      author TEXT DEFAULT 'SysOp',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      option_text TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (poll_id) REFERENCES polls(id)
    );

    CREATE TABLE IF NOT EXISTS poll_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_id INTEGER NOT NULL,
      option_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(poll_id, user_id),
      FOREIGN KEY (poll_id) REFERENCES polls(id),
      FOREIGN KEY (option_id) REFERENCES poll_options(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS motd (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL,
      author TEXT DEFAULT 'SysOp',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS dungeon_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      hp INTEGER DEFAULT 30,
      max_hp INTEGER DEFAULT 30,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      gold INTEGER DEFAULT 50,
      attack INTEGER DEFAULT 5,
      defense INTEGER DEFAULT 3,
      room TEXT DEFAULT 'entrance_hall',
      inventory TEXT DEFAULT '[]',
      status TEXT DEFAULT 'alive',
      turns_played INTEGER DEFAULT 0,
      monsters_slain INTEGER DEFAULT 0,
      deepest_floor INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS dungeon_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_dungeon_history_user ON dungeon_history(user_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_messages_base ON messages(base_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_files_area ON files(area_id);
    CREATE INDEX IF NOT EXISTS idx_private_mail_to ON private_mail(to_user);
    CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);
  `);

  // Additive compatibility for databases created before caller menu modes.
  ensureColumn('users', 'menu_mode', "TEXT NOT NULL DEFAULT 'NOVICE'");

  // Reader continuity and extension tables are deliberately additive. Existing
  // local message IDs and message_read rows remain the canonical read state.
  ensureColumn('messages', 'global_id', 'TEXT');
  ensureColumn('messages', 'root_id', 'INTEGER');
  ensureColumn('messages', 'author_user_id', 'INTEGER');
  ensureColumn('messages', 'status', "TEXT NOT NULL DEFAULT 'accepted'");
  ensureColumn('private_mail', 'kind', "TEXT NOT NULL DEFAULT 'mail'");
  ensureColumn('private_mail', 'expires_at', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_global_id
      ON messages(global_id) WHERE global_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_thread
      ON messages(base_id, root_id, created_at, id);

    CREATE TABLE IF NOT EXISTS reader_subscriptions (
      user_id INTEGER NOT NULL,
      base_id INTEGER NOT NULL,
      subscribed INTEGER NOT NULL DEFAULT 1 CHECK (subscribed IN (0, 1)),
      sort_order INTEGER NOT NULL DEFAULT 0,
      high_water_mark INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, base_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reader_preferences (
      user_id INTEGER PRIMARY KEY,
      current_base_id INTEGER,
      signature TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS message_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      base_id INTEGER,
      to_user TEXT NOT NULL DEFAULT 'All',
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      reply_to INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reply_to) REFERENCES messages(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_message_drafts_user
      ON message_drafts(user_id, updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      interests TEXT NOT NULL DEFAULT '',
      favorite_boards TEXT NOT NULL DEFAULT '',
      favorite_doors TEXT NOT NULL DEFAULT '',
      ansi_avatar TEXT NOT NULL DEFAULT '',
      profile_visible INTEGER NOT NULL DEFAULT 0 CHECK (profile_visible IN (0, 1)),
      spotlight_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (spotlight_opt_in IN (0, 1)),
      birthday TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS porch_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_user_id INTEGER NOT NULL,
      notice_type TEXT NOT NULL DEFAULT 'notice',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_porch_notices_active
      ON porch_notices(status, pinned DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS moderation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT 'open',
      reported_by_user_id INTEGER,
      assigned_to_user_id INTEGER,
      resolution TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (reported_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_moderation_items_state
      ON moderation_items(state, created_at);

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_created
      ON audit_events(created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS door_saves (
      user_id INTEGER NOT NULL,
      door_key TEXT NOT NULL,
      state_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, door_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS door_usage (
      user_id INTEGER NOT NULL,
      door_key TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      turns_used INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, door_key, usage_date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS door_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      door_key TEXT NOT NULL,
      season_id INTEGER,
      score INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_door_runs_leaderboard
      ON door_runs(door_key, season_id, score DESC);

    CREATE TABLE IF NOT EXISTS door_seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      door_key TEXT NOT NULL,
      name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'scheduled',
      rules_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_door_seasons_window
      ON door_seasons(door_key, starts_at, ends_at);

    CREATE TABLE IF NOT EXISTS offline_packets (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      format TEXT NOT NULL,
      direction TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'created',
      content_hash TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      consumed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_offline_packets_user
      ON offline_packets(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_packets_import_hash
      ON offline_packets(user_id, content_hash)
      WHERE direction = 'import' AND content_hash IS NOT NULL;

    CREATE TABLE IF NOT EXISTS offline_packet_tokens (
      token_hash TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (packet_id) REFERENCES offline_packets(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS file_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      purpose TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_file_transfers_expiry
      ON file_transfers(expires_at, consumed_at);
  `);

  // These caller-card fields arrived after the initial profile migration.
  ensureColumn('user_profiles', 'favorite_boards', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('user_profiles', 'favorite_doors', "TEXT NOT NULL DEFAULT ''");

  migrateLegacySeedContent();

  // Seed default sysop user if no users exist
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const { hash, salt } = hashPassword(resolveBootstrapSysopPassword());
    db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, real_name, access_level)
      VALUES (?, ?, ?, ?, ?)
    `).run('SysOp', hash, salt, 'System Operator', 255);

    // Seed a welcome bulletin
    db.prepare(`
      INSERT INTO bulletins (title, body, author)
      VALUES (?, ?, ?)
    `).run(
      seedContent.current.bulletinTitle,
      seedContent.current.bulletinBody,
      'SysOp'
    );

    // Seed some welcome messages
    db.prepare(`
      INSERT INTO messages (base_id, from_user, to_user, subject, body)
      VALUES (?, ?, ?, ?, ?)
    `).run(1, 'SysOp', 'All', seedContent.current.messageSubject, seedContent.current.messageBody);

    // Seed MOTD
    db.prepare(`
      INSERT INTO motd (body, author) VALUES (?, ?)
    `).run(
      seedContent.current.motdBody,
      'SysOp'
    );

    // Seed a sample poll
    const pollResult = db.prepare(`
      INSERT INTO polls (question, author) VALUES (?, ?)
    `).run('What brings you back to a BBS?', 'SysOp');
    const pollId = pollResult.lastInsertRowid;
    const pollOptions = ['Messages', 'Files', 'Doors', 'Chat', 'The community'];
    for (let i = 0; i < pollOptions.length; i++) {
      db.prepare('INSERT INTO poll_options (poll_id, option_text, sort_order) VALUES (?, ?, ?)').run(pollId, pollOptions[i], i);
    }

    // Seed graffiti wall
    db.prepare('INSERT INTO graffiti (username, message) VALUES (?, ?)').run('SysOp', seedContent.current.graffitiMessage);

    db.prepare(`
      INSERT INTO messages (base_id, from_user, to_user, subject, body)
      VALUES (?, ?, ?, ?, ?)
    `).run(2, 'SysOp', 'All', 'Vibe Coding Tips',
      'Share your best vibe coding tips here!\r\n\r\n' +
      '1. Start with a clear CLAUDE.md file\r\n' +
      '2. Let the AI understand your project structure\r\n' +
      '3. Iterate quickly and keep the vibes flowing\r\n' +
      '4. Don\'t fight the suggestions - flow with them');
  }

  migrateMessageIdentity();
  return db;
}

function migrateMessageIdentity() {
  const missing = db.prepare(`
    SELECT id, reply_to FROM messages
    WHERE global_id IS NULL OR root_id IS NULL
    ORDER BY id
  `).all();
  if (missing.length === 0) return;

  const byId = new Map(db.prepare('SELECT id, reply_to, root_id FROM messages').all()
    .map((message) => [message.id, message]));
  const rootFor = (message) => {
    const seen = new Set([message.id]);
    let cursor = message;
    while (cursor.reply_to && byId.has(cursor.reply_to) && !seen.has(cursor.reply_to)) {
      cursor = byId.get(cursor.reply_to);
      seen.add(cursor.id);
      if (cursor.root_id) return cursor.root_id;
    }
    return cursor.id;
  };
  const update = db.prepare(`
    UPDATE messages SET global_id = COALESCE(global_id, ?), root_id = COALESCE(root_id, ?)
    WHERE id = ?
  `);
  db.transaction(() => {
    for (const message of missing) {
      update.run(`nodehouse:local:${message.id}`, rootFor(message), message.id);
    }
  })();
}

function healthCheck() {
  if (!db || !db.open) return false;
  return db.prepare('SELECT 1 AS ok').get().ok === 1;
}

function close() {
  if (db && db.open) db.close();
}

function migrateLegacySeedContent() {
  const current = seedContent.current;

  db.transaction(() => {
    for (const source of [seedContent.legacy, seedContent.packetbbs, seedContent.packetbbsCurrent]) {
      db.prepare(`
        UPDATE bulletins SET title = ?, body = ?
        WHERE author = 'SysOp' AND title = ? AND body = ?
      `).run(current.bulletinTitle, current.bulletinBody, source.bulletinTitle, source.bulletinBody);

      db.prepare(`
        UPDATE messages SET subject = ?, body = ?
        WHERE base_id = 1 AND from_user = 'SysOp' AND to_user = 'All'
          AND subject = ? AND body = ?
      `).run(current.messageSubject, current.messageBody, source.messageSubject, source.messageBody);

      db.prepare(`
        UPDATE motd SET body = ?
        WHERE author = 'SysOp' AND body = ?
      `).run(current.motdBody, source.motdBody);

      db.prepare(`
        UPDATE graffiti SET message = ?
        WHERE username = 'SysOp' AND message = ?
      `).run(current.graffitiMessage, source.graffitiMessage);
    }

    const oldQuestion = 'What is your favorite AI coding assistant?';
    const oldOptions = ['Claude', 'ChatGPT', 'Copilot', 'Gemini', 'Other'];
    const newOptions = ['Messages', 'Files', 'Doors', 'Chat', 'The community'];
    let hasCurrentPoll = Boolean(db.prepare(`
      SELECT id FROM polls WHERE author = 'SysOp' AND question = ? LIMIT 1
    `).get('What brings you back to a BBS?'));
    const stockPolls = db.prepare(`
      SELECT id FROM polls WHERE author = 'SysOp' AND question = ? ORDER BY id
    `).all(oldQuestion);
    for (const stockPoll of stockPolls) {
      const options = db.prepare(`
        SELECT id, option_text FROM poll_options
        WHERE poll_id = ? ORDER BY sort_order, id
      `).all(stockPoll.id);
      const isStock = options.length === oldOptions.length &&
        options.every((option, index) => option.option_text === oldOptions[index]);
      if (!isStock || hasCurrentPoll) continue;

      const voteCount = db.prepare(`
        SELECT COUNT(*) AS count FROM poll_votes WHERE poll_id = ?
      `).get(stockPoll.id).count;
      if (voteCount === 0) {
        db.prepare('UPDATE polls SET question = ? WHERE id = ?')
          .run('What brings you back to a BBS?', stockPoll.id);
        const updateOption = db.prepare('UPDATE poll_options SET option_text = ? WHERE id = ?');
        options.forEach((option, index) => updateOption.run(newOptions[index], option.id));
      } else {
        const result = db.prepare(`
          INSERT INTO polls (question, author) VALUES (?, ?)
        `).run('What brings you back to a BBS?', 'SysOp');
        const insertOption = db.prepare(`
          INSERT INTO poll_options (poll_id, option_text, sort_order) VALUES (?, ?, ?)
        `);
        newOptions.forEach((option, index) => insertOption.run(result.lastInsertRowid, option, index));
      }
      hasCurrentPoll = true;
    }
  })();
}

// User operations
const users = {
  findByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  authenticate(username, password) {
    const user = this.findByUsername(username);
    if (!user) return null;
    if (verifyPassword(password, user.password_hash, user.password_salt)) {
      return user;
    }
    return null;
  },

  create(username, password, realName = '') {
    const { hash, salt } = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, password_salt, real_name)
      VALUES (?, ?, ?, ?)
    `).run(username, hash, salt, realName);
    return this.findByUsername(username);
  },

  updateLastCall(userId) {
    db.prepare(`
      UPDATE users SET last_call_date = datetime('now'), total_calls = total_calls + 1
      WHERE id = ?
    `).run(userId);
  },

  incrementPosts(userId) {
    db.prepare('UPDATE users SET total_posts = total_posts + 1 WHERE id = ?').run(userId);
  },

  getAll() {
    return db.prepare('SELECT id, username, real_name, location, access_level, total_calls, total_posts, last_call_date, first_call_date FROM users ORDER BY username').all();
  },

  getById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  update(id, fields) {
    const allowed = ['real_name', 'location', 'email', 'access_level', 'menu_mode'];
    const sets = [];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        sets.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (sets.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  delete(id) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },

  resetPassword(id, newPassword) {
    const { hash, salt } = hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?').run(hash, salt, id);
  },

  getStats() {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalCalls = db.prepare('SELECT COALESCE(SUM(total_calls), 0) as total FROM users').get().total;
    return { totalUsers, totalCalls };
  }
};

// Message operations
const messages = {
  getByBase(baseId) {
    return db.prepare('SELECT * FROM messages WHERE base_id = ? ORDER BY created_at ASC').all(baseId);
  },

  getById(id) {
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  },

  create(baseId, fromUser, toUser, subject, body, replyTo = null) {
    return db.transaction(() => {
      let rootId = null;
      if (replyTo !== null && replyTo !== undefined) {
        const parent = db.prepare('SELECT id, base_id, root_id FROM messages WHERE id = ?').get(replyTo);
        if (!parent) throw new Error('Reply parent does not exist.');
        if (Number(parent.base_id) !== Number(baseId)) {
          throw new Error('Reply parent belongs to a different message base.');
        }
        rootId = parent.root_id || parent.id;
      }
      const author = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(fromUser);
      const result = db.prepare(`
        INSERT INTO messages
          (base_id, from_user, to_user, subject, body, reply_to, global_id, root_id, author_user_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        baseId, fromUser, toUser || 'All', subject, body, replyTo,
        crypto.randomUUID(), rootId, author ? author.id : null
      );
      const id = Number(result.lastInsertRowid);
      if (rootId === null) db.prepare('UPDATE messages SET root_id = ? WHERE id = ?').run(id, id);
      return result.lastInsertRowid;
    })();
  },

  countByBase(baseId) {
    return db.prepare('SELECT COUNT(*) as count FROM messages WHERE base_id = ?').get(baseId).count;
  },

  countUnreadByBase(baseId, userId) {
    return db.prepare(`
      SELECT COUNT(*) as count FROM messages m
      WHERE m.base_id = ? AND m.id NOT IN (
        SELECT message_id FROM message_read WHERE user_id = ?
      )
    `).get(baseId, userId).count;
  },

  getUnreadByBase(baseId, userId) {
    return db.prepare(`
      SELECT m.* FROM messages m
      WHERE m.base_id = ? AND NOT EXISTS (
        SELECT 1 FROM message_read mr
        WHERE mr.user_id = ? AND mr.message_id = m.id
      )
      ORDER BY m.created_at ASC, m.id ASC
    `).all(baseId, userId);
  },

  getUnreadByBases(baseIds, userId, limit = 2000) {
    if (!Array.isArray(baseIds) || baseIds.length === 0) return [];
    const placeholders = baseIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT m.* FROM messages m
      WHERE m.base_id IN (${placeholders}) AND NOT EXISTS (
        SELECT 1 FROM message_read mr
        WHERE mr.user_id = ? AND mr.message_id = m.id
      )
      ORDER BY m.created_at ASC, m.id ASC LIMIT ?
    `).all(...baseIds, userId, boundedLimit(limit, 2000, 2000));
  },

  countUnreadByBases(baseIds, userId) {
    if (!Array.isArray(baseIds) || baseIds.length === 0) return 0;
    const placeholders = baseIds.map(() => '?').join(', ');
    return db.prepare(`
      SELECT COUNT(*) AS count FROM messages m
      WHERE m.base_id IN (${placeholders}) AND NOT EXISTS (
        SELECT 1 FROM message_read mr
        WHERE mr.user_id = ? AND mr.message_id = m.id
      )
    `).get(...baseIds, userId).count;
  },

  markRead(messageId, userId) {
    return db.transaction(() => {
      const message = db.prepare('SELECT base_id FROM messages WHERE id = ?').get(messageId);
      if (!message) return false;
      db.prepare(`
        INSERT OR IGNORE INTO message_read (user_id, message_id) VALUES (?, ?)
      `).run(userId, messageId);
      db.prepare(`
        INSERT INTO reader_subscriptions (user_id, base_id, subscribed, sort_order, high_water_mark)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, base_id) DO UPDATE SET
          high_water_mark = MAX(high_water_mark, excluded.high_water_mark),
          updated_at = datetime('now')
      `).run(userId, message.base_id, message.base_id, messageId);
      return true;
    })();
  },

  markUnread(messageId, userId) {
    return db.prepare('DELETE FROM message_read WHERE user_id = ? AND message_id = ?')
      .run(userId, messageId).changes > 0;
  },

  catchUp(baseId, userId, throughMessageId = null) {
    return db.transaction(() => {
      const max = throughMessageId === null
        ? db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM messages WHERE base_id = ?').get(baseId).id
        : Number(throughMessageId);
      const result = db.prepare(`
        INSERT OR IGNORE INTO message_read (user_id, message_id)
        SELECT ?, id FROM messages WHERE base_id = ? AND id <= ?
      `).run(userId, baseId, max);
      db.prepare(`
        INSERT INTO reader_subscriptions (user_id, base_id, subscribed, sort_order, high_water_mark)
        VALUES (?, ?, 1, ?, ?)
        ON CONFLICT(user_id, base_id) DO UPDATE SET
          high_water_mark = MAX(high_water_mark, excluded.high_water_mark),
          updated_at = datetime('now')
      `).run(userId, baseId, baseId, max);
      return { markedRead: result.changes, highWaterMark: max };
    })();
  },

  getThread(messageId) {
    const message = this.getById(messageId);
    if (!message) return [];
    const rootId = message.root_id || message.id;
    return db.prepare(`
      SELECT * FROM messages
      WHERE base_id = ? AND (root_id = ? OR id = ?)
      ORDER BY created_at, id
    `).all(message.base_id, rootId, rootId);
  },

  search(query, baseIds, { limit = 50, offset = 0 } = {}) {
    if (!Array.isArray(baseIds) || baseIds.length === 0 || !String(query).trim()) return [];
    const ids = [...new Set(baseIds.map(Number).filter(Number.isInteger))];
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const pattern = `%${escapeLike(String(query).trim())}%`;
    return db.prepare(`
      SELECT * FROM messages
      WHERE status = 'accepted' AND base_id IN (${placeholders})
        AND (subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
          OR from_user LIKE ? ESCAPE '\\')
      ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `).all(...ids, pattern, pattern, pattern, boundedLimit(limit), Math.max(0, Number(offset) || 0));
  },

  getTotal() {
    return db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  },

  delete(id) {
    db.prepare('DELETE FROM message_read WHERE message_id = ?').run(id);
    db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  }
};

function boundedLimit(value, fallback = 50, maximum = 200) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function escapeLike(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

const readerSubscriptions = {
  ensure(userId, baseIds) {
    const ids = [...new Set((baseIds || []).map(Number).filter(Number.isInteger))];
    const insert = db.prepare(`
      INSERT OR IGNORE INTO reader_subscriptions
        (user_id, base_id, subscribed, sort_order, high_water_mark)
      VALUES (?, ?, 1, ?, 0)
    `);
    db.transaction(() => ids.forEach((baseId, index) => insert.run(userId, baseId, index)))();
    return this.list(userId);
  },

  list(userId) {
    return db.prepare(`
      SELECT * FROM reader_subscriptions WHERE user_id = ?
      ORDER BY sort_order, base_id
    `).all(userId);
  },

  set(userId, baseId, subscribed, sortOrder = null) {
    const existing = db.prepare(`
      SELECT sort_order FROM reader_subscriptions WHERE user_id = ? AND base_id = ?
    `).get(userId, baseId);
    const order = sortOrder === null ? (existing?.sort_order ?? Number(baseId)) : Number(sortOrder);
    db.prepare(`
      INSERT INTO reader_subscriptions (user_id, base_id, subscribed, sort_order)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, base_id) DO UPDATE SET
        subscribed = excluded.subscribed,
        sort_order = excluded.sort_order,
        updated_at = datetime('now')
    `).run(userId, baseId, subscribed ? 1 : 0, order);
    return db.prepare('SELECT * FROM reader_subscriptions WHERE user_id = ? AND base_id = ?')
      .get(userId, baseId);
  },

  reorder(userId, orderedBaseIds) {
    const update = db.prepare(`
      UPDATE reader_subscriptions SET sort_order = ?, updated_at = datetime('now')
      WHERE user_id = ? AND base_id = ?
    `);
    db.transaction(() => orderedBaseIds.forEach((baseId, index) => update.run(index, userId, baseId)))();
    return this.list(userId);
  },
};

const readerPreferences = {
  get(userId) {
    return db.prepare('SELECT * FROM reader_preferences WHERE user_id = ?').get(userId) || {
      user_id: userId, current_base_id: null, signature: '',
    };
  },

  setCurrentBase(userId, baseId) {
    db.prepare(`
      INSERT INTO reader_preferences (user_id, current_base_id) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        current_base_id = excluded.current_base_id, updated_at = datetime('now')
    `).run(userId, baseId);
    return this.get(userId);
  },

  setSignature(userId, signature) {
    db.prepare(`
      INSERT INTO reader_preferences (user_id, signature) VALUES (?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        signature = excluded.signature, updated_at = datetime('now')
    `).run(userId, signature);
    return this.get(userId);
  },
};

const messageDrafts = {
  list(userId) {
    return db.prepare(`
      SELECT * FROM message_drafts WHERE user_id = ? ORDER BY updated_at DESC, id DESC
    `).all(userId);
  },

  get(userId, id) {
    return db.prepare('SELECT * FROM message_drafts WHERE user_id = ? AND id = ?').get(userId, id);
  },

  create(userId, draft) {
    const result = db.prepare(`
      INSERT INTO message_drafts (user_id, base_id, to_user, subject, body, reply_to)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, draft.baseId ?? null, draft.toUser || 'All', draft.subject || '', draft.body || '', draft.replyTo ?? null);
    return this.get(userId, result.lastInsertRowid);
  },

  update(userId, id, draft) {
    const result = db.prepare(`
      UPDATE message_drafts SET base_id = ?, to_user = ?, subject = ?, body = ?, reply_to = ?,
        updated_at = datetime('now') WHERE user_id = ? AND id = ?
    `).run(draft.baseId ?? null, draft.toUser || 'All', draft.subject || '', draft.body || '', draft.replyTo ?? null, userId, id);
    return result.changes ? this.get(userId, id) : null;
  },

  delete(userId, id) {
    return db.prepare('DELETE FROM message_drafts WHERE user_id = ? AND id = ?').run(userId, id).changes > 0;
  },

  trim(userId, keep) {
    return db.prepare(`
      DELETE FROM message_drafts WHERE user_id = ? AND id NOT IN (
        SELECT id FROM message_drafts WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?
      )
    `).run(userId, userId, keep).changes;
  },
};

const communityProfiles = {
  getByUserId(userId) {
    return db.prepare(`
      SELECT p.*, u.username, u.location, u.first_call_date, u.last_call_date, u.total_calls, u.total_posts
      FROM user_profiles p JOIN users u ON u.id = p.user_id WHERE p.user_id = ?
    `).get(userId);
  },

  getByUsername(username, includeHidden = false) {
    return db.prepare(`
      SELECT p.*, u.username, u.location, u.first_call_date, u.last_call_date, u.total_calls, u.total_posts
      FROM user_profiles p JOIN users u ON u.id = p.user_id
      WHERE u.username = ? COLLATE NOCASE ${includeHidden ? '' : 'AND p.profile_visible = 1'}
    `).get(username);
  },

  upsert(userId, fields = {}) {
    const current = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(userId) || {};
    const value = (key, fallback = '') => fields[key] === undefined ? (current[key] ?? fallback) : fields[key];
    db.prepare(`
      INSERT INTO user_profiles
        (user_id, display_name, bio, interests, favorite_boards, favorite_doors,
         ansi_avatar, profile_visible, spotlight_opt_in, birthday)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        display_name = excluded.display_name, bio = excluded.bio, interests = excluded.interests,
        favorite_boards = excluded.favorite_boards, favorite_doors = excluded.favorite_doors,
        ansi_avatar = excluded.ansi_avatar, profile_visible = excluded.profile_visible,
        spotlight_opt_in = excluded.spotlight_opt_in, birthday = excluded.birthday,
        updated_at = datetime('now')
    `).run(
      userId, value('display_name'), value('bio'), value('interests'),
      value('favorite_boards'), value('favorite_doors'), value('ansi_avatar'),
      value('profile_visible', 0) ? 1 : 0, value('spotlight_opt_in', 0) ? 1 : 0,
      value('birthday', null)
    );
    return this.getByUserId(userId);
  },

  listVisible({ search = '', limit = 50, offset = 0 } = {}) {
    const pattern = `%${escapeLike(search)}%`;
    return db.prepare(`
      SELECT p.*, u.username, u.location, u.first_call_date, u.last_call_date, u.total_calls, u.total_posts
      FROM user_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.profile_visible = 1 AND
        (u.username LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\' OR
         p.bio LIKE ? ESCAPE '\\' OR p.interests LIKE ? ESCAPE '\\')
      ORDER BY COALESCE(u.last_call_date, u.first_call_date) DESC, u.username
      LIMIT ? OFFSET ?
    `).all(pattern, pattern, pattern, pattern, boundedLimit(limit), Math.max(0, Number(offset) || 0));
  },

  listAll({ search = '', limit = 50, offset = 0 } = {}) {
    const pattern = `%${escapeLike(search)}%`;
    return db.prepare(`
      SELECT p.*, u.username, u.location, u.first_call_date, u.last_call_date, u.total_calls, u.total_posts
      FROM user_profiles p JOIN users u ON u.id = p.user_id
      WHERE u.username LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\'
        OR p.bio LIKE ? ESCAPE '\\' OR p.interests LIKE ? ESCAPE '\\'
      ORDER BY p.profile_visible DESC, COALESCE(u.last_call_date, u.first_call_date) DESC, u.username
      LIMIT ? OFFSET ?
    `).all(pattern, pattern, pattern, pattern, boundedLimit(limit), Math.max(0, Number(offset) || 0));
  },
};

const porchPosts = {
  create(authorUserId, { type = 'notice', title, body, expiresAt = null, pinned = false } = {}) {
    const allowedTypes = new Set(['notice', 'event', 'classified', 'help_wanted', 'auto_message']);
    if (!allowedTypes.has(type)) throw new Error('Unsupported porch notice type.');
    const result = db.prepare(`
      INSERT INTO porch_notices (author_user_id, notice_type, title, body, expires_at, pinned)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(authorUserId, type, title, body, expiresAt, pinned ? 1 : 0);
    return this.getById(result.lastInsertRowid);
  },

  list({ type = null, includeInactive = false, limit = 50, offset = 0 } = {}) {
    return db.prepare(`
      SELECT n.*, u.username AS author_username FROM porch_notices n
      JOIN users u ON u.id = n.author_user_id
      WHERE (? IS NULL OR n.notice_type = ?)
        AND (? = 1 OR (n.status = 'active' AND (n.expires_at IS NULL OR n.expires_at > datetime('now'))))
      ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC LIMIT ? OFFSET ?
    `).all(type, type, includeInactive ? 1 : 0, boundedLimit(limit), Math.max(0, Number(offset) || 0));
  },

  getById(id) {
    return db.prepare(`
      SELECT n.*, u.username AS author_username FROM porch_notices n
      JOIN users u ON u.id = n.author_user_id WHERE n.id = ?
    `).get(id);
  },

  moderate(id, { status, pinned } = {}) {
    const current = this.getById(id);
    if (!current) return null;
    db.prepare(`
      UPDATE porch_notices SET status = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?
    `).run(status ?? current.status, pinned === undefined ? current.pinned : (pinned ? 1 : 0), id);
    return this.getById(id);
  },

  remove(id) {
    return db.prepare(`
      UPDATE porch_notices SET status = 'removed', updated_at = datetime('now') WHERE id = ?
    `).run(id).changes > 0;
  },
};

const moderationQueue = {
  create({ targetType, targetId, reason = '', reportedByUserId = null } = {}) {
    const result = db.prepare(`
      INSERT INTO moderation_items (target_type, target_id, reason, reported_by_user_id)
      VALUES (?, ?, ?, ?)
    `).run(targetType, String(targetId), reason, reportedByUserId);
    return db.prepare('SELECT * FROM moderation_items WHERE id = ?').get(result.lastInsertRowid);
  },
  list({ state = 'open', limit = 50 } = {}) {
    return db.prepare(`
      SELECT * FROM moderation_items WHERE (? IS NULL OR state = ?)
      ORDER BY created_at, id LIMIT ?
    `).all(state, state, boundedLimit(limit));
  },
  update(id, { state, assignedToUserId, resolution } = {}) {
    const item = db.prepare('SELECT * FROM moderation_items WHERE id = ?').get(id);
    if (!item) return null;
    db.prepare(`
      UPDATE moderation_items SET state = ?, assigned_to_user_id = ?, resolution = ?,
        updated_at = datetime('now') WHERE id = ?
    `).run(state ?? item.state, assignedToUserId ?? item.assigned_to_user_id,
      resolution ?? item.resolution, id);
    return db.prepare('SELECT * FROM moderation_items WHERE id = ?').get(id);
  },
};

const auditLog = {
  record({ actorUserId = null, action, targetType, targetId = null, details = {} } = {}) {
    const json = JSON.stringify(details);
    if (Buffer.byteLength(json) > 32768) throw new Error('Audit details are too large.');
    return db.prepare(`
      INSERT INTO audit_events (actor_user_id, action, target_type, target_id, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(actorUserId, action, targetType, targetId === null ? null : String(targetId), json).lastInsertRowid;
  },
  list({ action = null, targetType = null, limit = 100 } = {}) {
    return db.prepare(`
      SELECT * FROM audit_events WHERE (? IS NULL OR action = ?) AND (? IS NULL OR target_type = ?)
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(action, action, targetType, targetType, boundedLimit(limit, 100, 500));
  },
};

// Bulletin operations
const bulletins = {
  getActive() {
    return db.prepare('SELECT * FROM bulletins WHERE active = 1 ORDER BY created_at DESC').all();
  },

  getAll() {
    return db.prepare('SELECT * FROM bulletins ORDER BY created_at DESC').all();
  },

  create(title, body, author = 'SysOp') {
    return db.prepare('INSERT INTO bulletins (title, body, author) VALUES (?, ?, ?)').run(title, body, author);
  },

  delete(id) {
    db.prepare('DELETE FROM bulletins WHERE id = ?').run(id);
  },

  toggle(id) {
    db.prepare('UPDATE bulletins SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  }
};

// Call log operations
const callLog = {
  logLogin(userId, username, nodeNum) {
    return db.prepare(`
      INSERT INTO call_log (user_id, username, node_num) VALUES (?, ?, ?)
    `).run(userId, username, nodeNum).lastInsertRowid;
  },

  logLogout(logId) {
    db.prepare(`UPDATE call_log SET logout_time = datetime('now') WHERE id = ?`).run(logId);
  },

  getRecent(limit = 20) {
    return db.prepare('SELECT * FROM call_log ORDER BY login_time DESC, id DESC LIMIT ?').all(limit);
  },

  getPrevious(currentLogId) {
    return db.prepare(`
      SELECT * FROM call_log
      WHERE id <> ?
      ORDER BY login_time DESC, id DESC
      LIMIT 1
    `).get(currentLogId) || null;
  },

  countToday() {
    return db.prepare(`
      SELECT COUNT(*) AS count FROM call_log
      WHERE date(login_time, 'localtime') = date('now', 'localtime')
    `).get().count;
  },

  countSince(timestamp, excludeUserId = null) {
    if (!timestamp) return 0;
    return db.prepare(`
      SELECT COUNT(*) AS count FROM call_log
      WHERE login_time > ? AND (? IS NULL OR user_id <> ?)
    `).get(timestamp, excludeUserId, excludeUserId).count;
  }
};

// File operations
const files = {
  getByArea(areaId) {
    return db.prepare('SELECT * FROM files WHERE area_id = ? ORDER BY created_at DESC').all(areaId);
  },

  create(areaId, filename, description, size, uploadedBy) {
    return db.prepare(`
      INSERT INTO files (area_id, filename, description, size, uploaded_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(areaId, filename, description, size, uploadedBy);
  },

  incrementDownloads(id) {
    db.prepare('UPDATE files SET download_count = download_count + 1 WHERE id = ?').run(id);
  },

  getTotal() {
    return db.prepare('SELECT COUNT(*) as count FROM files').get().count;
  },

  countSince(timestamp) {
    if (!timestamp) return 0;
    return db.prepare('SELECT COUNT(*) AS count FROM files WHERE created_at > ?').get(timestamp).count;
  }
};

// Graffiti wall operations
const graffiti = {
  getRecent(limit = 20) {
    return db.prepare('SELECT * FROM graffiti ORDER BY created_at DESC LIMIT ?').all(limit);
  },

  add(username, message) {
    return db.prepare('INSERT INTO graffiti (username, message) VALUES (?, ?)').run(username, message);
  },
};

// Private mail operations
const privateMail = {
  getInbox(username, limit = 1000) {
    return db.prepare('SELECT * FROM private_mail WHERE to_user = ? COLLATE NOCASE ORDER BY created_at DESC LIMIT ?')
      .all(username, boundedLimit(limit, 1000, 1000));
  },

  getSent(username) {
    return db.prepare('SELECT * FROM private_mail WHERE from_user = ? COLLATE NOCASE ORDER BY created_at DESC').all(username);
  },

  getById(id) {
    return db.prepare('SELECT * FROM private_mail WHERE id = ?').get(id);
  },

  send(fromUser, toUser, subject, body, options = {}) {
    const kind = options.kind === 'telegram' ? 'telegram' : 'mail';
    return db.prepare(`
      INSERT INTO private_mail (from_user, to_user, subject, body, kind, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fromUser, toUser, subject, body, kind, options.expiresAt || null);
  },

  sendTelegram(fromUser, toUser, body, options = {}) {
    return this.send(fromUser, toUser, options.subject || 'Telegram', body, {
      kind: 'telegram', expiresAt: options.expiresAt || null,
    });
  },

  markRead(id) {
    db.prepare('UPDATE private_mail SET read = 1 WHERE id = ?').run(id);
  },

  delete(id) {
    db.prepare('DELETE FROM private_mail WHERE id = ?').run(id);
  },

  countUnread(username) {
    return db.prepare('SELECT COUNT(*) as count FROM private_mail WHERE to_user = ? COLLATE NOCASE AND read = 0').get(username).count;
  },
};

// Poll operations
const polls = {
  getActive() {
    return db.prepare('SELECT * FROM polls WHERE active = 1 ORDER BY created_at DESC').all();
  },

  getAll() {
    return db.prepare('SELECT * FROM polls ORDER BY created_at DESC').all();
  },

  getById(id) {
    return db.prepare('SELECT * FROM polls WHERE id = ?').get(id);
  },

  getOptions(pollId) {
    return db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sort_order').all(pollId);
  },

  getResults(pollId) {
    return db.prepare(`
      SELECT po.id, po.option_text, COUNT(pv.id) as votes
      FROM poll_options po
      LEFT JOIN poll_votes pv ON po.id = pv.option_id
      WHERE po.poll_id = ?
      GROUP BY po.id
      ORDER BY po.sort_order
    `).all(pollId);
  },

  hasVoted(pollId, userId) {
    return !!db.prepare('SELECT id FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(pollId, userId);
  },

  vote(pollId, optionId, userId) {
    return db.prepare('INSERT OR IGNORE INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)').run(pollId, optionId, userId);
  },

  getTotalVotes(pollId) {
    return db.prepare('SELECT COUNT(*) as count FROM poll_votes WHERE poll_id = ?').get(pollId).count;
  },

  create(question, options, author = 'SysOp') {
    const result = db.prepare('INSERT INTO polls (question, author) VALUES (?, ?)').run(question, author);
    const pollId = result.lastInsertRowid;
    for (let i = 0; i < options.length; i++) {
      db.prepare('INSERT INTO poll_options (poll_id, option_text, sort_order) VALUES (?, ?, ?)').run(pollId, options[i], i);
    }
    return pollId;
  },

  toggle(id) {
    db.prepare('UPDATE polls SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  },

  delete(id) {
    db.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(id);
    db.prepare('DELETE FROM poll_options WHERE poll_id = ?').run(id);
    db.prepare('DELETE FROM polls WHERE id = ?').run(id);
  },
};

// MOTD operations
const motd = {
  getActive() {
    return db.prepare('SELECT * FROM motd WHERE active = 1 ORDER BY created_at DESC LIMIT 1').get();
  },

  getAll() {
    return db.prepare('SELECT * FROM motd ORDER BY created_at DESC').all();
  },

  create(body, author = 'SysOp') {
    return db.prepare('INSERT INTO motd (body, author) VALUES (?, ?)').run(body, author);
  },

  toggle(id) {
    db.prepare('UPDATE motd SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  },

  delete(id) {
    db.prepare('DELETE FROM motd WHERE id = ?').run(id);
  },
};

// Dungeon operations
const dungeon = {
  getPlayer(userId) {
    return db.prepare('SELECT * FROM dungeon_players WHERE user_id = ?').get(userId);
  },

  createPlayer(userId) {
    db.prepare(`
      INSERT OR IGNORE INTO dungeon_players (user_id) VALUES (?)
    `).run(userId);
    return this.getPlayer(userId);
  },

  savePlayer(userId, data) {
    const inventory = typeof data.inventory === 'string' ? data.inventory : JSON.stringify(data.inventory || []);
    db.prepare(`
      UPDATE dungeon_players SET
        hp = ?, max_hp = ?, level = ?, xp = ?, gold = ?,
        attack = ?, defense = ?, room = ?, inventory = ?,
        status = ?, turns_played = ?, monsters_slain = ?,
        deepest_floor = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).run(
      data.hp, data.max_hp, data.level, data.xp, data.gold,
      data.attack, data.defense, data.room, inventory,
      data.status, data.turns_played, data.monsters_slain,
      data.deepest_floor, userId
    );
  },

  deletePlayer(userId) {
    db.prepare('DELETE FROM dungeon_players WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM dungeon_history WHERE user_id = ?').run(userId);
  },

  getHistory(userId, limit = 20) {
    return db.prepare(
      'SELECT role, content FROM dungeon_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit).reverse();
  },

  addHistory(userId, role, content) {
    db.prepare(
      'INSERT INTO dungeon_history (user_id, role, content) VALUES (?, ?, ?)'
    ).run(userId, role, content);
    // Keep only last 40 messages to manage context window
    db.prepare(`
      DELETE FROM dungeon_history WHERE user_id = ? AND id NOT IN (
        SELECT id FROM dungeon_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 40
      )
    `).run(userId, userId);
  },

  getLeaderboard(limit = 10) {
    return db.prepare(`
      SELECT dp.*, u.username FROM dungeon_players dp
      JOIN users u ON dp.user_id = u.id
      WHERE dp.status != 'dead'
      ORDER BY dp.level DESC, dp.xp DESC, dp.monsters_slain DESC
      LIMIT ?
    `).all(limit);
  }
};

function boundedJson(value, maximumBytes = 65536) {
  const json = JSON.stringify(value ?? {});
  if (Buffer.byteLength(json) > maximumBytes) throw new Error('Stored state is too large.');
  return json;
}

const doors = {
  getSave(userId, doorId) {
    const row = db.prepare('SELECT * FROM door_saves WHERE user_id = ? AND door_key = ?')
      .get(userId, String(doorId));
    if (!row) return null;
    return { ...row, state: JSON.parse(row.state_json) };
  },

  save(userId, doorId, state, version = 1) {
    db.prepare(`
      INSERT INTO door_saves (user_id, door_key, state_json, version)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, door_key) DO UPDATE SET
        state_json = excluded.state_json, version = excluded.version, updated_at = datetime('now')
    `).run(userId, String(doorId), boundedJson(state), Math.max(1, Number(version) || 1));
    return this.getSave(userId, doorId);
  },

  beginRun(userId, doorId, dailyLimit = 1) {
    const limit = Math.max(1, Math.min(Number(dailyLimit) || 1, 10000));
    const key = String(doorId);
    return db.transaction(() => {
      const date = db.prepare("SELECT date('now') AS date").get().date;
      db.prepare(`
        INSERT OR IGNORE INTO door_usage (user_id, door_key, usage_date) VALUES (?, ?, ?)
      `).run(userId, key, date);
      const usage = db.prepare(`
        SELECT turns_used FROM door_usage WHERE user_id = ? AND door_key = ? AND usage_date = ?
      `).get(userId, key, date);
      if (usage.turns_used >= limit) return { allowed: false, remaining: 0, runId: null };
      db.prepare(`
        UPDATE door_usage SET turns_used = turns_used + 1, updated_at = datetime('now')
        WHERE user_id = ? AND door_key = ? AND usage_date = ?
      `).run(userId, key, date);
      const season = db.prepare(`
        SELECT id FROM door_seasons WHERE door_key = ? AND state = 'active'
          AND starts_at <= datetime('now') AND ends_at > datetime('now')
        ORDER BY starts_at DESC LIMIT 1
      `).get(key);
      const runId = db.prepare(`
        INSERT INTO door_runs (user_id, door_key, season_id) VALUES (?, ?, ?)
      `).run(userId, key, season ? season.id : null).lastInsertRowid;
      return { allowed: true, remaining: limit - usage.turns_used - 1, runId };
    })();
  },

  finishRun(runId, score, result = {}) {
    const json = boundedJson(result, 32768);
    const changes = db.prepare(`
      UPDATE door_runs SET score = ?, result_json = ?, completed_at = datetime('now')
      WHERE id = ? AND completed_at IS NULL
    `).run(Number(score) || 0, json, runId).changes;
    return changes ? db.prepare('SELECT * FROM door_runs WHERE id = ?').get(runId) : null;
  },

  getLeaderboard(doorId, limit = 10, period = 'all') {
    const since = period === 'day' ? "datetime('now', '-1 day')"
      : period === 'week' ? "datetime('now', '-7 days')"
        : period === 'month' ? "datetime('now', '-1 month')" : null;
    return db.prepare(`
      SELECT r.user_id, u.username, MAX(r.score) AS score, COUNT(*) AS runs
      FROM door_runs r JOIN users u ON u.id = r.user_id
      WHERE r.door_key = ? AND r.completed_at IS NOT NULL
        ${since ? `AND r.completed_at >= ${since}` : ''}
      GROUP BY r.user_id, u.username ORDER BY score DESC, r.completed_at ASC LIMIT ?
    `).all(String(doorId), boundedLimit(limit, 10, 100));
  },

  createSeason(doorId, { name, startsAt, endsAt, state = 'scheduled', rules = {} }) {
    const result = db.prepare(`
      INSERT INTO door_seasons (door_key, name, starts_at, ends_at, state, rules_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(doorId), name, startsAt, endsAt, state, boundedJson(rules, 32768));
    return db.prepare('SELECT * FROM door_seasons WHERE id = ?').get(result.lastInsertRowid);
  },
};

const transfers = {
  create(userId, purpose, tokenHash, filename, mime, size, expiresAt) {
    const result = db.prepare(`
      INSERT INTO file_transfers
        (user_id, purpose, token_hash, filename, mime_type, size, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, purpose, tokenHash, filename, mime || 'application/octet-stream',
      Math.max(0, Number(size) || 0), expiresAt);
    return db.prepare('SELECT * FROM file_transfers WHERE id = ?').get(result.lastInsertRowid);
  },
  get(tokenHash, purpose) {
    return db.prepare(`
      SELECT * FROM file_transfers WHERE token_hash = ? AND purpose = ?
        AND consumed_at IS NULL AND expires_at > datetime('now')
    `).get(tokenHash, purpose) || null;
  },
  countActive(userId, purpose) {
    return db.prepare(`
      SELECT COUNT(*) AS count FROM file_transfers
      WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > datetime('now')
    `).get(userId, purpose).count;
  },
  countRecent(userId, purposePrefix, minutes = 15) {
    const windowMinutes = Math.max(1, Math.min(Number(minutes) || 15, 1440));
    return db.prepare(`
      SELECT COUNT(*) AS count FROM file_transfers
      WHERE user_id = ? AND purpose LIKE ? AND created_at >= datetime('now', ?)
    `).get(userId, `${purposePrefix}%`, `-${windowMinutes} minutes`).count;
  },
  consume(tokenHash, purpose) {
    return db.transaction(() => {
      const row = db.prepare(`
        SELECT * FROM file_transfers WHERE token_hash = ? AND purpose = ?
          AND consumed_at IS NULL AND expires_at > datetime('now')
      `).get(tokenHash, purpose);
      if (!row) return null;
      const changed = db.prepare(`
        UPDATE file_transfers SET consumed_at = datetime('now')
        WHERE id = ? AND consumed_at IS NULL
      `).run(row.id).changes;
      return changed ? { ...row, consumed_at: db.prepare("SELECT datetime('now') AS now").get().now } : null;
    })();
  },
  revokeExpired() {
    return db.prepare(`
      UPDATE file_transfers SET consumed_at = COALESCE(consumed_at, datetime('now'))
      WHERE consumed_at IS NULL AND expires_at <= datetime('now')
    `).run().changes;
  },
  pruneStale(days = 7) {
    const keepDays = Math.max(1, Math.min(Number(days) || 7, 90));
    return db.prepare(`
      DELETE FROM file_transfers
      WHERE (consumed_at IS NOT NULL AND consumed_at < datetime('now', ?))
         OR expires_at < datetime('now', ?)
    `).run(`-${keepDays} days`, `-${keepDays} days`).changes;
  },
};

const offlinePackets = {
  create({ id = crypto.randomUUID(), userId, format = 'briefcase', direction = 'export',
    state = 'created', contentHash = null, messageCount = 0, metadata = {} } = {}) {
    db.prepare(`
      INSERT INTO offline_packets
        (id, user_id, format, direction, state, content_hash, message_count, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, format, direction, state, contentHash, messageCount, boundedJson(metadata, 32768));
    return this.get(id, userId);
  },
  get(id, userId = null) {
    return db.prepare('SELECT * FROM offline_packets WHERE id = ? AND (? IS NULL OR user_id = ?)')
      .get(id, userId, userId);
  },
  list(userId, limit = 20) {
    return db.prepare(`SELECT * FROM offline_packets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(userId, boundedLimit(limit, 20, 100));
  },
  findImportedHash(userId, contentHash) {
    return db.prepare(`
      SELECT * FROM offline_packets
      WHERE user_id = ? AND direction = 'import' AND content_hash = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(userId, contentHash) || null;
  },
  findByTransferId(userId, transferId) {
    const row = db.prepare(`
      SELECT * FROM offline_packets
      WHERE user_id = ? AND json_extract(metadata_json, '$.transferId') = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(userId, Number(transferId));
    if (!row) return null;
    return { ...row, metadata: JSON.parse(row.metadata_json) };
  },
  markConsumed(id, userId) {
    return db.prepare(`
      UPDATE offline_packets SET state = 'consumed', consumed_at = datetime('now')
      WHERE id = ? AND user_id = ? AND consumed_at IS NULL
    `).run(id, userId).changes > 0;
  },
  issueToken(packetId, userId, purpose, tokenHash, expiresAt) {
    db.prepare(`
      INSERT INTO offline_packet_tokens (token_hash, packet_id, user_id, purpose, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenHash, packetId, userId, purpose, expiresAt);
    return { packetId, userId, purpose, expiresAt };
  },
  consumeToken(tokenHash, purpose) {
    return db.transaction(() => {
      const token = db.prepare(`
        SELECT * FROM offline_packet_tokens WHERE token_hash = ? AND purpose = ?
          AND consumed_at IS NULL AND expires_at > datetime('now')
      `).get(tokenHash, purpose);
      if (!token) return null;
      const changed = db.prepare(`
        UPDATE offline_packet_tokens SET consumed_at = datetime('now')
        WHERE token_hash = ? AND consumed_at IS NULL
      `).run(tokenHash).changes;
      return changed ? token : null;
    })();
  },
  importReplies({ userId, username, format, contentHash, replies, metadata = {} } = {}) {
    return db.transaction(() => {
      const packet = this.create({
        userId, format, direction: 'import', contentHash,
        messageCount: replies.length, metadata,
      });
      for (const reply of replies) {
        messages.create(reply.baseId, username, 'All', reply.subject, reply.body, reply.replyTo ?? null);
      }
      if (replies.length > 0) {
        db.prepare('UPDATE users SET total_posts = total_posts + ? WHERE id = ?')
          .run(replies.length, userId);
      }
      this.markConsumed(packet.id, userId);
      return { packet: this.get(packet.id, userId), imported: replies.length };
    })();
  },
};

module.exports = {
  init,
  close,
  healthCheck,
  users,
  messages,
  readerSubscriptions,
  readerPreferences,
  messageDrafts,
  communityProfiles,
  porchPosts,
  moderationQueue,
  auditLog,
  bulletins,
  callLog,
  files,
  graffiti,
  privateMail,
  polls,
  motd,
  dungeon,
  doors,
  transfers,
  offlinePackets,
  hashPassword,
  verifyPassword,
  resolveBootstrapSysopPassword,
  resolveDatabasePath,
};
