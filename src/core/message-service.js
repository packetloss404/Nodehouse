const database = require('./database');

const MAX_SUBJECT_LENGTH = 160;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_QUOTE_LINES = 80;

function normalizeBaseIds(baseIds) {
  return [...new Set((baseIds || []).map(Number).filter(Number.isInteger))];
}

function requireText(value, name, maximum) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required.`);
  if (Buffer.byteLength(text) > maximum) throw new Error(`${name} is too long.`);
  return text;
}

function createMessageService(store = database) {
  return {
    create({ baseId, fromUser, toUser = 'All', subject, body, replyTo = null,
      accessibleBaseIds = [] } = {}) {
      const allowed = normalizeBaseIds(accessibleBaseIds);
      const numericBaseId = Number(baseId);
      if (!allowed.includes(numericBaseId)) throw new Error('Message base is not accessible.');
      const cleanFrom = requireText(fromUser, 'Author', 64);
      const cleanTo = requireText(toUser || 'All', 'Recipient', 64);
      const cleanSubject = requireText(subject, 'Subject', MAX_SUBJECT_LENGTH);
      const cleanBody = requireText(body, 'Body', MAX_BODY_BYTES);
      return store.messages.create(
        numericBaseId, cleanFrom, cleanTo, cleanSubject, cleanBody,
        replyTo === null ? null : Number(replyTo)
      );
    },

    getThread(messageId, { accessibleBaseIds = [] } = {}) {
      const message = store.messages.getById(Number(messageId));
      if (!message || !normalizeBaseIds(accessibleBaseIds).includes(message.base_id)) return [];
      return store.messages.getThread(message.id);
    },

    search(query, { accessibleBaseIds = [], limit = 50, offset = 0 } = {}) {
      return store.messages.search(query, normalizeBaseIds(accessibleBaseIds), { limit, offset });
    },

    quote(messageOrBody, { startLine = 0, endLine = null, initials = '' } = {}) {
      const body = typeof messageOrBody === 'object' ? messageOrBody?.body : messageOrBody;
      const lines = String(body ?? '').replace(/\r\n/g, '\n').split('\n');
      const start = Math.max(0, Number(startLine) || 0);
      const requestedEnd = endLine === null ? lines.length : Math.max(start, Number(endLine) + 1);
      const selected = lines.slice(start, Math.min(requestedEnd, start + MAX_QUOTE_LINES));
      const prefix = initials ? `${String(initials).slice(0, 8)}> ` : '> ';
      return selected.map((line) => `${prefix}${line}`).join('\r\n');
    },

    constants: { MAX_SUBJECT_LENGTH, MAX_BODY_BYTES, MAX_QUOTE_LINES },
  };
}

module.exports = { createMessageService };
