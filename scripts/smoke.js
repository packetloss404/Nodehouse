const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.join(__dirname, '..');
const SMOKE_TIMEOUT_MS = 15000;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(webUrl, child) {
  const healthUrl = new URL('/healthz', webUrl);
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child && child.exitCode !== null) {
      throw new Error(`The Nodehouse exited before becoming healthy (code ${child.exitCode}).`);
    }
    try {
      const response = await fetch(healthUrl);
      const body = await response.json();
      if (response.ok && body.status === 'ok' && body.database === 'ok') return body;
      lastError = new Error(`Health check returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error('Health check timed out.');
}

async function checkWebTerminal(webUrl) {
  const response = await fetch(new URL('/', webUrl));
  const body = await response.text();
  if (!response.ok || !body.includes('The Nodehouse') || !body.includes('/vendor/xterm.js')) {
    throw new Error(`Web terminal smoke failed with HTTP ${response.status}.`);
  }
}

function checkTelnet(host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let output = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Telnet banner timed out.'));
    }, 5000);

    socket.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('The Nodehouse') && output.includes('Username:')) {
        clearTimeout(timeout);
        socket.end();
        resolve();
      }
    });
    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function runLocalSmoke() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-smoke-'));
  const webPort = await getFreePort();
  let telnetPort = await getFreePort();
  while (telnetPort === webPort) telnetPort = await getFreePort();
  const webUrl = `http://127.0.0.1:${webPort}`;
  let logs = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      NODE_ENV: 'production',
      NODEHOUSE_DB_PATH: path.join(tempDir, 'nodehouse.db'),
      NODEHOUSE_SYSOP_PASSWORD: 'Nodehouse-Smoke-Password-2026',
      PORT: String(webPort),
      TELNET_PORT: String(telnetPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-12000); });
  child.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-12000); });

  try {
    const health = await waitForHealth(webUrl, child);
    await checkWebTerminal(webUrl);
    await checkTelnet('127.0.0.1', telnetPort);
    console.log(`Nodehouse local smoke passed (v${health.version}, HTTP ${webPort}, Telnet ${telnetPort}).`);
  } catch (error) {
    throw new Error(`${error.message}\n${logs}`);
  } finally {
    await stopChild(child);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runPublicSmoke(webUrl) {
  const telnetHost = process.env.NODEHOUSE_SMOKE_TELNET_HOST || process.env.NODEHOUSE_PUBLIC_TELNET_HOST ||
    process.env.PACKETBBS_SMOKE_TELNET_HOST || process.env.PACKETBBS_PUBLIC_TELNET_HOST;
  const telnetPort = Number(process.env.NODEHOUSE_SMOKE_TELNET_PORT || process.env.NODEHOUSE_PUBLIC_TELNET_PORT ||
    process.env.PACKETBBS_SMOKE_TELNET_PORT || process.env.PACKETBBS_PUBLIC_TELNET_PORT);
  if (!telnetHost || !Number.isInteger(telnetPort) || telnetPort < 1 || telnetPort > 65535) {
    throw new Error('Public smoke requires NODEHOUSE_SMOKE_TELNET_HOST and NODEHOUSE_SMOKE_TELNET_PORT.');
  }
  const health = await waitForHealth(webUrl);
  await checkWebTerminal(webUrl);
  await checkTelnet(telnetHost, telnetPort);
  console.log(`Nodehouse public smoke passed (v${health.version}, ${webUrl}, ${telnetHost}:${telnetPort}).`);
}

async function main() {
  const publicWebUrl = process.env.NODEHOUSE_SMOKE_WEB_URL || process.env.PACKETBBS_SMOKE_WEB_URL;
  const work = publicWebUrl ? runPublicSmoke(publicWebUrl) : runLocalSmoke();
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Nodehouse smoke timed out.')), SMOKE_TIMEOUT_MS);
    timer.unref();
  });
  await Promise.race([work, timeout]);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
