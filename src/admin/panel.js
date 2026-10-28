// SysOp Admin Panel - Web-based administration for The Nodehouse
const express = require('express');
const db = require('../core/database');
const { createExpressRateLimit } = require('../server/guardrails');
const { CommunityService, cleanText } = require('../core/community-service');
const { ACCESS, safeActor, requirePermission } = require('./authz');

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_ADMIN_PASSWORD_LENGTH = 12;

function setupAdminPanel(app, nodeManager, config) {
  const ADMIN_SESSIONS = new Map();
  const community = new CommunityService(db);
  const loginRateLimit = createExpressRateLimit({
    max: 10,
    windowMs: 15 * 60 * 1000,
    message: 'Too many admin login attempts. Please try again later.',
  });

  app.use('/admin/api', express.json({ limit: '16kb' }));

  function generateToken() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  function requireAuth(req, res, next) {
    const token = req.headers['x-admin-token'];
    const session = ADMIN_SESSIONS.get(token);
    if (session && session.expiresAt > Date.now()) {
      const current = db.users.getById(session.actor.id);
      if (!current || current.access_level < ACCESS.MODERATOR) {
        ADMIN_SESSIONS.delete(token);
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      session.actor = safeActor(current);
      req.adminActor = session.actor;
      next();
    } else {
      if (token) ADMIN_SESSIONS.delete(token);
      res.status(401).json({ error: 'Unauthorized' });
    }
  }

  function invalidateUserSessions(userId) {
    for (const [token, session] of ADMIN_SESSIONS) {
      if (Number(session.actor.id) === Number(userId)) ADMIN_SESSIONS.delete(token);
    }
  }

  // ─── Auth ───
  app.post('/admin/api/login', loginRateLimit, (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = db.users.authenticate(username, password);
    if (user && user.access_level >= ACCESS.MODERATOR) {
      const token = generateToken();
      const actor = safeActor(user);
      ADMIN_SESSIONS.set(token, { expiresAt: Date.now() + ADMIN_SESSION_TTL_MS, actor });
      res.json({ token, username: user.username, accessLevel: actor.accessLevel });
    } else {
      res.status(401).json({ error: 'Invalid credentials or insufficient access' });
    }
  });

  app.post('/admin/api/logout', (req, res) => {
    const token = req.headers['x-admin-token'];
    ADMIN_SESSIONS.delete(token);
    res.json({ ok: true });
  });

  // ─── Dashboard ───
  app.get('/admin/api/stats', requireAuth, (req, res) => {
    const userStats = db.users.getStats();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    res.json({
      totalUsers: userStats.totalUsers,
      totalMessages: db.messages.getTotal(),
      totalCalls: userStats.totalCalls,
      nodesOnline: nodeManager.getOnlineCount(),
      maxNodes: config.maxNodes,
      uptime: `${hours}h ${mins}m`,
      onlineUsers: nodeManager.getOnlineUsers(),
      recentCalls: db.callLog.getRecent(10),
    });
  });

  // ─── Users ───
  app.get('/admin/api/users', requireAuth, requirePermission('MANAGE_USERS'), (req, res) => {
    res.json(db.users.getAll());
  });

  app.get('/admin/api/users/:id', requireAuth, requirePermission('MANAGE_USERS'), (req, res) => {
    const user = db.users.getById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password_hash, password_salt, ...safe } = user;
    res.json(safe);
  });

  app.put('/admin/api/users/:id', requireAuth, requirePermission('MANAGE_USERS'), (req, res) => {
    const targetId = parseInt(req.params.id);
    const target = db.users.getById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const requestedAccess = Object.prototype.hasOwnProperty.call(req.body || {}, 'access_level')
      ? Number(req.body.access_level) : target.access_level;
    if (!Number.isInteger(requestedAccess) || requestedAccess < ACCESS.CALLER || requestedAccess > 255) {
      return res.status(400).json({ error: 'Access level must be an integer from 10 to 255' });
    }
    const sysops = db.users.getAll().filter(user => user.access_level >= ACCESS.SYSOP);
    if (target.access_level >= ACCESS.SYSOP && requestedAccess < ACCESS.SYSOP && sysops.length <= 1) {
      return res.status(409).json({ error: 'The last SysOp account cannot be demoted' });
    }
    db.users.update(targetId, req.body);
    community.recordAudit(req.adminActor, 'user.update', 'user', req.params.id, { fields: Object.keys(req.body || {}) });
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'access_level')) invalidateUserSessions(targetId);
    res.json({ ok: true });
  });

  app.delete('/admin/api/users/:id', requireAuth, requirePermission('MANAGE_USERS'), (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.adminActor.id) return res.status(400).json({ error: 'You cannot delete your own active account' });
    const target = db.users.getById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const sysops = db.users.getAll().filter(user => user.access_level >= ACCESS.SYSOP);
    if (target.access_level >= ACCESS.SYSOP && sysops.length <= 1) {
      return res.status(409).json({ error: 'The last SysOp account cannot be deleted' });
    }
    community.recordAudit(req.adminActor, 'user.delete', 'user', req.params.id);
    db.users.delete(targetId);
    invalidateUserSessions(targetId);
    res.json({ ok: true });
  });

  app.post('/admin/api/users/:id/reset-password', requireAuth, requirePermission('MANAGE_USERS'), (req, res) => {
    if (typeof req.body.password !== 'string' || req.body.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`,
      });
    }
    const targetId = parseInt(req.params.id);
    const target = db.users.getById(targetId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    db.users.resetPassword(targetId, req.body.password);
    community.recordAudit(req.adminActor, 'user.password_reset', 'user', req.params.id);
    invalidateUserSessions(targetId);
    res.json({ ok: true });
  });

  // ─── Messages ───
  app.get('/admin/api/messages/:baseId', requireAuth, (req, res) => {
    res.json(db.messages.getByBase(parseInt(req.params.baseId)));
  });

  app.delete('/admin/api/messages/:id', requireAuth, (req, res) => {
    const removed = db.messages.delete(parseInt(req.params.id));
    if (!removed) return res.status(404).json({ error: 'Message not found' });
    community.recordAudit(req.adminActor, 'message.delete', 'message', req.params.id);
    res.json({ ok: true });
  });

  // ─── Bulletins ───
  app.get('/admin/api/bulletins', requireAuth, (req, res) => {
    res.json(db.bulletins.getAll());
  });

  app.post('/admin/api/bulletins', requireAuth, requirePermission('MANAGE_SYSTEM'), (req, res) => {
    const title = cleanText(req.body.title, 100);
    const body = cleanText(req.body.body, 4000, { multiline: true });
    if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });
    db.bulletins.create(title, body, req.adminActor.username);
    community.recordAudit(req.adminActor, 'bulletin.create', 'bulletin', null, { title });
    res.json({ ok: true });
  });

  app.delete('/admin/api/bulletins/:id', requireAuth, requirePermission('MANAGE_SYSTEM'), (req, res) => {
    const removed = db.bulletins.delete(parseInt(req.params.id));
    if (!removed) return res.status(404).json({ error: 'Bulletin not found' });
    community.recordAudit(req.adminActor, 'bulletin.delete', 'bulletin', req.params.id);
    res.json({ ok: true });
  });

  app.post('/admin/api/bulletins/:id/toggle', requireAuth, requirePermission('MANAGE_SYSTEM'), (req, res) => {
    const changed = db.bulletins.toggle(parseInt(req.params.id));
    if (!changed) return res.status(404).json({ error: 'Bulletin not found' });
    community.recordAudit(req.adminActor, 'bulletin.toggle', 'bulletin', req.params.id);
    res.json({ ok: true });
  });

  // ─── Nodes ───
  app.get('/admin/api/nodes', requireAuth, (req, res) => {
    res.json(nodeManager.getOnlineUsers());
  });

  // ─── Community control desk ───
  app.get('/admin/api/community/profiles', requireAuth, (req, res, next) => {
    try {
      if (!db.communityProfiles || typeof db.communityProfiles.listAll !== 'function') {
        return res.status(503).json({ error: 'Community profile storage is unavailable' });
      }
      res.json(db.communityProfiles.listAll({
        search: cleanText(req.query.search, 60),
        limit: Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100),
        offset: Math.max(parseInt(req.query.offset) || 0, 0),
      }));
    } catch (error) { next(error); }
  });

  app.post('/admin/api/community/profiles/:userId/visibility', requireAuth,
    requirePermission('MODERATE_COMMUNITY'), (req, res, next) => {
      try {
        if (req.body.visible !== false) return res.status(400).json({ error: 'Only the caller may opt a profile into the directory' });
        const profile = community.saveProfile(parseInt(req.params.userId), { profile_visible: false });
        community.recordAudit(req.adminActor, 'profile.visibility', 'user_profile', req.params.userId,
          { visible: false });
        res.json(profile);
      } catch (error) { next(error); }
    });

  app.get('/admin/api/community/porch', requireAuth, (req, res, next) => {
    try { res.json(community.listPorch(req.query, { includeUnapproved: true })); }
    catch (error) { next(error); }
  });

  app.post('/admin/api/community/porch', requireAuth, requirePermission('MODERATE_COMMUNITY'), (req, res, next) => {
    try {
      const post = community.createPorchPost(req.adminActor, req.body);
      community.recordAudit(req.adminActor, 'porch.create', 'porch_post', post && post.id, { type: req.body.type });
      res.status(201).json(post);
    } catch (error) { next(error); }
  });

  app.post('/admin/api/community/porch/:id/moderate', requireAuth,
    requirePermission('MODERATE_COMMUNITY'), (req, res, next) => {
      try {
        const post = community.moderatePost(req.params.id, req.body.state, req.adminActor, req.body.reason);
        if (!post) return res.status(404).json({ error: 'Porch post not found' });
        res.json(post);
      } catch (error) { next(error); }
    });

  app.get('/admin/api/audit', requireAuth, (req, res) => {
    if (!db.auditLog || typeof db.auditLog.list !== 'function') {
      return res.status(503).json({ error: 'Audit storage is unavailable' });
    }
    res.json(db.auditLog.list({ limit: Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 250) }));
  });

  app.get('/admin/api/moderation', requireAuth, requirePermission('MODERATE_COMMUNITY'), (req, res) => {
    if (!db.moderationQueue) return res.status(503).json({ error: 'Moderation storage is unavailable' });
    const allowed = new Set(['open', 'in_review', 'resolved', 'dismissed']);
    const requestedState = req.query.state === undefined ? 'open' : cleanText(req.query.state, 24);
    if (requestedState !== 'all' && !allowed.has(requestedState)) {
      return res.status(400).json({ error: 'Unknown moderation state' });
    }
    const state = requestedState === 'all' ? null : requestedState;
    res.json(db.moderationQueue.list({ state, limit: Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 250) }));
  });

  app.post('/admin/api/moderation/:id', requireAuth, requirePermission('MODERATE_COMMUNITY'), (req, res) => {
    if (!db.moderationQueue) return res.status(503).json({ error: 'Moderation storage is unavailable' });
    const allowed = new Set(['open', 'in_review', 'resolved', 'dismissed']);
    const state = cleanText(req.body.state, 24);
    if (!allowed.has(state)) return res.status(400).json({ error: 'Unknown moderation state' });
    const item = db.moderationQueue.update(parseInt(req.params.id), {
      state,
      assignedToUserId: req.adminActor.id,
      resolution: cleanText(req.body.resolution, 500, { multiline: true }),
    });
    if (!item) return res.status(404).json({ error: 'Moderation item not found' });
    community.recordAudit(req.adminActor, 'moderation.update', 'moderation_item', req.params.id, { state });
    res.json(item);
  });

  app.get('/admin/api/system/status', requireAuth, (req, res) => {
    const memory = process.memoryUsage();
    res.json({
      database: typeof db.healthCheck === 'function' ? db.healthCheck() : { ok: true },
      uptimeSeconds: Math.floor(process.uptime()),
      nodesOnline: nodeManager.getOnlineCount(),
      maxNodes: config.maxNodes,
      pendingPages: nodeManager.invitations ? Array.from(nodeManager.invitations.values()).filter((i) => i.status === 'pending').length : 0,
      activePrivateChats: nodeManager.chats ? nodeManager.chats.size : 0,
      memory: { rss: memory.rss, heapUsed: memory.heapUsed },
    });
  });

  app.use('/admin/api', (error, req, res, next) => {
    if (res.headersSent) return next(error);
    const clientError = error instanceof TypeError;
    res.status(clientError ? 400 : 500).json({ error: clientError ? error.message : 'Control desk operation failed' });
  });

  // ─── Admin Panel HTML ───
  app.get('/admin', (req, res) => {
    res.send(getAdminHTML(config));
  });
}

function getAdminHTML(config) {
  const bbsName = config.bbsName || 'The Nodehouse';
  const messageBases = JSON.stringify(
    config.messageBases.map(({ id, name, section }) => ({ id, name, section }))
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${bbsName} SysOp Panel</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0a0a;
      color: #00ff88;
      min-height: 100vh;
    }
    .login-screen {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; flex-direction: column;
    }
    .login-screen h1 { color: #00bfff; margin-bottom: 20px; font-size: 24px; }
    .login-screen input {
      background: #1a1a1a; border: 1px solid #00ff88; color: #00ff88;
      padding: 10px 15px; margin: 5px 0; width: 250px; font-family: inherit;
      font-size: 14px;
    }
    .login-screen button {
      background: #00ff88; color: #0a0a0a; border: none;
      padding: 10px 30px; margin-top: 10px; cursor: pointer;
      font-family: inherit; font-weight: bold; font-size: 14px;
    }
    .login-screen button:hover { background: #00bfff; }
    .login-error { color: #ff4444; margin-top: 10px; }

    #admin { display: none; }
    .header {
      background: #111; border-bottom: 2px solid #00ff88;
      padding: 15px 20px; display: flex; justify-content: space-between;
      align-items: center;
    }
    .header h1 { color: #00bfff; font-size: 18px; }
    .header button {
      background: #333; color: #ff4444; border: 1px solid #ff4444;
      padding: 5px 15px; cursor: pointer; font-family: inherit;
    }
    .nav {
      background: #111; padding: 10px 20px;
      border-bottom: 1px solid #333; display: flex; gap: 10px;
    }
    .nav button {
      background: #1a1a1a; color: #00ff88; border: 1px solid #333;
      padding: 8px 16px; cursor: pointer; font-family: inherit;
    }
    .nav button:hover, .nav button.active { background: #00ff88; color: #0a0a0a; }
    .content { padding: 20px; max-width: 1200px; margin: 0 auto; }
    .panel { display: none; }
    .panel.active { display: block; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin: 20px 0; }
    .stat-card {
      background: #1a1a1a; border: 1px solid #333; padding: 20px; text-align: center;
    }
    .stat-card .value { font-size: 32px; color: #00bfff; }
    .stat-card .label { color: #666; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th { background: #1a1a1a; color: #00bfff; text-align: left; padding: 10px; border: 1px solid #333; }
    td { padding: 8px 10px; border: 1px solid #222; }
    tr:hover { background: #1a1a1a; }
    .btn {
      background: #333; color: #00ff88; border: 1px solid #00ff88;
      padding: 4px 10px; cursor: pointer; font-family: inherit; font-size: 12px;
    }
    .btn.danger { color: #ff4444; border-color: #ff4444; }
    .btn:hover { background: #00ff88; color: #0a0a0a; }
    .btn.danger:hover { background: #ff4444; color: #0a0a0a; }
    h2 { color: #00bfff; margin-bottom: 15px; }
    .online-dot { color: #00ff88; }
  </style>
</head>
<body>

<div class="login-screen" id="loginScreen">
  <h1>${bbsName} SysOp Panel</h1>
  <input type="text" id="loginUser" placeholder="Username">
  <input type="password" id="loginPass" placeholder="Password">
  <button onclick="doLogin()">Login</button>
  <div class="login-error" id="loginError"></div>
</div>

<div id="admin">
  <div class="header">
    <h1>${bbsName} SysOp Panel</h1>
    <button onclick="doLogout()">Logout</button>
  </div>
  <div class="nav">
    <button class="active" onclick="showPanel('dashboard', this)">Dashboard</button>
    <button onclick="showPanel('users', this)">Users</button>
    <button onclick="showPanel('messages', this)">Messages</button>
    <button onclick="showPanel('bulletins', this)">Bulletins</button>
    <button onclick="showPanel('nodes', this)">Nodes</button>
    <button onclick="showPanel('control', this)">Control Desk</button>
  </div>
  <div class="content">

    <div class="panel active" id="panel-dashboard">
      <h2>Dashboard</h2>
      <div class="stat-grid" id="statsGrid"></div>
      <h2>Recent Calls</h2>
      <table id="recentCalls"><tr><th>User</th><th>Node</th><th>Login</th><th>Logout</th></tr></table>
    </div>

    <div class="panel" id="panel-users">
      <h2>User Management</h2>
      <table id="usersTable"><tr><th>Username</th><th>Real Name</th><th>Level</th><th>Calls</th><th>Posts</th><th>Last Call</th><th>Actions</th></tr></table>
    </div>

    <div class="panel" id="panel-messages">
      <h2>Message Management</h2>
      <div id="msgBaseSelect" style="margin-bottom:15px;"></div>
      <table id="messagesTable"><tr><th>ID</th><th>From</th><th>To</th><th>Subject</th><th>Date</th><th>Actions</th></tr></table>
    </div>

    <div class="panel" id="panel-bulletins">
      <h2>Bulletins</h2>
      <div style="margin-bottom:15px;">
        <input id="bulTitle" placeholder="Title" style="background:#1a1a1a;border:1px solid #333;color:#00ff88;padding:5px;font-family:inherit;width:300px;">
        <button class="btn" onclick="addBulletin()">Add Bulletin</button>
      </div>
      <textarea id="bulBody" placeholder="Body" rows="4" style="background:#1a1a1a;border:1px solid #333;color:#00ff88;padding:5px;font-family:inherit;width:100%;margin-bottom:10px;"></textarea>
      <table id="bulletinsTable"><tr><th>ID</th><th>Title</th><th>Author</th><th>Active</th><th>Date</th><th>Actions</th></tr></table>
    </div>

    <div class="panel" id="panel-nodes">
      <h2>Online Nodes</h2>
      <table id="nodesTable"><tr><th>Node</th><th>User</th><th>Activity</th><th>Connected</th></tr></table>
    </div>

    <div class="panel" id="panel-control">
      <h2>Community Control Desk</h2>
      <div class="stat-grid" id="systemStatus"></div>
      <h2>Porch & Moderation</h2>
      <table id="porchTable"><tr><th>Type</th><th>Title</th><th>Caller</th><th>Status</th><th>Actions</th></tr></table>
      <h2>Caller Cards</h2>
      <table id="profilesTable"><tr><th>Caller</th><th>Name</th><th>Interests</th><th>Visible</th><th>Actions</th></tr></table>
      <h2>Reports</h2>
      <table id="moderationTable"><tr><th>Target</th><th>Reason</th><th>State</th><th>Actions</th></tr></table>
      <h2>Recent Audit Trail</h2>
      <table id="auditTable"><tr><th>When</th><th>Action</th><th>Target</th><th>Actor</th></tr></table>
    </div>

  </div>
</div>

<script>
const tokenKey = 'nodehouse_admin_token';
const legacyTokenKeys = ['packetbbs_admin_token', 'vibebbs_admin_token'];
let token = localStorage.getItem(tokenKey) || legacyTokenKeys.map(key => localStorage.getItem(key)).find(Boolean);
if (token && !localStorage.getItem(tokenKey)) localStorage.setItem(tokenKey, token);
legacyTokenKeys.forEach(key => localStorage.removeItem(key));
if (token) { showAdmin(); loadDashboard(); }

async function api(path, opts = {}) {
  opts.headers = { ...opts.headers, 'x-admin-token': token, 'Content-Type': 'application/json' };
  const r = await fetch('/admin/api/' + path, opts);
  if (r.status === 401) { doLogout(); return null; }
  return r.json();
}

async function doLogin() {
  const u = document.getElementById('loginUser').value;
  const p = document.getElementById('loginPass').value;
  try {
    const r = await fetch('/admin/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    const d = await r.json();
    if (d.token) { token = d.token; localStorage.setItem(tokenKey, token); showAdmin(); loadDashboard(); }
    else { document.getElementById('loginError').textContent = d.error || 'Login failed'; }
  } catch(e) { document.getElementById('loginError').textContent = 'Connection error'; }
}

function doLogout() {
  api('logout', { method: 'POST' });
  token = null; localStorage.removeItem(tokenKey); legacyTokenKeys.forEach(key => localStorage.removeItem(key));
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('admin').style.display = 'none';
}

function showAdmin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('admin').style.display = 'block';
}

function showPanel(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'dashboard') loadDashboard();
  if (name === 'users') loadUsers();
  if (name === 'messages') loadMessages();
  if (name === 'bulletins') loadBulletins();
  if (name === 'nodes') loadNodes();
  if (name === 'control') loadControlDesk();
}

async function loadDashboard() {
  const d = await api('stats');
  if (!d) return;
  document.getElementById('statsGrid').innerHTML =
    statCard('Users', d.totalUsers) + statCard('Messages', d.totalMessages) +
    statCard('Total Calls', d.totalCalls) + statCard('Nodes Online', d.nodesOnline + '/' + d.maxNodes) +
    statCard('Uptime', d.uptime);
  let rows = '<tr><th>User</th><th>Node</th><th>Login</th><th>Logout</th></tr>';
  (d.recentCalls || []).forEach(c => {
    rows += '<tr><td>' + esc(c.username) + '</td><td>' + c.node_num + '</td><td>' + c.login_time + '</td><td>' + (c.logout_time || '<span class="online-dot">● online</span>') + '</td></tr>';
  });
  document.getElementById('recentCalls').innerHTML = rows;
}

function statCard(label, value) {
  return '<div class="stat-card"><div class="value">' + value + '</div><div class="label">' + label + '</div></div>';
}

async function loadUsers() {
  const users = await api('users');
  if (!users) return;
  let rows = '<tr><th>Username</th><th>Real Name</th><th>Level</th><th>Calls</th><th>Posts</th><th>Last Call</th><th>Actions</th></tr>';
  users.forEach(u => {
    rows += '<tr><td>' + esc(u.username) + '</td><td>' + esc(u.real_name||'') + '</td><td>' + u.access_level + '</td><td>' + u.total_calls + '</td><td>' + u.total_posts + '</td><td>' + (u.last_call_date||'Never') + '</td><td><button class="btn danger" onclick="deleteUser(' + u.id + ')">Del</button></td></tr>';
  });
  document.getElementById('usersTable').innerHTML = rows;
}

async function deleteUser(id) {
  if (!confirm('Delete this user?')) return;
  await api('users/' + id, { method: 'DELETE' });
  loadUsers();
}

async function loadMessages(baseId) {
  const bases = ${messageBases};
  let sel = '<select onchange="loadMsgBase(this.value)" style="background:#1a1a1a;border:1px solid #333;color:#00ff88;padding:5px;font-family:inherit;">';
  bases.forEach(b => { sel += '<option value="' + b.id + '"' + (b.id === (baseId||1) ? ' selected' : '') + '>' + b.name + '</option>'; });
  sel += '</select>';
  document.getElementById('msgBaseSelect').innerHTML = sel;
  loadMsgBase(baseId || 1);
}

async function loadMsgBase(baseId) {
  const msgs = await api('messages/' + baseId);
  if (!msgs) return;
  let rows = '<tr><th>ID</th><th>From</th><th>To</th><th>Subject</th><th>Date</th><th>Actions</th></tr>';
  msgs.forEach(m => {
    rows += '<tr><td>' + m.id + '</td><td>' + esc(m.from_user) + '</td><td>' + esc(m.to_user) + '</td><td>' + esc(m.subject) + '</td><td>' + m.created_at + '</td><td><button class="btn danger" onclick="deleteMsg(' + m.id + ')">Del</button></td></tr>';
  });
  document.getElementById('messagesTable').innerHTML = rows;
}

async function deleteMsg(id) {
  if (!confirm('Delete this message?')) return;
  await api('messages/' + id, { method: 'DELETE' });
  loadMessages();
}

async function loadBulletins() {
  const buls = await api('bulletins');
  if (!buls) return;
  let rows = '<tr><th>ID</th><th>Title</th><th>Author</th><th>Active</th><th>Date</th><th>Actions</th></tr>';
  buls.forEach(b => {
    rows += '<tr><td>' + b.id + '</td><td>' + esc(b.title) + '</td><td>' + esc(b.author) + '</td><td>' + (b.active ? '✓' : '✗') + '</td><td>' + b.created_at + '</td><td><button class="btn" onclick="toggleBul(' + b.id + ')">Toggle</button> <button class="btn danger" onclick="deleteBul(' + b.id + ')">Del</button></td></tr>';
  });
  document.getElementById('bulletinsTable').innerHTML = rows;
}

async function addBulletin() {
  const title = document.getElementById('bulTitle').value;
  const body = document.getElementById('bulBody').value;
  if (!title || !body) return;
  await api('bulletins', { method: 'POST', body: JSON.stringify({ title, body }) });
  document.getElementById('bulTitle').value = '';
  document.getElementById('bulBody').value = '';
  loadBulletins();
}

async function toggleBul(id) { await api('bulletins/' + id + '/toggle', { method: 'POST' }); loadBulletins(); }
async function deleteBul(id) { if (!confirm('Delete?')) return; await api('bulletins/' + id, { method: 'DELETE' }); loadBulletins(); }

async function loadNodes() {
  const nodes = await api('nodes');
  if (!nodes) return;
  let rows = '<tr><th>Node</th><th>User</th><th>Activity</th><th>Connected</th></tr>';
  nodes.forEach(n => {
    rows += '<tr><td>' + n.nodeNum + '</td><td>' + esc(n.username||'(logging in)') + '</td><td>' + esc(n.activity||'Idle') + '</td><td>' + n.connectedAt + '</td></tr>';
  });
  document.getElementById('nodesTable').innerHTML = rows;
}

async function loadControlDesk() {
  const results = await Promise.all([api('system/status'), api('community/porch'), api('audit?limit=50'), api('moderation'), api('community/profiles')]);
  const status = results[0], posts = results[1], audit = results[2], moderation = results[3], profiles = results[4];
  if (status && !status.error) {
    document.getElementById('systemStatus').innerHTML = statCard('Database', status.database ? 'ONLINE' : 'UNKNOWN') +
      statCard('Private Chats', status.activePrivateChats) + statCard('Pending Pages', status.pendingPages) +
      statCard('Memory', Math.round(status.memory.rss / 1048576) + ' MB');
  }
  if (Array.isArray(posts)) {
    let rows = '<tr><th>Type</th><th>Title</th><th>Caller</th><th>Status</th><th>Actions</th></tr>';
    posts.forEach(p => {
      rows += '<tr><td>' + esc(p.notice_type) + '</td><td>' + esc(p.title) + '</td><td>' +
        esc(p.author_username) + '</td><td>' + esc(p.status) + '</td><td>' +
        '<button class="btn" onclick="moderatePorch(' + p.id + ',\\'active\\')">Approve</button> ' +
        '<button class="btn danger" onclick="moderatePorch(' + p.id + ',\\'removed\\')">Remove</button></td></tr>';
    });
    document.getElementById('porchTable').innerHTML = rows;
  }
  if (Array.isArray(audit)) {
    let rows = '<tr><th>When</th><th>Action</th><th>Target</th><th>Actor ID</th></tr>';
    audit.forEach(e => { rows += '<tr><td>' + esc(e.created_at) + '</td><td>' + esc(e.action) +
      '</td><td>' + esc(e.target_type + (e.target_id ? ':' + e.target_id : '')) + '</td><td>' +
      esc(e.actor_user_id || 'system') + '</td></tr>'; });
    document.getElementById('auditTable').innerHTML = rows;
  }
  if (Array.isArray(moderation)) {
    let rows = '<tr><th>Target</th><th>Reason</th><th>State</th><th>Actions</th></tr>';
    moderation.forEach(m => { rows += '<tr><td>' + esc(m.target_type + ':' + m.target_id) + '</td><td>' +
      esc(m.reason) + '</td><td>' + esc(m.state) + '</td><td><button class="btn" onclick="resolveReport(' +
      m.id + ',\\'resolved\\')">Resolve</button> <button class="btn danger" onclick="resolveReport(' + m.id +
      ',\\'dismissed\\')">Dismiss</button></td></tr>'; });
    document.getElementById('moderationTable').innerHTML = rows;
  }
  if (Array.isArray(profiles)) {
    let rows = '<tr><th>Caller</th><th>Name</th><th>Interests</th><th>Visible</th><th>Actions</th></tr>';
    profiles.forEach(p => { rows += '<tr><td>' + esc(p.username) + '</td><td>' + esc(p.display_name) + '</td><td>' +
      esc(p.interests) + '</td><td>' + (p.profile_visible ? 'yes' : 'no') + '</td><td>' +
      (p.profile_visible ? '<button class="btn" onclick="setProfileVisibility(' + p.user_id + ',false)">Hide</button>' : '—') +
      '</td></tr>'; });
    document.getElementById('profilesTable').innerHTML = rows;
  }
}

async function moderatePorch(id, state) {
  await api('community/porch/' + id + '/moderate', { method: 'POST', body: JSON.stringify({ state }) });
  loadControlDesk();
}

async function resolveReport(id, state) {
  await api('moderation/' + id, { method: 'POST', body: JSON.stringify({ state }) });
  loadControlDesk();
}

async function setProfileVisibility(userId, visible) {
  await api('community/profiles/' + userId + '/visibility', {
    method: 'POST', body: JSON.stringify({ visible: visible })
  });
  loadControlDesk();
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
</script>
</body>
</html>`;
}

module.exports = { setupAdminPanel };
