'use strict';

const { defineConfig } = require('@playwright/test');

// Real-browser tests for the web terminal and SysOp panel.
// Each spec boots its own Nodehouse instance on ephemeral ports, so specs can
// run in parallel workers without sharing state.
module.exports = defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.spec.js',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
});
