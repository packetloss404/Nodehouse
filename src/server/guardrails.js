const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

class FixedWindowLimiter {
  constructor({ max, windowMs = DEFAULT_WINDOW_MS }) {
    if (!Number.isInteger(max) || max < 1) throw new Error('Rate-limit max must be a positive integer.');
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error('Rate-limit window must be positive.');
    this.max = max;
    this.windowMs = windowMs;
    this.entries = new Map();
  }

  consume(key, now = Date.now()) {
    const safeKey = key || 'unknown';
    let entry = this.entries.get(safeKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(safeKey, entry);
    }

    if (entry.count >= this.max) {
      return { allowed: false, retryAfterMs: Math.max(1, entry.resetAt - now) };
    }

    entry.count += 1;
    if (this.entries.size > 10000) this.prune(now);
    return { allowed: true, remaining: this.max - entry.count, retryAfterMs: 0 };
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

function normalizeAddress(value) {
  if (!value) return 'unknown';
  return String(value).replace(/^::ffff:/, '');
}

function getSocketAddress(socket) {
  return normalizeAddress(socket?.remoteAddress);
}

function getRequestAddress(request) {
  return normalizeAddress(request.ip || request.socket?.remoteAddress);
}

function createExpressRateLimit({ max, windowMs = DEFAULT_WINDOW_MS, message }) {
  const limiter = new FixedWindowLimiter({ max, windowMs });
  return (req, res, next) => {
    const result = limiter.consume(getRequestAddress(req));
    if (result.allowed) return next();
    res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    return res.status(429).json({ error: message || 'Too many requests. Please try again later.' });
  };
}

function parseAllowedOrigins(value) {
  return new Set(String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean));
}

function isAllowedWebSocketOrigin(
  request,
  configuredOrigins = process.env.NODEHOUSE_ALLOWED_ORIGINS || process.env.PACKETBBS_ALLOWED_ORIGINS,
) {
  const origin = request.headers.origin;
  if (!origin) return true;

  const allowedOrigins = parseAllowedOrigins(configuredOrigins);
  if (allowedOrigins.has(origin)) return true;

  try {
    const originUrl = new URL(origin);
    return originUrl.host.toLowerCase() === String(request.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

module.exports = {
  FixedWindowLimiter,
  createExpressRateLimit,
  getRequestAddress,
  getSocketAddress,
  isAllowedWebSocketOrigin,
  normalizeAddress,
  parseAllowedOrigins,
};
