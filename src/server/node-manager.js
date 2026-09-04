'use strict';

// Multi-node presence, paging, and private-chat coordination for The Nodehouse.
const crypto = require('crypto');

const PRESENCE_STATES = new Set(['available', 'away', 'busy', 'dnd']);

function boundedLine(value, max = 240) {
  return String(value || '').replace(/\0/g, '')
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '')
    .replace(/[\r\n]+/g, ' ').replace(/[^\x09\x20-\x7e\x80-\uffff]/g, '')
    .trim().slice(0, max);
}

function wrapLine(value, width = 68) {
  const text = boundedLine(value, 500);
  const lines = [];
  let rest = text;
  while (rest.length > width) {
    let split = rest.lastIndexOf(' ', width);
    if (split < 1) split = width;
    lines.push(rest.slice(0, split));
    rest = rest.slice(split).trimStart();
  }
  if (rest) lines.push(rest);
  return lines;
}

class NodeManager {
  constructor(maxNodes, options = {}) {
    this.maxNodes = maxNodes;
    this.nodes = new Map();
    this.invitations = new Map();
    this.chats = new Map();
    this.lastPageAt = new Map();
    this.lastTelegramAt = new Map();
    this.pageTtlMs = options.pageTtlMs || 60 * 1000;
    this.pageCooldownMs = options.pageCooldownMs || 15 * 1000;
    this.telegramCooldownMs = options.telegramCooldownMs || 5 * 1000;
    this.telegramGlobalCooldownMs = options.telegramGlobalCooldownMs || 1000;
    this.maxPendingPages = options.maxPendingPages || 5;
    this.now = options.now || (() => Date.now());
    this.sendTelegram = options.sendTelegram || null;
  }

  allocateNode(session) {
    for (let i = 1; i <= this.maxNodes; i++) {
      if (!this.nodes.has(i)) {
        this.nodes.set(i, { session, username: null, activity: 'Logging in', presence: 'available',
          statusMessage: '', connectedAt: new Date(this.now()), privateChatId: null });
        return i;
      }
    }
    return null;
  }

  releaseNode(nodeNum) {
    const node = this.nodes.get(nodeNum);
    if (!node) return false;
    this._expireInvitations();
    for (const [id, invite] of this.invitations) {
      if (invite.fromNode === nodeNum || invite.toNode === nodeNum) this.invitations.delete(id);
    }
    if (node.privateChatId) this.leavePrivateChat(nodeNum, 'The other caller disconnected.');
    this.lastPageAt.delete(nodeNum);
    this.nodes.delete(nodeNum);
    return true;
  }

  setUsername(nodeNum, username) {
    const node = this.nodes.get(nodeNum);
    if (node) node.username = boundedLine(username, 40) || null;
  }

  setActivity(nodeNum, activity) {
    const node = this.nodes.get(nodeNum);
    if (node) node.activity = boundedLine(activity, 80) || 'Idle';
  }

  setPresence(nodeNum, presence, statusMessage = '') {
    const node = this.nodes.get(nodeNum);
    const normalized = String(presence || '').toLowerCase();
    if (!node) throw new Error('Node is not online');
    if (!PRESENCE_STATES.has(normalized)) throw new TypeError('Unknown presence state');
    node.presence = normalized;
    node.statusMessage = boundedLine(statusMessage, 80);
    return this.publicNode(nodeNum);
  }

  getNode(nodeNum) { return this.nodes.get(nodeNum); }

  publicNode(nodeNum) {
    const node = this.nodes.get(nodeNum);
    if (!node) return null;
    return { nodeNum, username: node.username, activity: node.activity, presence: node.presence,
      statusMessage: node.statusMessage, connectedAt: node.connectedAt,
      inPrivateChat: Boolean(node.privateChatId) };
  }

  getOnlineUsers() { return Array.from(this.nodes.keys(), (nodeNum) => this.publicNode(nodeNum)); }
  getOnlineCount() { return this.nodes.size; }

  findNodeBySession(session) {
    for (const [nodeNum, node] of this.nodes) if (node.session === session) return nodeNum;
    return null;
  }

  findNodeByUsername(username) {
    const sought = String(username || '').toLowerCase();
    for (const [nodeNum, node] of this.nodes) {
      if (node.username && node.username.toLowerCase() === sought) return nodeNum;
    }
    return null;
  }

  setTelegramSender(sender) {
    if (sender !== null && typeof sender !== 'function') throw new TypeError('Telegram sender must be a function');
    this.sendTelegram = sender;
  }

