// ═══════════════════════════════════════════════════════════
//  The Nodehouse, powered by Nodehouse
//  Hybrid Telnet + Web Terminal | Multi-Node | Persistent
// ═══════════════════════════════════════════════════════════

require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('./config.json');
const { version } = require('./package.json');
const db = require('./src/core/database');
const NodeManager = require('./src/server/node-manager');
const { createTelnetServer } = require('./src/server/telnet');
const { createWebSocketServer } = require('./src/server/websocket');
const { setupAdminPanel } = require('./src/admin/panel');
const { resolveRuntimeConfig } = require('./src/server/runtime-config');

const runtime = resolveRuntimeConfig(config);

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Ensure file area directories exist
for (const area of config.fileAreas) {
  const areaPath = path.join(__dirname, area.path);
  if (!fs.existsSync(areaPath)) fs.mkdirSync(areaPath, { recursive: true });
}

// Initialize database
db.init();

// Create node manager
const nodeManager = new NodeManager(config.maxNodes);
const startTime = Date.now();

// ─── Express app (serves web terminal + admin panel) ────
const app = express();
app.disable('x-powered-by');
if (runtime.trustProxy) app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

app.get('/healthz', (req, res) => {
  const databaseHealthy = db.healthCheck();
  res.set('Cache-Control', 'no-store');
  res.status(databaseHealthy ? 200 : 503).json({
    status: databaseHealthy ? 'ok' : 'unhealthy',
    service: 'nodehouse',
    version,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    database: databaseHealthy ? 'ok' : 'unavailable',
    nodesOnline: nodeManager.getOnlineCount(),
  });
});

// Serve the web terminal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'web', 'index.html'));
});

// Setup admin panel routes
setupAdminPanel(app, nodeManager, config);

// ─── HTTP server (for WebSocket upgrade + web terminal) ──
const httpServer = http.createServer(app);

// ─── WebSocket server ────────────────────────────────────
const webSocketServer = createWebSocketServer(httpServer, nodeManager, config);

// ─── Telnet server ───────────────────────────────────────
const telnetServer = createTelnetServer(nodeManager, config);

// ─── Start everything ────────────────────────────────────
telnetServer.listen(runtime.telnetPort, runtime.host, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║                  THE NODEHOUSE                   ║');
  console.log('  ║               powered by Nodehouse               ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Telnet server listening on ${runtime.host}:${runtime.telnetPort}`);
});

httpServer.listen(runtime.webPort, runtime.host, () => {
  const publicWebUrl = process.env.NODEHOUSE_PUBLIC_WEB_URL || process.env.PACKETBBS_PUBLIC_WEB_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null);
  const publicTelnetHost = process.env.NODEHOUSE_PUBLIC_TELNET_HOST ||
    process.env.PACKETBBS_PUBLIC_TELNET_HOST || process.env.RAILWAY_TCP_PROXY_DOMAIN;
  const publicTelnetPort = process.env.NODEHOUSE_PUBLIC_TELNET_PORT ||
    process.env.PACKETBBS_PUBLIC_TELNET_PORT || process.env.RAILWAY_TCP_PROXY_PORT;
  console.log(`  Web terminal:  ${publicWebUrl || `http://localhost:${runtime.webPort}`}`);
  console.log(`  Admin panel:   ${(publicWebUrl || `http://localhost:${runtime.webPort}`)}/admin`);
  console.log(`  Health check:  ${(publicWebUrl || `http://localhost:${runtime.webPort}`)}/healthz`);
  console.log(`  Telnet:        ${publicTelnetHost && publicTelnetPort
    ? `telnet ${publicTelnetHost} ${publicTelnetPort}`
    : `telnet localhost ${runtime.telnetPort}`}`);
  console.log('');
  console.log(`  Max nodes: ${config.maxNodes}`);
  console.log(`  SysOp: ${config.sysopName}`);
  if (!runtime.production) console.log('  Development SysOp default is enabled only for fresh development/test databases.');
  console.log('');
  console.log(`  ${config.bbsName} v${version} is online. Stay curious!`);
  console.log('');
});

// Graceful shutdown
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  Shutting down ${config.bbsName}...`);

  for (const client of webSocketServer.clients) client.terminate();
  webSocketServer.close();

  let openServers = 2;
  const finish = () => {
    openServers -= 1;
    if (openServers > 0) return;
    db.close();
    process.exit(0);
  };
  const forceExit = setTimeout(() => {
    db.close();
    process.exit(1);
  }, 10000);
  forceExit.unref();

  telnetServer.close(finish);
  httpServer.close(finish);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
