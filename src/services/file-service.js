'use strict';

// File library transfers: uploads land in quarantine, an operator publishes
// them into content-addressed storage, and downloads use one-use tokens.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { canWrite, canAccessFileArea } = require('../core/caller-access');

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const TRANSFER_TTL_MS = 30 * 60 * 1000;
const MAX_ACTIVE_TRANSFERS = 3;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function expiry() {
  return new Date(Date.now() + TRANSFER_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');
}

class FileService {
  constructor({ database, config, root }) {
    this.db = database;
    this.config = config;
    this.root = path.resolve(root);
    this.quarantineDir = path.join(this.root, '.quarantine');
    this.libraryDir = path.join(this.root, '.library');
    fs.mkdirSync(this.quarantineDir, { recursive: true });
    fs.mkdirSync(this.libraryDir, { recursive: true });
  }

  hasAreaAccess(user, areaId) {
    const area = this.config.fileAreas.find(area => area.id === areaId);
    return canAccessFileArea(user, area, this.config);
  }

  createUpload(user, { areaId, filename }) {
    const current = this.db.users.getById(user.id);
    if (!canWrite(current) || !this.hasAreaAccess(current, areaId)) {
      throw new Error('Uploads require an active account with access to this area.');
    }
    const purpose = `file-upload:${Number(areaId)}`;
    if (this.db.transfers.countActive(user.id, purpose) >= MAX_ACTIVE_TRANSFERS) {
      throw new Error('Too many active uploads. Use or let an earlier link expire.');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const safeName = String(filename || 'upload.bin').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'upload.bin';
    this.db.transfers.create(user.id, purpose, hashToken(token), safeName,
      'application/octet-stream', MAX_UPLOAD_BYTES, expiry());
    return { token, filename: safeName, maxBytes: MAX_UPLOAD_BYTES, areaId: Number(areaId) };
  }

  consumeUpload(token, areaId, content) {
    if (!Buffer.isBuffer(content) || content.length === 0) throw new Error('Empty upload.');
    if (content.length > MAX_UPLOAD_BYTES) throw new Error('Upload too large.');
    const purpose = `file-upload:${Number(areaId)}`;
    const tokenHash = hashToken(token);
    const row = this.db.transfers.get(tokenHash, purpose);
    if (!row) return null;
    const current = this.db.users.getById(row.user_id);
    if (!canWrite(current) || !this.hasAreaAccess(current, areaId)) return null;

    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    const target = path.join(this.quarantineDir, sha256);
    fs.writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
    const file = this.db.fileLibrary.createQuarantined({
      areaId: Number(areaId),
      filename: row.filename,
      size: content.length,
      uploadedBy: row.user_id,
      sha256,
      storageKey: path.relative(this.root, target),
    });
    this.db.transfers.consume(tokenHash, purpose);
    return { file };
  }

  approve(fileId) {
    const file = this.db.fileLibrary.get(fileId);
    if (!file || file.state !== 'quarantined') return null;
    const source = path.join(this.quarantineDir, file.sha256);
    if (!fs.existsSync(source)) return null;
    const dir = path.join(this.libraryDir, file.sha256.slice(0, 2));
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, file.sha256);
    fs.renameSync(source, target);
    this.db.fileLibrary.publish(fileId, { storageKey: path.relative(this.root, target), sha256: file.sha256 });
    return this.db.fileLibrary.get(fileId);
  }

  reject(fileId) {
    const file = this.db.fileLibrary.get(fileId);
    if (!file || file.state !== 'quarantined') return null;
    fs.rmSync(path.join(this.quarantineDir, file.sha256), { force: true });
    this.db.fileLibrary.reject(fileId);
    return this.db.fileLibrary.get(fileId);
  }

  createDownload(user, fileId, selectedAreaId) {
    const file = this.db.fileLibrary.get(fileId);
    const current = this.db.users.getById(user.id);
    if (!file || file.state !== 'published' || file.area_id !== selectedAreaId ||
        !this.hasAreaAccess(current, file.area_id)) return null;
    const purpose = `file-download:${Number(fileId)}`;
    const token = crypto.randomBytes(32).toString('base64url');
    this.db.transfers.create(user.id, purpose, hashToken(token), file.filename,
      file.mime || 'application/octet-stream', file.size, expiry());
    return { token, filename: file.filename, fileId: Number(fileId) };
  }

  consumeDownload(token, fileId) {
    const purpose = `file-download:${Number(fileId)}`;
    const tokenHash = hashToken(token);
    const row = this.db.transfers.get(tokenHash, purpose);
    if (!row) return null;
    const file = this.db.fileLibrary.get(fileId);
    if (!file || file.state !== 'published' ||
        !this.hasAreaAccess(this.db.users.getById(row.user_id), file.area_id)) return null;
    const full = path.join(this.root, file.storage_key);
    if (!fs.existsSync(full)) return null;
    if (!this.db.transfers.consume(tokenHash, purpose)) return null;
    this.db.fileLibrary.incrementDownload(fileId);
    return { path: full, filename: file.filename, mime: file.mime || 'application/octet-stream', size: file.size };
  }
}

module.exports = { FileService, MAX_UPLOAD_BYTES, hashToken };