  pageUser(fromNode, target, message = '') {
    this._expireInvitations();
    const sender = this.nodes.get(fromNode);
    if (!sender || !sender.username) return { ok: false, code: 'NOT_AUTHENTICATED' };
    const toNode = typeof target === 'number' ? target : this.findNodeByUsername(target);
    if (!toNode) return { ok: false, code: 'OFFLINE' };
    if (toNode === fromNode) return { ok: false, code: 'SELF_PAGE' };
    const recipient = this.nodes.get(toNode);
    if (!recipient || !recipient.username) return { ok: false, code: 'OFFLINE' };
    if (recipient.presence === 'dnd') return { ok: false, code: 'DO_NOT_DISTURB' };
    if (sender.privateChatId || recipient.privateChatId) return { ok: false, code: 'ALREADY_CHATTING' };
    const pendingForRecipient = Array.from(this.invitations.values())
      .filter((invite) => invite.toNode === toNode && invite.status === 'pending').length;
    if (pendingForRecipient >= this.maxPendingPages) return { ok: false, code: 'INBOX_FULL' };
    const now = this.now();
    const lastPage = this.lastPageAt.get(fromNode);
    if (lastPage !== undefined && now - lastPage < this.pageCooldownMs) {
      return { ok: false, code: 'COOLDOWN', retryAfterMs: this.pageCooldownMs - (now - lastPage) };
    }
    const duplicate = Array.from(this.invitations.values()).find((invite) =>
      invite.status === 'pending' && invite.fromNode === fromNode && invite.toNode === toNode);
    if (duplicate) return { ok: false, code: 'ALREADY_PENDING', invitation: { ...duplicate } };
    const invitation = { id: crypto.randomBytes(12).toString('hex'), fromNode,
      fromUsername: sender.username, toNode, toUsername: recipient.username,
      message: boundedLine(message, 160), status: 'pending', createdAt: new Date(now),
      expiresAt: new Date(now + this.pageTtlMs) };
    this.invitations.set(invitation.id, invitation);
    this.lastPageAt.set(fromNode, now);
    const pageLines = [`*** PAGE from ${invitation.fromUsername} on node ${fromNode} - accept or decline ***`];
    if (invitation.message) pageLines.push(...wrapLine(invitation.message, 68).map(line => `    ${line}`));
    this._write(toNode, `\r\n\x1b[1;33m${pageLines.join('\r\n')}\x1b[0m\r\n`);
    return { ok: true, invitation: { ...invitation } };
  }

  getPendingPages(nodeNum) {
    this._expireInvitations();
    return Array.from(this.invitations.values()).filter((i) => i.toNode === nodeNum && i.status === 'pending')
      .map((invite) => ({ ...invite }));
  }

  acceptPage(nodeNum, invitationId) {
    this._expireInvitations();
    const invite = this.invitations.get(String(invitationId));
    if (!invite || invite.status !== 'pending') return { ok: false, code: 'NOT_FOUND' };
    if (invite.toNode !== nodeNum) return { ok: false, code: 'FORBIDDEN' };
    const sender = this.nodes.get(invite.fromNode);
    const recipient = this.nodes.get(invite.toNode);
    if (!sender || !recipient) return { ok: false, code: 'OFFLINE' };
    if (sender.privateChatId || recipient.privateChatId) return { ok: false, code: 'ALREADY_CHATTING' };
    invite.status = 'accepted';
    const chat = { id: crypto.randomBytes(12).toString('hex'),
      nodeNums: [invite.fromNode, invite.toNode], openedAt: new Date(this.now()) };
    this.chats.set(chat.id, chat);
    sender.privateChatId = chat.id;
    recipient.privateChatId = chat.id;
    this._write(invite.fromNode, `\r\n\x1b[1;32m*** ${recipient.username} accepted your page. Private chat opened. ***\x1b[0m\r\n`);
    this._write(invite.toNode, `\r\n\x1b[1;32m*** Private chat with ${sender.username} opened. ***\x1b[0m\r\n`);
    this.invitations.delete(invite.id);
    return { ok: true, chat: { ...chat, nodeNums: [...chat.nodeNums] } };
  }

  declinePage(nodeNum, invitationId) {
    this._expireInvitations();
    const invite = this.invitations.get(String(invitationId));
    if (!invite || invite.status !== 'pending') return { ok: false, code: 'NOT_FOUND' };
    if (invite.toNode !== nodeNum) return { ok: false, code: 'FORBIDDEN' };
    invite.status = 'declined';
    this._write(invite.fromNode, `\r\n\x1b[1;33m*** ${invite.toUsername} declined your page. ***\x1b[0m\r\n`);
    this.invitations.delete(invite.id);
    return { ok: true };
  }

