'use strict';

// Online SQLite backup: VACUUM INTO a timestamped file, verify it, write a
// SHA-256 manifest, and keep the most recent seven.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.join(__dirname, '..');
const KEEP = 7;

function resolveDbPath(explicit) {
  if (explicit) return path.resolve(PROJECT_ROOT, explicit);
  if (process.env.NODEHOUSE_DB_PATH) return path.resolve(PROJECT_ROOT, process.env.NODEHOUSE_DB_PATH);
  return path.join(PROJECT_ROOT, 'data', 'nodehouse.db');
}

function resolveBackupDir(explicit) {
  if (explicit) return path.resolve(PROJECT_ROOT, explicit);
  if (process.env.NODEHOUSE_BACKUP_DIR) return path.resolve(PROJECT_ROOT, process.env.NODEHOUSE_BACKUP_DIR);
  return path.join(PROJECT_ROOT, 'data', 'backups');
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
}

function runBackup({ dbPath, backupDir } = {}) {
  const source = resolveDbPath(dbPath);
  const targetDir = resolveBackupDir(backupDir);
  if (!fs.existsSync(source)) throw new Error(`Database not found: ${source}`);
  fs.mkdirSync(targetDir, { recursive: true });

  const target = path.join(targetDir, `nodehouse-${stamp()}.sqlite`);
  const db = new Database(source);
  try {
    const check = db.prepare('PRAGMA integrity_check').get();
    const result = Object.values(check)[0];
    if (result !== 'ok') throw new Error(`Integrity check failed: ${result}`);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  fs.writeFileSync(`${target}.sha256`, `${hash}  ${path.basename(target)}\n`);

  const backups = fs.readdirSync(targetDir)
    .filter((name) => /^nodehouse-.*\.sqlite$/.test(name))
    .sort();
  while (backups.length > KEEP) {
    const old = backups.shift();
    fs.rmSync(path.join(targetDir, old), { force: true });
    fs.rmSync(path.join(targetDir, `${old}.sha256`), { force: true });
  }

  return { target, hash, size: fs.statSync(target).size };
}

if (require.main === module) {
  try {
    const result = runBackup();
    console.log(`Backup written: ${result.target}`);
    console.log(`SHA-256: ${result.hash}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { runBackup };
