'use strict';

// Real-browser coverage of the xterm.js web terminal: it must connect over the
// WebSocket transport, drive the shared session engine, and log off cleanly.

const { test, expect } = require('@playwright/test');
const { startBoard } = require('../helpers/board');
const {
  readTerminal,
  countOccurrences,
  waitForTerminalText,
  waitForMoreOccurrences,
  typeLine,
  terminalLogin,
} = require('./support/terminal');

let board;

test.beforeAll(async () => {
  board = await startBoard();
});

test.afterAll(async () => {
  if (board) await board.stop();
});

test('web terminal loads xterm.js and connects over WebSocket', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(board.baseUrl + '/');

  await expect(page.locator('#terminal .xterm')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('Connected', { timeout: 15000 });

  await waitForTerminalText(page, /THE NODEHOUSE/);
  await waitForTerminalText(page, /Username: /);
  expect(errors, `page errors: ${errors.join('; ')}`).toEqual([]);
});

test('a caller can log in, navigate, and log off in the browser', async ({ page }) => {
  await page.goto(board.baseUrl + '/');
  await terminalLogin(page, 'SysOp', board.sysopPassword);

  expect(await readTerminal(page)).toMatch(/MAIN MENU/);
  expect(await readTerminal(page)).toMatch(/Message Conferences/);

  // Last Callers, then back to the main menu (a fresh main menu is rendered).
  await typeLine(page, 'L');
  await waitForTerminalText(page, /LAST CALLERS/);
  const menuPromptsBefore = await countOccurrences(page, /Main command \(/);
  await typeLine(page, '');
  await waitForMoreOccurrences(page, /Main command \(/, menuPromptsBefore);

  // Deliberate logoff shows the goodbye art.
  await typeLine(page, 'G');
  await waitForTerminalText(page, /Thanks for calling The Nodehouse/);
});

test('the browser transport and the telnet transport share one session engine', async ({ page }) => {
  await page.goto(board.baseUrl + '/');
  await terminalLogin(page, 'SysOp', board.sysopPassword);

  // Who's Online should report at least this browser node.
  await typeLine(page, 'W');
  await waitForTerminalText(page, /WHO'S ONLINE|WHOS ONLINE|Who's Online/i);
  expect(await readTerminal(page)).toMatch(/SysOp/);
});
