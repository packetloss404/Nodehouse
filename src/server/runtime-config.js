function parsePort(value, fallback, name) {
  const candidate = value === undefined || value === null || value === '' ? fallback : value;
  const port = Number(candidate);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function isProductionEnvironment(env = process.env) {
  return env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID);
}

function resolveRuntimeConfig(config, env = process.env) {
  const resolved = {
    host: env.HOST || '0.0.0.0',
    webPort: parsePort(env.PORT || env.NODEHOUSE_WEB_PORT || env.PACKETBBS_WEB_PORT, config.webPort, 'HTTP port'),
    telnetPort: parsePort(
      env.TELNET_PORT || env.NODEHOUSE_TELNET_PORT || env.PACKETBBS_TELNET_PORT || env.RAILWAY_TCP_APPLICATION_PORT,
      config.telnetPort,
      'Telnet port',
    ),
    production: isProductionEnvironment(env),
    trustProxy: env.TRUST_PROXY === '1' || Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_PROJECT_ID),
  };
  if (resolved.webPort === resolved.telnetPort) {
    throw new Error('HTTP and Telnet ports must be different.');
  }
  return resolved;
}

module.exports = {
  isProductionEnvironment,
  parsePort,
  resolveRuntimeConfig,
};
