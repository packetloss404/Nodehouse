// Telnet server for The Nodehouse
const net = require('net');
const BBSSession = require('../core/bbs');
const { FixedWindowLimiter, getSocketAddress } = require('./guardrails');
const { getPendingLimiter } = require('./pending-limiter');

// How often the idle governor checks a session. Tests shorten this.
const IDLE_TICK_MS = Math.max(100, Number(process.env.NODEHOUSE_IDLE_TICK_MS) || 10000);

function createTelnetServer(nodeManager, config, services = {}) {
  const connectionLimiter = new FixedWindowLimiter({ max: 30, windowMs: 60 * 1000 });
  const loginFailureLimiter = new FixedWindowLimiter({ max: 12, windowMs: 15 * 60 * 1000 });
  const registrationLimiter = new FixedWindowLimiter({ max: 3, windowMs: 60 * 60 * 1000 });
  const pendingLimiter = getPendingLimiter();

  const server = net.createServer((socket) => {
    if (services.maintenance && services.maintenance.draining) {
      socket.end('The Nodehouse is in maintenance. Please call back shortly.\r\n');
      return;
    }
    const connectionKey = getSocketAddress(socket);
    const connectionResult = connectionLimiter.consume(connectionKey);
    if (!connectionResult.allowed) {
      socket.end('Too many connections. Please try again later.\r\n');
      return;
    }

    if (!pendingLimiter.acquire(connectionKey)) {
      socket.end('Too many pending connections from your address. Please try again shortly.\r\n');
      return;
    }
    let pendingReleased = false;
    const releasePending = () => {
      if (pendingReleased) return;
      pendingReleased = true;
      pendingLimiter.release(connectionKey);
    };

    socket.setEncoding(null); // Raw binary
    socket.setNoDelay(true);

    const nodeNum = nodeManager.allocateNode(null);
    if (nodeNum === null) {
      socket.write('Sorry, all nodes are busy. Please try again later!\r\n');
      socket.end();
      releasePending();
      return;
    }

    // Send Telnet negotiations: suppress go-ahead, echo
    socket.write(Buffer.from([
      0xFF, 0xFB, 0x01, // IAC WILL ECHO
      0xFF, 0xFB, 0x03, // IAC WILL SUPPRESS-GO-AHEAD
      0xFF, 0xFD, 0x03, // IAC DO SUPPRESS-GO-AHEAD
    ]));

    const transport = {
      write(data) { socket.write(data); },
      end() { socket.end(); },
    };

    const session = new BBSSession(transport, nodeNum, nodeManager, {
      ...services,
      transport: 'telnet',
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
    socket.on('data', (data) => {
      session.handleData(data);
    });

    socket.on('close', () => {
      if (idleTick) clearInterval(idleTick);
      releasePending();
      session.disconnect();
    });

    socket.on('error', () => {
      if (idleTick) clearInterval(idleTick);
      releasePending();
      session.disconnect();
    });

    // Idle governor: a short leash before the caller identifies, a longer one
    // once they are logged in, with a warning before the line drops.
    idleTick = setInterval(() => {
      if (session.sessionEnded) { clearInterval(idleTick); return; }
      if (session.isIdleExpired()) {
        socket.write('\r\n\r\nIdle timeout - disconnecting.\r\n');
        session.disconnect('idle');
        socket.end();
        clearInterval(idleTick);
        return;
      }
      if (session.shouldWarnIdle()) session.warnIdle();
    }, IDLE_TICK_MS);
    idleTick.unref?.();
  });

  return server;
}

module.exports = { createTelnetServer };
