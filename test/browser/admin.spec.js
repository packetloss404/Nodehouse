'use strict';

// Real-browser coverage of the SysOp control desk (single-page admin app).

const { test, expect } = require('@playwright/test');
const { startBoard, login: telnetLogin } = require('../helpers/board');

let board;

test.beforeAll(async () => {
  board = await startBoard();
});

test.afterAll(async () => {
  if (board) await board.stop();
});

async function loginToPanel(page) {
  await page.goto(board.baseUrl + '/admin');
  await expect(page.locator('#loginScreen')).toBeVisible();
  await page.fill('#loginUser', 'SysOp');
  await page.fill('#loginPass', board.sysopPassword);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.locator('#admin')).toBeVisible();
}

function nav(page, label) {
  return page.locator('.nav button', { hasText: label });
}

test('the panel rejects a bad password and accepts the SysOp', async ({ page }) => {
  await page.goto(board.baseUrl + '/admin');
  await page.fill('#loginUser', 'SysOp');
  await page.fill('#loginPass', 'definitely-not-the-password');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.locator('#loginError')).toContainText(/Invalid credentials|failed/i);
  await expect(page.locator('#admin')).toBeHidden();

  await page.fill('#loginPass', board.sysopPassword);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.locator('#admin')).toBeVisible();
});

test('dashboard, users, messages, nodes, and control desk render live data', async ({ page }) => {
  // A real Telnet call must show up on the dashboard call log.
  const telnet = await board.connectTelnet();
  await telnetLogin(telnet, { username: 'SysOp', password: board.sysopPassword });
  await telnet.send('G');
  telnet.close();

  await loginToPanel(page);

  const stats = page.locator('#statsGrid');
  await expect(stats).toContainText('Users');
  await expect(stats).toContainText('Messages');
  await expect(stats).toContainText('Total Calls');
  await expect(stats).toContainText('Nodes Online');
  await expect(page.locator('#recentCalls')).toContainText('SysOp');

  await nav(page, 'Users').click();
  await expect(page.locator('#usersTable')).toContainText('SysOp');

  await nav(page, 'Messages').click();
  await expect(page.locator('#msgBaseSelect')).toBeVisible();
  await expect(page.locator('#messagesTable')).toContainText('Welcome');

  await nav(page, 'Nodes').click();
  await expect(page.locator('#nodesTable')).toContainText('Node');

  await nav(page, 'Control Desk').click();
  await expect(page.locator('#systemStatus')).toContainText('Database');
  await expect(page.locator('#auditTable')).toBeVisible();
});

test('a SysOp can create, toggle, and delete a bulletin from the panel', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await loginToPanel(page);
  await nav(page, 'Bulletins').click();

  const title = 'E2E Bulletin ' + Date.now();
  await page.fill('#bulTitle', title);
  await page.fill('#bulBody', 'Created by the real-browser test suite.');
  await page.getByRole('button', { name: 'Add Bulletin' }).click();

  const row = page.locator('#bulletinsTable tr', { hasText: title });
  await expect(row).toHaveCount(1);

  await row.getByRole('button', { name: 'Toggle' }).click();
  await expect(page.locator('#bulletinsTable tr', { hasText: title })).toHaveCount(1);

  await page.locator('#bulletinsTable tr', { hasText: title }).getByRole('button', { name: 'Del' }).click();
  await expect(page.locator('#bulletinsTable tr', { hasText: title })).toHaveCount(0);
});
