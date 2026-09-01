// SysOp Admin Panel - Web-based administration for The Nodehouse
const express = require('express');
const db = require('../core/database');
const { createExpressRateLimit } = require('../server/guardrails');

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_ADMIN_PASSWORD_LENGTH = 8;

function setupAdminPanel(app, nodeManager, config) {
  const ADMIN_SESSIONS = new Map();
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
    const expiresAt = ADMIN_SESSIONS.get(token);
    if (expiresAt && expiresAt > Date.now()) {
      next();
    } else {
      if (token) ADMIN_SESSIONS.delete(token);
      res.status(401).json({ error: 'Unauthorized' });
    }
  }

  // ─── Auth ───
  app.post('/admin/api/login', loginRateLimit, (req, res) => {
    const { username, password } = req.body;
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const user = db.users.authenticate(username, password);
    if (user && user.access_level >= 200) {
      const token = generateToken();
      ADMIN_SESSIONS.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
      res.json({ token, username: user.username });
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
  app.get('/admin/api/users', requireAuth, (req, res) => {
    res.json(db.users.getAll());
  });

  app.get('/admin/api/users/:id', requireAuth, (req, res) => {
    const user = db.users.getById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password_hash, password_salt, ...safe } = user;
    res.json(safe);
  });

  app.put('/admin/api/users/:id', requireAuth, (req, res) => {
    db.users.update(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  });

  app.delete('/admin/api/users/:id', requireAuth, (req, res) => {
    db.users.delete(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.post('/admin/api/users/:id/reset-password', requireAuth, (req, res) => {
    if (typeof req.body.password !== 'string' || req.body.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `Password must be at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`,
      });
    }
    db.users.resetPassword(parseInt(req.params.id), req.body.password);
    res.json({ ok: true });
  });

  // ─── Messages ───
  app.get('/admin/api/messages/:baseId', requireAuth, (req, res) => {
    res.json(db.messages.getByBase(parseInt(req.params.baseId)));
  });

  app.delete('/admin/api/messages/:id', requireAuth, (req, res) => {
    db.messages.delete(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ─── Bulletins ───
  app.get('/admin/api/bulletins', requireAuth, (req, res) => {
    res.json(db.bulletins.getAll());
  });

  app.post('/admin/api/bulletins', requireAuth, (req, res) => {
    db.bulletins.create(req.body.title, req.body.body, req.body.author || 'SysOp');
    res.json({ ok: true });
  });

  app.delete('/admin/api/bulletins/:id', requireAuth, (req, res) => {
    db.bulletins.delete(parseInt(req.params.id));
    res.json({ ok: true });
  });

  app.post('/admin/api/bulletins/:id/toggle', requireAuth, (req, res) => {
    db.bulletins.toggle(parseInt(req.params.id));
    res.json({ ok: true });
  });

  // ─── Nodes ───
  app.get('/admin/api/nodes', requireAuth, (req, res) => {
    res.json(nodeManager.getOnlineUsers());
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

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
</script>
</body>
</html>`;
}

module.exports = { setupAdminPanel };
