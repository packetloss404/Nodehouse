'use strict';

// Real-browser coverage of the dial-in web terminal: the landing ritual, the
// WebSocket connection, the shared session engine, and a clean logoff.

const { test, expect } = require('@playwright/test');
const { startBoard } = require('../helpers/board');
const {
  readTerminal,
  countOccurrences,
  waitForTerminalText,
  waitForMoreOccurrences,
  typeLine,
  openTerminal,
  terminalLogin,
} = require('./support/terminal');

let board;

test.beforeAll(async () => {
  board = await startBoard();
});

test.afterAll(async () => {
  if (board) await board.stop();
});

test('the dial-in screen is a deliberate step before any session exists', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(board.baseUrl + '/');

  // The landing screen is the front door; no terminal and no session yet.
  await expect(page.locator('#dialin')).toBeVisible();
  await expect(page.locator('#dialinBtn')).toHaveText(/dial in/i);
  await expect(page.locator('#terminal-container')).toBeHidden();
  await expect(page.locator('#status')).toHaveText('Off hook');

  await page.locator('#dialinBtn').click();

  await expect(page.locator('#status')).toHaveText('Connected', { timeout: 20000 });
  await expect(page.locator('#dialin')).toBeHidden();
  await expect(page.locator('#terminal-container')).toBeVisible();
  await expect(page.locator('#terminal .xterm')).toBeVisible();

  await waitForTerminalText(page, /THE NODEHOUSE/);
  await waitForTerminalText(page, /Username: /);
  expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
});

test('the terminal works with the public CDN blocked', async ({ page }) => {
  const cdnRequests = [];
  await page.route(/cdn\.jsdelivr\.net/, (route) => {
    cdnRequests.push(route.request().url());
    return route.abort();
  });

  await openTerminal(page, board.baseUrl);
  await waitForTerminalText(page, /THE NODEHOUSE/);
  await waitForTerminalText(page, /Username: /);

  // Every asset came from this board; nothing reached for the internet.
  expect(cdnRequests).toEqual([]);
});

test('a caller can dial in, log in, navigate, and log off in the browser', async ({ page }) => {
  await openTerminal(page, board.baseUrl);
  await terminalLogin(page, 'SysOp', board.sysopPassword);

  expect(await readTerminal(page)).toMatch(/MAIN MENU/);
  expect(await readTerminal(page)).toMatch(/Message Conferences/);

  // Last Callers, then back to the main menu (a fresh main menu is rendered).
  await typeLine(page, 'L');
  await waitForTerminalText(page, /LAST CALLERS/);
  const menuPromptsBefore = await countOccurrences(page, /Main command \(/);
  await typeLine(page, '');
  await waitForMoreOccurrences(page, /Main command \(/, menuPromptsBefore);

  // Deliberate logoff shows the goodbye art and drops the carrier.
  await typeLine(page, 'G');
  await waitForTerminalText(page, /Thanks for calling The Nodehouse/);
  await expect(page.locator('#status')).toHaveText('NO CARRIER', { timeout: 20000 });
  await expect(page.locator('#redial')).toBeVisible();
});

test('the browser transport and the telnet transport share one session engine', async ({ page }) => {
  await openTerminal(page, board.baseUrl);
  await terminalLogin(page, 'SysOp', board.sysopPassword);

  // Who's Online should report at least this browser node.
  await typeLine(page, 'W');
  await waitForTerminalText(page, /Who's Online/i);
  expect(await readTerminal(page)).toMatch(/SysOp/);
});
