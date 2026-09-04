'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CommunityService, cleanText, sanitizeAvatar } = require('../src/core/community-service');
const { safeActor, hasPermission } = require('../src/admin/authz');

function stores() {
  const profiles = new Map();
  const posts = [];
  const audits = [];
  return {
    profiles,
    posts,
    audits,
    db: {
      communityProfiles: {
        getByUserId: (id) => profiles.get(id),
        upsert(id, fields) { const value = { ...(profiles.get(id) || {}), ...fields }; profiles.set(id, value); return value; },
        listVisible: (query) => ({ query }),
      },
      porchPosts: {
        create(userId, input) { const post = { id: posts.length + 1, userId, status: 'active', ...input }; posts.push(post); return post; },
        moderate(id, input) { Object.assign(posts[id - 1], input); return posts[id - 1]; },
        list: (query) => ({ query }),
      },
      auditLog: { record(value) { audits.push(value); return audits.length; } },
    },
  };
}

test('caller cards default hidden and sanitize bounded content', () => {
  const state = stores();
  const service = new CommunityService(state.db);
  const saved = service.saveProfile(7, { display_name: '\x1b[31mAlice', bio: 'hello\0world' });
  assert.equal(saved.profile_visible, false);
  assert.equal(saved.display_name, 'Alice');
  assert.equal(saved.bio, 'helloworld');
  assert.equal(service.saveProfile(7, { visible: true }).profile_visible, true);
  assert.equal(cleanText('a\r\nb', 20), 'a b');
  assert.equal(sanitizeAvatar('\x1b]0;owned\x07safe\x1b[31mred\x1b[2J'), 'safe\x1b[31mred');
});

test('porch posts validate type, content, expiry, and queue caller posts', () => {
  const state = stores();
  const service = new CommunityService(state.db, { now: () => Date.parse('2026-01-01T00:00:00Z') });
  assert.throws(() => service.createPorchPost({ id: 1, username: 'Caller', accessLevel: 10 },
    { type: 'spam', title: 'x', body: 'y' }), /Unknown porch/);
  const post = service.createPorchPost({ id: 1, username: 'Caller', accessLevel: 10 }, {
    type: 'classified', title: '  Modem for sale  ', body: 'Works\r\ngreat', expires_at: '2026-02-01T00:00:00Z',
  });
  assert.equal(post.status, 'pending');
  assert.equal(post.title, 'Modem for sale');
  assert.equal(post.body, 'Works\ngreat');
  assert.throws(() => service.createPorchPost({ id: 1, username: 'Caller' },
    { type: 'notice', title: 'x', body: 'y', expires_at: '2025-01-01' }), /future date/);
});

test('moderation records a bounded audit event', () => {
  const state = stores();
  const service = new CommunityService(state.db);
  state.posts.push({ id: 1, status: 'pending' });
  service.moderatePost(1, 'active', { id: 9, username: 'Mod' }, 'looks good');
  assert.equal(state.posts[0].status, 'active');
  assert.equal(state.audits[0].action, 'porch.moderate');
  assert.equal(state.audits[0].actorUserId, 9);
});

test('control-desk authorization separates moderators from SysOps', () => {
  const moderator = safeActor({ id: 4, username: 'Mod', access_level: 100, password_hash: 'never expose' });
  assert.deepEqual(moderator, { id: 4, username: 'Mod', accessLevel: 100 });
  assert.equal(hasPermission(moderator, 'MODERATE_COMMUNITY'), true);
  assert.equal(hasPermission(moderator, 'MANAGE_USERS'), false);
  assert.equal(hasPermission({ accessLevel: 200 }, 'MANAGE_USERS'), true);
});
