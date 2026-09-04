// Telnet server for The Nodehouse
const net = require('net');
const BBSSession = require('../core/bbs');
const { FixedWindowLimiter, getSocketAddress } = require('./guardrails');

function createTelnetServer(nodeManager, config, services = {}) {
  const connectionLimiter = new FixedWindowLimiter({ max: 30, windowMs: 60 * 1000 });
  const loginFailureLimiter = new FixedWindowLimiter({ max: 12, windowMs: 15 * 60 * 1000 });
  const registrationLimiter = new FixedWindowLimiter({ max: 3, windowMs: 60 * 60 * 1000 });

  const server = net.createServer((socket) => {
    const connectionKey = getSocketAddress(socket);
    const connectionResult = connectionLimiter.consume(connectionKey);
    if (!connectionResult.allowed) {
      socket.end('Too many connections. Please try again later.\r\n');
      return;
    }

    socket.setEncoding(null); // Raw binary
    socket.setNoDelay(true);

    const nodeNum = nodeManager.allocateNode(null);
    if (nodeNum === null) {
      socket.write('Sorry, all nodes are busy. Please try again later!\r\n');
      socket.end();
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
      recordLoginFailure() {
        return loginFailureLimiter.consume(connectionKey).allowed;
      },
      consumeRegistration() {
        return registrationLimiter.consume(connectionKey).allowed;
      },
    });
    nodeManager.nodes.get(nodeNum).session = session;

    socket.on('data', (data) => {
      session.handleData(data);
    });

    socket.on('close', () => {
      session.disconnect();
    });

    socket.on('error', (err) => {
      session.disconnect();
    });

    // Idle timeout
    socket.setTimeout(config.idleTimeout * 1000);
    socket.on('timeout', () => {
      socket.write('\r\n\r\nIdle timeout - disconnecting.\r\n');
      session.disconnect();
      socket.end();
    });
  });

  return server;
}

module.exports = { createTelnetServer };
