// WebSocket server for The Nodehouse (browser terminal access)
const { WebSocketServer } = require('ws');
const BBSSession = require('../core/bbs');
const {
  FixedWindowLimiter,
  getSocketAddress,
  isAllowedWebSocketOrigin,
} = require('./guardrails');

function createWebSocketServer(httpServer, nodeManager, config) {
  const connectionLimiter = new FixedWindowLimiter({ max: 30, windowMs: 60 * 1000 });
  const loginFailureLimiter = new FixedWindowLimiter({ max: 12, windowMs: 15 * 60 * 1000 });
  const registrationLimiter = new FixedWindowLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
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

    const nodeNum = nodeManager.allocateNode(null);
    if (nodeNum === null) {
      ws.send('Sorry, all nodes are busy. Please try again later!\r\n');
      ws.close();
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
      recordLoginFailure() {
        return loginFailureLimiter.consume(connectionKey).allowed;
      },
      consumeRegistration() {
        return registrationLimiter.consume(connectionKey).allowed;
      },
    });
    nodeManager.nodes.get(nodeNum).session = session;

    ws.on('message', (data) => {
      const str = data.toString();
      session.handleData(str);
    });

    ws.on('close', () => {
      session.disconnect();
    });

    ws.on('error', () => {
      session.disconnect();
    });

    // Idle timeout via ping/pong
    let alive = true;
    ws.on('pong', () => { alive = true; });

    const interval = setInterval(() => {
      if (!alive) {
        session.disconnect();
        ws.terminate();
        clearInterval(interval);
        return;
      }
      alive = false;
      ws.ping();
    }, config.idleTimeout * 1000);

    ws.on('close', () => clearInterval(interval));
  });

  return wss;
}

module.exports = { createWebSocketServer };
