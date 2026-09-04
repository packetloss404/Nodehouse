'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../core/database');
const { exportBriefcase, importBriefcase } = require('../packets/briefcase');
const { exportQwk, importRep } = require('../packets/qwk');

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const TOKEN_TTL_MINUTES = 15;
const MAX_ACTIVE_TRANSFERS = 2;
const MAX_EXPORTS_PER_WINDOW = 6;
const EXPORT_WINDOW_MINUTES = 15;
const MAX_PACKET_PAYLOAD_BYTES = 3 * 1024 * 1024;

function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function expiry(minutes = TOKEN_TTL_MINUTES) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

function withinBudget(rows, maximumBytes) {
  const output = [];
  let used = 0;
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (size > maximumBytes - used) break;
    output.push(row);
    used += size;
  }
  return output;
}

class PacketService {
  constructor({ database = db, config, transferDir = path.join(__dirname, '..', '..', 'data', 'transfers') }) {
    if (!config?.messageBases) throw new Error('PacketService requires BBS configuration.');
    this.db = database;
    this.config = config;
    this.transferDir = path.resolve(transferDir);
    fs.mkdirSync(this.transferDir, { recursive: true });
  }

  accessibleBases(user) {
    return this.config.messageBases.filter(base => Number(base.accessLevel || 0) <= Number(user.access_level || 0));
  }

  packetData(user) {
    const accessible = this.accessibleBases(user);
    const subscriptions = this.db.readerSubscriptions?.ensure
      ? this.db.readerSubscriptions.ensure(user.id, accessible.map(base => base.id))
      : accessible.map((base, index) => ({ base_id: Number(base.id), subscribed: true, sort_order: index }));
    const subscribedIds = new Set(subscriptions.filter(item => item.subscribed).map(item => item.base_id));
    const bases = accessible.filter(base => subscribedIds.has(Number(base.id)));
    return {
      bbs: this.config.bbsName,
      user: user.username,
      conferences: bases,
      messages: withinBudget(this.db.messages.getUnreadByBases(bases.map(base => base.id), user.id, 100),
        MAX_PACKET_PAYLOAD_BYTES * 0.7),
      mail: withinBudget(this.db.privateMail.getInbox(user.username, 100), MAX_PACKET_PAYLOAD_BYTES * 0.2),
      bulletins: withinBudget(this.db.bulletins.getActive().slice(0, 50), MAX_PACKET_PAYLOAD_BYTES * 0.1),
    };
  }

