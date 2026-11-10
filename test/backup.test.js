'use strict';

// The backup job writes a verifiable copy and a checksum manifest.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-backup-'));
const dbPath = path.join(dir, 'nodehouse.db');
process.env.NODEHOUSE_DB_PATH = dbPath;
process.env.NODE_ENV = 'test';

const database = require('../src/core/database');
const { runBackup } = require('../scripts/backup');

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a backup verifies, carries a manifest, and is usable', () => {
  const db = database.init();
  database.users.create('BackupCaller', 'long-enough-password');
  db.close();

  const result = runBackup({ dbPath, backupDir: path.join(dir, 'backups') });
  assert.ok(fs.existsSync(result.target));
  assert.ok(result.size > 0);
  assert.match(fs.readFileSync(`${result.target}.sha256`, 'utf8'), /^[0-9a-f]{64} {2}nodehouse-/);

  const copy = new Database(result.target, { readonly: true });
  try {
    assert.equal(Object.values(copy.prepare('PRAGMA integrity_check').get())[0], 'ok');
    assert.ok(copy.prepare('SELECT id FROM users WHERE username = ?').get('BackupCaller'));
  } finally {
    copy.close();
  }
});
