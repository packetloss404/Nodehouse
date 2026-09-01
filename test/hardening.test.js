const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const database = require('../src/core/database');
const {
  FixedWindowLimiter,
  isAllowedWebSocketOrigin,
} = require('../src/server/guardrails');
const {
  isProductionEnvironment,
  parsePort,
  resolveRuntimeConfig,
} = require('../src/server/runtime-config');

test('runtime configuration honors Railway and dedicated Telnet ports', () => {
  const runtime = resolveRuntimeConfig(
    { webPort: 8088, telnetPort: 2323 },
    {
      PORT: '9000',
      TELNET_PORT: '2444',
      RAILWAY_ENVIRONMENT_NAME: 'production',
    },
  );
  assert.deepEqual(runtime, {
    host: '0.0.0.0',
    webPort: 9000,
    telnetPort: 2444,
    production: true,
    trustProxy: true,
  });
  assert.equal(parsePort(undefined, 8088, 'HTTP port'), 8088);
  assert.equal(
    resolveRuntimeConfig(
      { webPort: 8088, telnetPort: 2323 },
      { PORT: '9000', RAILWAY_TCP_APPLICATION_PORT: '2555' },
    ).telnetPort,
    2555,
  );
  assert.throws(() => parsePort('70000', 8088, 'HTTP port'), /between 1 and 65535/);
  assert.throws(
    () => resolveRuntimeConfig({ webPort: 8088, telnetPort: 2323 }, { PORT: '9000', TELNET_PORT: '9000' }),
    /must be different/,
  );
  assert.equal(isProductionEnvironment({ RAILWAY_PROJECT_ID: 'project-id' }), true);
});

test('fresh production databases require a strong explicit SysOp password', () => {
  assert.throws(
    () => database.resolveBootstrapSysopPassword({ NODE_ENV: 'production' }),
    /requires NODEHOUSE_SYSOP_PASSWORD/,
  );
  assert.throws(
    () => database.resolveBootstrapSysopPassword({ NODEHOUSE_SYSOP_PASSWORD: 'short' }),
    /at least 12 characters/,
  );
  assert.equal(
    database.resolveBootstrapSysopPassword({ NODE_ENV: 'production', NODEHOUSE_SYSOP_PASSWORD: 'correct-horse-battery' }),
    'correct-horse-battery',
  );
  assert.equal(database.resolveBootstrapSysopPassword({ NODE_ENV: 'test' }), 'sysop');
  assert.equal(
    database.resolveDatabasePath({ RAILWAY_VOLUME_MOUNT_PATH: '/app/data' }),
    path.join('/app/data', 'nodehouse.db'),
  );
});

test('fixed-window guardrails reject excess attempts and recover after reset', () => {
  const limiter = new FixedWindowLimiter({ max: 2, windowMs: 1000 });
  assert.equal(limiter.consume('caller', 100).allowed, true);
  assert.equal(limiter.consume('caller', 200).allowed, true);
  const blocked = limiter.consume('caller', 300);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 800);
  assert.equal(limiter.consume('caller', 1100).allowed, true);
});

test('browser WebSockets accept same-origin and configured origins only', () => {
  const sameOrigin = { headers: { host: 'bbs.example.com', origin: 'https://bbs.example.com' } };
  const configured = { headers: { host: 'bbs.example.com', origin: 'https://terminal.example.net' } };
  const foreign = { headers: { host: 'bbs.example.com', origin: 'https://attacker.example' } };
  assert.equal(isAllowedWebSocketOrigin(sameOrigin), true);
  assert.equal(isAllowedWebSocketOrigin(configured, 'https://terminal.example.net'), true);
  assert.equal(isAllowedWebSocketOrigin(foreign), false);
  assert.equal(isAllowedWebSocketOrigin({ headers: { host: 'bbs.example.com' } }), true);
});

test('Railway config requires persistent data and listener health', () => {
  const railway = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8'));
  const compose = fs.readFileSync(path.join(__dirname, '..', 'compose.yaml'), 'utf8');
  assert.equal(railway.deploy.requiredMountPath, '/app/data');
  assert.equal(railway.deploy.numReplicas, 1);
  assert.equal(railway.deploy.healthcheckPath, '/healthz');
  assert.equal(railway.deploy.startCommand, 'npm start');
  assert.doesNotMatch(compose, /^\s+NODEHOUSE_DB_PATH:/m);
});