  createExport(user, format = 'briefcase') {
    const purpose = `packet-download:${format}`;
    if (this.db.transfers.countRecent?.(user.id, 'packet-download:', EXPORT_WINDOW_MINUTES) >= MAX_EXPORTS_PER_WINDOW) {
      throw new Error(`Packet generation limit reached. Try again in ${EXPORT_WINDOW_MINUTES} minutes.`);
    }
    if (this.db.transfers.countActive?.(user.id, purpose) >= MAX_ACTIVE_TRANSFERS) {
      throw new Error('Too many active packet downloads. Use or let an earlier link expire.');
    }
    const payload = this.packetData(user);
    let content;
    let filename;
    if (format === 'briefcase') {
      content = exportBriefcase(payload);
      filename = `NODEHOUSE-${user.username}.zip`;
    } else if (format === 'qwk') {
      content = exportQwk({
        bbs: this.config.bbsName, sysop: this.config.sysopName, user: user.username,
        conferences: payload.conferences, messages: payload.messages,
      });
      filename = 'NODEHOUS.QWK';
    } else {
      throw new Error('Unsupported packet format.');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const stagingPath = path.join(this.transferDir, `.staging-${crypto.randomUUID()}.packet`);
    let transfer = null;
    try {
      fs.writeFileSync(stagingPath, content, { flag: 'wx', mode: 0o600 });
      transfer = this.db.transfers.create(
        user.id, purpose, tokenHash, filename, 'application/zip', content.length, expiry()
      );
      fs.renameSync(stagingPath, this.transferPath(transfer.id));
      this.db.offlinePackets.create({
        userId: user.id, format, direction: 'export', contentHash: crypto.createHash('sha256').update(content).digest('hex'),
        messageCount: payload.messages.length,
        metadata: { transferId: transfer.id, filename, messageIds: payload.messages.map(message => message.id) },
      });
    } catch (error) {
      fs.rmSync(stagingPath, { force: true });
      if (transfer) {
        this.db.transfers.consume(tokenHash, purpose);
        fs.rmSync(this.transferPath(transfer.id), { force: true });
      }
      throw error;
    }
    return { token, filename, size: content.length, messageCount: payload.messages.length, expiresAt: transfer.expires_at };
  }

  createImport(user, format = 'briefcase') {
    if (!['briefcase', 'rep'].includes(format)) throw new Error('Unsupported packet import format.');
    const purpose = `packet-upload:${format}`;
    if (this.db.transfers.countActive?.(user.id, purpose) >= MAX_ACTIVE_TRANSFERS) {
      throw new Error('Too many active packet uploads. Use or let an earlier link expire.');
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const filename = format === 'rep' ? 'REPLIES.REP' : 'NODEHOUSE-REPLIES.zip';
    const transfer = this.db.transfers.create(
      user.id, purpose, hashToken(token), filename, 'application/zip', MAX_UPLOAD_BYTES, expiry()
    );
    return { token, filename, maxBytes: MAX_UPLOAD_BYTES, expiresAt: transfer.expires_at };
  }

  consumeDownload(token, format) {
    const tokenHash = hashToken(String(token));
    const purpose = `packet-download:${format}`;
    const candidate = this.db.transfers.get(tokenHash, purpose);
    if (!candidate) return null;
    const filename = this.transferPath(candidate.id);
    const content = fs.readFileSync(filename);
    if (content.length !== candidate.size) throw new Error('Packet transfer is corrupt.');
    const transfer = this.db.transfers.consume(tokenHash, purpose);
    if (!transfer) return null;
    fs.rmSync(filename, { force: true });
    const packet = this.db.offlinePackets.findByTransferId?.(transfer.user_id, transfer.id);
    let completed = false;
    const complete = () => {
      if (completed) return;
      completed = true;
      if (packet) {
        for (const messageId of packet.metadata?.messageIds || []) this.db.messages.markRead(messageId, transfer.user_id);
        this.db.offlinePackets.markConsumed(packet.id, transfer.user_id);
      }
    };
    return { content, filename: transfer.filename, mime: transfer.mime_type, complete };
  }

  consumeUpload(token, format, content) {
    if (!Buffer.isBuffer(content) || content.length === 0 || content.length > MAX_UPLOAD_BYTES) throw new Error('Packet upload is empty or too large.');
    const tokenHash = hashToken(String(token));
    const purpose = `packet-upload:${format}`;
    const candidate = this.db.transfers.get(tokenHash, purpose);
    if (!candidate) return null;
    const user = this.db.users.getById(candidate.user_id);
    if (!user) throw new Error('Packet owner no longer exists.');
    const bases = this.accessibleBases(user);
    const byNumber = new Map(bases.map(base => [Number(base.id), Number(base.id)]));
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    if (this.db.offlinePackets.findImportedHash(user.id, contentHash)) throw new Error('This reply packet was already imported.');
    const replies = format === 'briefcase' ? importBriefcase(content) : importRep(content, byNumber);
    const allowed = new Set(bases.map(base => Number(base.id)));
    for (const reply of replies) {
      if (!allowed.has(Number(reply.baseId))) throw new Error('Packet reply targets an inaccessible conference.');
      if (reply.replyTo) {
        const parent = this.db.messages.getById(reply.replyTo);
        if (!parent || Number(parent.base_id) !== Number(reply.baseId)) throw new Error('Packet reply has an invalid parent.');
      }
    }
    const transfer = this.db.transfers.consume(tokenHash, purpose);
    if (!transfer) return null;
    const imported = this.db.offlinePackets.importReplies({
      userId: user.id, username: user.username, format, contentHash, replies,
      metadata: { transferId: transfer.id },
    });
    return { imported: imported.imported, user: user.username };
  }

  transferPath(id) {
    if (!Number.isSafeInteger(Number(id)) || Number(id) < 1) throw new Error('Invalid transfer id.');
    return path.join(this.transferDir, `${Number(id)}.packet`);
  }

  cleanup() {
    const revoked = this.db.transfers.revokeExpired();
    const pruned = this.db.transfers.pruneStale?.(7) || 0;
    // Orphan files contain numeric database ids only; age is the safe cleanup key.
    const cutoff = Date.now() - (TOKEN_TTL_MINUTES + 5) * 60 * 1000;
    for (const entry of fs.readdirSync(this.transferDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^(?:\d+\.packet|\.staging-[0-9a-f-]+\.packet)$/i.test(entry.name)) continue;
      const target = path.join(this.transferDir, entry.name);
      if (fs.statSync(target).mtimeMs < cutoff) fs.rmSync(target, { force: true });
    }
    return { revoked, pruned };
  }
}

module.exports = { PacketService, hashToken, MAX_UPLOAD_BYTES, TOKEN_TTL_MINUTES,
  MAX_ACTIVE_TRANSFERS, MAX_EXPORTS_PER_WINDOW, EXPORT_WINDOW_MINUTES, MAX_PACKET_PAYLOAD_BYTES };
