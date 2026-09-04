const database = require('./database');

const MAX_SIGNATURE_BYTES = 240;
const MAX_SIGNATURE_LINES = 4;
const MAX_DRAFTS = 20;
const MAX_DRAFT_BODY_BYTES = 64 * 1024;

function normalizeBases(bases) {
  return (bases || []).map((base) => typeof base === 'object'
    ? { ...base, id: Number(base.id) }
    : { id: Number(base) }).filter((base) => Number.isInteger(base.id));
}

function validateSignature(signature) {
  const value = String(signature ?? '').replace(/\r\n/g, '\n');
  if (Buffer.byteLength(value) > MAX_SIGNATURE_BYTES || value.split('\n').length > MAX_SIGNATURE_LINES) {
    throw new Error(`Signature must be at most ${MAX_SIGNATURE_LINES} lines and ${MAX_SIGNATURE_BYTES} bytes.`);
  }
  return value;
}

function normalizeDraft(draft = {}) {
  const body = String(draft.body ?? '');
  if (Buffer.byteLength(body) > MAX_DRAFT_BODY_BYTES) throw new Error('Draft body is too large.');
  const subject = String(draft.subject ?? '').slice(0, 160);
  const toUser = String(draft.toUser || 'All').slice(0, 64);
  return {
    baseId: draft.baseId === null || draft.baseId === undefined ? null : Number(draft.baseId),
    toUser, subject, body,
    replyTo: draft.replyTo === null || draft.replyTo === undefined ? null : Number(draft.replyTo),
  };
}

