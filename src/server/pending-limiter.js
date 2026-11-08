'use strict';

// Caps unauthenticated connections per source address, shared across the
// Telnet and WebSocket listeners. Without it, one address can occupy every
// node by opening sockets and sitting at the login prompt.
class PendingLimiter {
  constructor({ perIp = 2 } = {}) {
    this.perIp = Math.max(1, Number(perIp) || 2);
    this.counts = new Map();
  }

  acquire(key) {
    const k = key || 'unknown';
    const count = this.counts.get(k) || 0;
    if (count >= this.perIp) return false;
    this.counts.set(k, count + 1);
    return true;
  }

  release(key) {
    const k = key || 'unknown';
    const count = this.counts.get(k) || 0;
    if (count <= 1) this.counts.delete(k);
    else this.counts.set(k, count - 1);
  }

  count(key) {
    return this.counts.get(key || 'unknown') || 0;
  }
}

let shared = null;

function getPendingLimiter() {
  if (!shared) {
    shared = new PendingLimiter({ perIp: Number(process.env.NODEHOUSE_PENDING_PER_IP) || 2 });
  }
  return shared;
}

module.exports = { PendingLimiter, getPendingLimiter };