  sendPrivateChat(nodeNum, message) {
    const node = this.nodes.get(nodeNum);
    const text = boundedLine(message, 500);
    if (!node || !node.privateChatId) return { ok: false, code: 'NOT_IN_CHAT' };
    if (!text) return { ok: false, code: 'EMPTY' };
    const chat = this.chats.get(node.privateChatId);
    if (!chat) return { ok: false, code: 'NOT_IN_CHAT' };
    const peerNode = chat.nodeNums.find((candidate) => candidate !== nodeNum);
    if (!this.nodes.has(peerNode)) { this.leavePrivateChat(nodeNum); return { ok: false, code: 'OFFLINE' }; }
    const prefix = `[private:${node.username}] `;
    const width = Math.max(20, 72 - prefix.length);
    const lines = wrapLine(text, width).map(line => `${prefix}${line}`);
    this._write(peerNode, `\r\n\x1b[1;36m${lines.join('\r\n')}\x1b[0m\r\n`);
    return { ok: true };
  }

  leavePrivateChat(nodeNum, reason = 'Private chat closed.') {
    const node = this.nodes.get(nodeNum);
    if (!node || !node.privateChatId) return false;
    const chatId = node.privateChatId;
    const chat = this.chats.get(chatId);
    this.chats.delete(chatId);
    if (chat) for (const memberNode of chat.nodeNums) {
      const member = this.nodes.get(memberNode);
      if (member) member.privateChatId = null;
      if (memberNode !== nodeNum) this._write(memberNode, `\r\n\x1b[1;33m*** ${boundedLine(reason, 160)} ***\x1b[0m\r\n`);
    }
    return true;
  }

  telegram(fromNode, toUsername, message) {
    const sender = this.nodes.get(fromNode);
    const recipient = boundedLine(toUsername, 40);
    const body = boundedLine(message, 500);
    if (!sender || !sender.username) return { ok: false, code: 'NOT_AUTHENTICATED' };
    if (!recipient || !body) return { ok: false, code: 'INVALID' };
    if (typeof this.sendTelegram !== 'function') return { ok: false, code: 'UNAVAILABLE' };
    const now = this.now();
    const senderKey = sender.username.toLowerCase();
    const rateKey = `${senderKey}:${recipient.toLowerCase()}`;
    const globalKey = `${senderKey}:*`;
    const last = this.lastTelegramAt.get(rateKey);
    const lastGlobal = this.lastTelegramAt.get(globalKey);
    if (lastGlobal !== undefined && now - lastGlobal < this.telegramGlobalCooldownMs) {
      return { ok: false, code: 'COOLDOWN', retryAfterMs: this.telegramGlobalCooldownMs - (now - lastGlobal) };
    }
    if (last !== undefined && now - last < this.telegramCooldownMs) {
      return { ok: false, code: 'COOLDOWN', retryAfterMs: this.telegramCooldownMs - (now - last) };
    }
    const result = this.sendTelegram(sender.username, recipient, body);
    if (result !== false) {
      this.lastTelegramAt.set(rateKey, now);
      this.lastTelegramAt.set(globalKey, now);
      for (const [key, timestamp] of this.lastTelegramAt) {
        if (now - timestamp > this.telegramCooldownMs) this.lastTelegramAt.delete(key);
      }
    }
    return result === false ? { ok: false, code: 'UNKNOWN_RECIPIENT' } : { ok: true };
  }

  pageOrTelegram(fromNode, toUsername, message = '') {
    const page = this.pageUser(fromNode, toUsername, message);
    if (page.code !== 'OFFLINE') return page;
    const telegram = this.telegram(fromNode, toUsername, message);
    return telegram.ok ? { ok: true, telegram: true } : telegram;
  }

  broadcast(message, excludeNode = null) {
    for (const [nodeNum, node] of this.nodes) if (nodeNum !== excludeNode && node.session) node.session.write(message);
  }

  _write(nodeNum, message) {
    const node = this.nodes.get(nodeNum);
    if (!node?.session) return;
    if (typeof node.session.receiveAsync === 'function') node.session.receiveAsync(message);
    else if (typeof node.session.write === 'function') node.session.write(message);
  }

  _expireInvitations() {
    const now = this.now();
    for (const [id, invite] of this.invitations) {
      if (invite.status !== 'pending' || invite.expiresAt.getTime() <= now) {
        if (invite.status === 'pending') {
          invite.status = 'expired';
          this._write(invite.fromNode, `\r\n\x1b[1;33m*** Page to ${invite.toUsername} expired. ***\x1b[0m\r\n`);
        }
        this.invitations.delete(id);
      }
    }
  }
}

module.exports = NodeManager;
module.exports.PRESENCE_STATES = PRESENCE_STATES;
module.exports.boundedLine = boundedLine;
module.exports.wrapLine = wrapLine;
