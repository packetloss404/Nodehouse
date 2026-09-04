'use strict';

const PROFILE_FIELDS = Object.freeze({
  profile_visible: { type: 'boolean' },
  spotlight_opt_in: { type: 'boolean' },
  display_name: { max: 40 },
  bio: { max: 320, multiline: true },
  interests: { max: 160 },
  favorite_boards: { max: 160 },
  favorite_doors: { max: 160 },
  ansi_avatar: { max: 4096, multiline: true, ansi: true },
});
const PORCH_TYPES = new Set(['notice', 'event', 'classified', 'help_wanted', 'auto_message']);
const MODERATION_STATES = new Set(['pending', 'active', 'rejected', 'removed']);

function cleanText(value, max, { multiline = false, ansi = false } = {}) {
  if (value === undefined || value === null) return '';
  let text = String(value).replace(/\0/g, '');
  if (ansi) text = sanitizeAvatar(text);
  else text = text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, '');
  text = text.replace(/\r\n?/g, '\n');
  if (!multiline) text = text.replace(/\n+/g, ' ');
  text = text.replace(/[^\x09\x0a\x20-\x7e\x80-\uffff\x1b]/g, '');
  return text.trim().slice(0, max);
}

// Caller avatars may use classic SGR colors, but not cursor motion, title changes,
// hyperlinks, device queries, or other terminal control sequences.
function sanitizeAvatar(value) {
  const input = String(value);
  let output = '';
  for (let index = 0; index < input.length;) {
    if (input.charCodeAt(index) !== 0x1b) { output += input[index++]; continue; }
    if (input[index + 1] === '[') {
      let end = index + 2;
      while (end < input.length && !/[A-Za-z@`~]/.test(input[end])) end += 1;
      const sequence = input.slice(index, Math.min(end + 1, input.length));
      if (/^\x1b\[(?:[0-9]{0,3}(?:;[0-9]{0,3})*)?m$/.test(sequence)) output += sequence;
      index = Math.min(end + 1, input.length);
      continue;
    }
    if (input[index + 1] === ']') {
      const bell = input.indexOf('\x07', index + 2);
      const terminator = input.indexOf('\x1b\\', index + 2);
      index = Math.min(bell < 0 ? Infinity : bell + 1, terminator < 0 ? Infinity : terminator + 2, input.length);
      continue;
    }
    if (input[index + 1] === 'P') {
      const terminator = input.indexOf('\x1b\\', index + 2);
      index = terminator < 0 ? input.length : terminator + 2;
      continue;
    }
    index += Math.min(2, input.length - index);
  }
  return output;
}

function positiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function parseExpiry(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now) throw new TypeError('Expiry must be a future date');
  const latest = now + (180 * 24 * 60 * 60 * 1000);
  return new Date(Math.min(timestamp, latest)).toISOString();
}

class CommunityService {
  constructor(database, { now = () => Date.now() } = {}) {
    this.db = database;
    this.now = now;
  }

  profileForUser(userId) {
    return this._profiles().getByUserId(positiveInt(userId, 0));
  }

  saveProfile(userId, input = {}) {
    if ('visible' in input && !('profile_visible' in input)) input = { ...input, profile_visible: input.visible };
    const clean = {};
    for (const [field, rules] of Object.entries(PROFILE_FIELDS)) {
      if (!(field in input)) continue;
      clean[field] = rules.type === 'boolean'
        ? (input[field] === true || input[field] === 1 || input[field] === '1')
        : cleanText(input[field], rules.max, rules);
    }
    // Caller cards are private until the caller explicitly opts in.
    if (!this.profileForUser(userId) && !('profile_visible' in clean)) clean.profile_visible = false;
    return this._profiles().upsert(positiveInt(userId, 0), clean);
  }

  directory(query = {}) {
    return this._profiles().listVisible({
      search: cleanText(query.search, 60),
      limit: positiveInt(query.limit, 25, 100),
      offset: Math.max(0, Number.parseInt(query.offset, 10) || 0),
    });
  }

  createPorchPost(actor, input = {}) {
    const accessLevel = Number(actor.accessLevel ?? actor.access_level ?? 0);
    const type = cleanText(input.type, 24).toLowerCase();
    if (!PORCH_TYPES.has(type)) throw new TypeError('Unknown porch post type');
    const title = cleanText(input.title, 80);
    const body = cleanText(input.body, 1200, { multiline: true });
    if (!title || !body) throw new TypeError('Title and body are required');
    const expiresAt = parseExpiry(input.expires_at, this.now());
    const post = this._porch().create(positiveInt(actor.id, 0), {
      type,
      title,
      body,
      expiresAt,
      pinned: accessLevel >= 100 && Boolean(input.pinned),
    });
    if (accessLevel < 100) {
      const pending = this._porch().moderate(post.id, { status: 'pending' });
      if (this.db.moderationQueue) {
        this.db.moderationQueue.create({
          targetType: 'porch_post', targetId: post.id,
          reason: 'New caller porch post awaiting review', reportedByUserId: positiveInt(actor.id, null),
        });
      }
      return pending;
    }
    return post;
  }

  listPorch(query = {}, { includeUnapproved = false } = {}) {
    return this._porch().list({
      type: query.type && cleanText(query.type, 24).toLowerCase(),
      includeInactive: Boolean(includeUnapproved),
      limit: positiveInt(query.limit, 25, 100),
      offset: Math.max(0, Number.parseInt(query.offset, 10) || 0),
    });
  }

  moderatePost(id, state, actor, reason = '') {
    const normalized = cleanText(state, 16).toLowerCase();
    if (!MODERATION_STATES.has(normalized) || normalized === 'pending') {
      throw new TypeError('Unknown moderation state');
    }
    const postId = positiveInt(id, 0);
    const result = this._porch().moderate(postId, { status: normalized });
    this.recordAudit(actor, 'porch.moderate', 'porch_post', postId, { state: normalized, reason });
    return result;
  }

  recordAudit(actor, action, targetType, targetId, details = {}) {
    if (!this.db.auditLog || typeof this.db.auditLog.record !== 'function') return null;
    const detailSummary = cleanText(JSON.stringify(details), 1900, { multiline: true });
    return this.db.auditLog.record({
      actorUserId: positiveInt(actor && actor.id, null),
      action: cleanText(action, 80),
      targetType: cleanText(targetType, 40),
      targetId: targetId === undefined || targetId === null ? null : cleanText(targetId, 80),
      details: { summary: detailSummary },
    });
  }

  _profiles() {
    if (!this.db.communityProfiles) throw new Error('Community profile storage is unavailable');
    return this.db.communityProfiles;
  }

  _porch() {
    if (!this.db.porchPosts) throw new Error('Porch post storage is unavailable');
    return this.db.porchPosts;
  }
}

module.exports = { CommunityService, PORCH_TYPES, MODERATION_STATES, cleanText, sanitizeAvatar, parseExpiry };