function createReaderService(store = database) {
  const accessibleIds = (bases) => normalizeBases(bases).map((base) => base.id);
  const requireAccess = (baseId, bases) => {
    const id = Number(baseId);
    if (!accessibleIds(bases).includes(id)) throw new Error('Message base is not accessible.');
    return id;
  };

  return {
    getSubscriptions(userId, accessibleBases) {
      const bases = normalizeBases(accessibleBases);
      store.readerSubscriptions.ensure(userId, bases.map((base) => base.id));
      const allowed = new Set(bases.map((base) => base.id));
      return store.readerSubscriptions.list(userId).filter((row) => allowed.has(row.base_id));
    },

    setSubscription(userId, baseId, subscribed, accessibleBases) {
      const id = requireAccess(baseId, accessibleBases);
      this.getSubscriptions(userId, accessibleBases);
      return store.readerSubscriptions.set(userId, id, Boolean(subscribed));
    },

    reorderSubscriptions(userId, orderedBaseIds, accessibleBases) {
      const existing = this.getSubscriptions(userId, accessibleBases);
      const allowed = new Set(existing.map((row) => row.base_id));
      const order = [...new Set(orderedBaseIds.map(Number))];
      if (order.length !== allowed.size || order.some((id) => !allowed.has(id))) {
        throw new Error('Subscription order must contain each accessible base exactly once.');
      }
      store.readerSubscriptions.reorder(userId, order);
      return this.getSubscriptions(userId, accessibleBases);
    },

    getCurrentBase(userId, accessibleBases) {
      const subscriptions = this.getSubscriptions(userId, accessibleBases);
      const current = store.readerPreferences.get(userId).current_base_id;
      if (subscriptions.some((row) => row.base_id === current)) return current;
      return subscriptions.find((row) => row.subscribed)?.base_id || subscriptions[0]?.base_id || null;
    },

    setCurrentBase(userId, baseId, accessibleBases) {
      const id = requireAccess(baseId, accessibleBases);
      store.readerPreferences.setCurrentBase(userId, id);
      return id;
    },

    scanUnread(userId, accessibleBases, { limit = 500 } = {}) {
      const subscriptions = this.getSubscriptions(userId, accessibleBases).filter((row) => row.subscribed);
      const cap = Math.max(1, Math.min(Number(limit) || 500, 1000));
      const messages = [];
      for (const subscription of subscriptions) {
        for (const message of store.messages.getUnreadByBase(subscription.base_id, userId)) {
          messages.push(message);
          if (messages.length >= cap) return messages;
        }
      }
      return messages;
    },

    nextUnread(userId, accessibleBases, { afterMessageId = 0, baseId = null } = {}) {
      const bases = baseId === null
        ? this.getSubscriptions(userId, accessibleBases).filter((row) => row.subscribed).map((row) => row.base_id)
        : [requireAccess(baseId, accessibleBases)];
      const after = Number(afterMessageId || 0);
      const current = after ? store.messages.getById(after) : null;
      const startIndex = current && baseId === null ? Math.max(0, bases.indexOf(current.base_id)) : 0;
      for (let index = startIndex; index < bases.length; index += 1) {
        const id = bases[index];
        const unread = store.messages.getUnreadByBase(id, userId);
        const next = index === startIndex && current?.base_id === id
          ? unread.find((message) => message.id > after)
          : unread[0];
        if (next) return next;
      }
      return null;
    },

    nextUnreadThread(userId, accessibleBases, options = {}) {
      const after = Number(options.afterMessageId || 0);
      const current = after ? store.messages.getById(after) : null;
      const currentRoot = current ? (current.root_id || current.id) : null;
      const bases = this.getSubscriptions(userId, accessibleBases)
        .filter((row) => row.subscribed).map((row) => row.base_id);
      const startIndex = current ? Math.max(0, bases.indexOf(current.base_id)) : 0;
      for (let index = startIndex; index < bases.length; index += 1) {
        for (const message of store.messages.getUnreadByBase(bases[index], userId)) {
          if (index === startIndex && current?.base_id === bases[index] && message.id <= after) continue;
          if ((message.root_id || message.id) !== currentRoot) return message;
        }
      }
      return null;
    },

    markRead(userId, messageId, accessibleBases) {
      const message = store.messages.getById(Number(messageId));
      if (!message) return false;
      requireAccess(message.base_id, accessibleBases);
      return store.messages.markRead(message.id, userId);
    },

    markUnread(userId, messageId, accessibleBases) {
      const message = store.messages.getById(Number(messageId));
      if (!message) return false;
      requireAccess(message.base_id, accessibleBases);
      return store.messages.markUnread(message.id, userId);
    },

    catchUp(userId, baseId, accessibleBases, throughMessageId = null) {
      return store.messages.catchUp(requireAccess(baseId, accessibleBases), userId, throughMessageId);
    },

    getSignature(userId) {
      return store.readerPreferences.get(userId).signature;
    },

    setSignature(userId, signature) {
      return store.readerPreferences.setSignature(userId, validateSignature(signature)).signature;
    },

    applySignature(userId, body) {
      const signature = this.getSignature(userId);
      return signature
        ? `${String(body ?? '').replace(/\s+$/, '')}\r\n\r\n-- \r\n${signature}`
        : String(body ?? '');
    },

    listDrafts(userId) { return store.messageDrafts.list(userId); },
    getDraft(userId, draftId) { return store.messageDrafts.get(userId, draftId); },
    saveDraft(userId, draft, accessibleBases) {
      const value = normalizeDraft(draft);
      if (value.baseId !== null) requireAccess(value.baseId, accessibleBases);
      if (value.replyTo !== null) {
        const parent = store.messages.getById(value.replyTo);
        if (!parent) throw new Error('Draft reply parent does not exist.');
        if (value.baseId === null || parent.base_id !== value.baseId) {
          throw new Error('Draft reply parent belongs to a different message base.');
        }
      }
      const saved = draft.id
        ? store.messageDrafts.update(userId, Number(draft.id), value)
        : store.messageDrafts.create(userId, value);
      if (!saved) throw new Error('Draft does not exist.');
      store.messageDrafts.trim(userId, MAX_DRAFTS);
      return saved;
    },
    deleteDraft(userId, draftId) { return store.messageDrafts.delete(userId, draftId); },

    constants: { MAX_SIGNATURE_BYTES, MAX_SIGNATURE_LINES, MAX_DRAFTS, MAX_DRAFT_BODY_BYTES },
  };
}

module.exports = { createReaderService };
