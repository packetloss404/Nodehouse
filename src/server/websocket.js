// WebSocket server for The Nodehouse (browser terminal access)
const { WebSocketServer } = require('ws');
const BBSSession = require('../core/bbs');
const {
  FixedWindowLimiter,
  getSocketAddress,
  isAllowedWebSocketOrigin,
} = require('./guardrails');
const { getPendingLimiter } = require('./pending-limiter');

// How often the idle governor checks a session. Tests shorten this.
const IDLE_TICK_MS = Math.max(100, Number(process.env.NODEHOUSE_IDLE_TICK_MS) || 10000);

function createWebSocketServer(httpServer, nodeManager, config, services = {}) {
  const connectionLimiter = new FixedWindowLimiter({ max: 30, windowMs: 60 * 1000 });
  const loginFailureLimiter = new FixedWindowLimiter({ max: 12, windowMs: 15 * 60 * 1000 });
  const registrationLimiter = new FixedWindowLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
  const pendingLimiter = getPendingLimiter();
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
    verifyClient({ req }, done) {
      if (!isAllowedWebSocketOrigin(req)) {
        done(false, 403, 'Forbidden origin');
        return;
      }
      done(true);
    },
  });

  wss.on('connection', (ws, request) => {
    const connectionKey = getSocketAddress(request.socket);
    if (!connectionLimiter.consume(connectionKey).allowed) {
      ws.close(1013, 'Too many connections');
      return;
    }

    if (!pendingLimiter.acquire(connectionKey)) {
      ws.send('Too many pending connections from your address. Please try again shortly.\r\n');
      ws.close();
      return;
    }
    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased) return;
      pendingReleased = true;
      pendingLimiter.release(connectionKey);
    };

    const nodeNum = nodeManager.allocateNode(null);
    if (nodeNum === null) {
      ws.send('Sorry, all nodes are busy. Please try again later!\r\n');
      ws.close();
      releasePending();
      return;
    }

    const transport = {
      write(data) {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      },
      end() {
        ws.close();
      },
    };

    const session = new BBSSession(transport, nodeNum, nodeManager, {
      ...services,
      transport: 'websocket',
      remoteAddr: connectionKey,
      onAuthenticated: releasePending,
      recordLoginFailure() {
        return loginFailureLimiter.consume(connectionKey).allowed;
      },
      consumeRegistration() {
        return registrationLimiter.consume(connectionKey).allowed;
      },
    });
    nodeManager.nodes.get(nodeNum).session = session;

    let idleTick = null;
    let interval = null;

    ws.on('message', (data) => {
      session.handleData(data.toString());
    });

    ws.on('close', () => {
      if (idleTick) clearInterval(idleTick);
      if (interval) clearInterval(interval);
      releasePending();
      session.disconnect();
    });

    ws.on('error', () => {
      if (idleTick) clearInterval(idleTick);
      if (interval) clearInterval(interval);
      releasePending();
      session.disconnect();
    });

    // Ping/pong keepalive for dead peers.
    let alive = true;
    ws.on('pong', () => { alive = true; });
    interval = setInterval(() => {
      if (!alive) {
        session.disconnect();
        ws.terminate();
        clearInterval(interval);
        return;
      }
      alive = false;
      ws.ping();
    }, Math.max(30000, (Number(config.idleTimeout) || 300) * 1000));

    // Idle governor: a short leash before the caller identifies, a longer one
    // once they are logged in, with a warning before the line drops.
    idleTick = setInterval(() => {
      if (session.sessionEnded) { clearInterval(idleTick); return; }
      if (session.isIdleExpired()) {
        session.disconnect('idle');
        ws.close();
        clearInterval(idleTick);
        return;
      }
      if (session.shouldWarnIdle()) session.warnIdle();
    }, IDLE_TICK_MS);
    idleTick.unref?.();
  });

  return wss;
}

module.exports = { createWebSocketServer };
