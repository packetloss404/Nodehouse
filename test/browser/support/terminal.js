'use strict';

// Helpers for driving the real browser terminal (xterm.js) in Playwright.
// The terminal instance is a top-level `const term` in index.html, so it lives
// in the page's global lexical scope and is reachable from page.evaluate.

const { expect } = require('@playwright/test');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toGlobalRegex(pattern) {
  const source = pattern instanceof RegExp ? pattern.source : escapeRegExp(pattern);
  return new RegExp(source, 'g');
}

// Reads the full xterm buffer (viewport + scrollback) as plain text.
async function readTerminal(page) {
  return page.evaluate(() => {
    const buffer = term.buffer.active;
    const lines = [];
    for (let i = 0; i < buffer.length; i += 1) {
      const line = buffer.getLine(i);
      lines.push(line ? line.translateToString(true) : '');
    }
    return lines.join('\n');
  });
}

async function countOccurrences(page, pattern) {
  const text = await readTerminal(page);
  return (text.match(toGlobalRegex(pattern)) || []).length;
}

async function waitForTerminalText(page, pattern, timeout = 15000) {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(escapeRegExp(pattern));
  const deadline = Date.now() + timeout;
  let text = '';
  for (;;) {
    text = await readTerminal(page);
    if (regex.test(text)) return text;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${regex} in the terminal.\n--- buffer tail ---\n${text.slice(-3000)}`);
    }
    await page.waitForTimeout(150);
  }
}

// Waits until `pattern` has appeared more times than `previous` (the count
// captured before the action). Robust against scrollback and screen clears.
async function waitForMoreOccurrences(page, pattern, previous, timeout = 15000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const count = await countOccurrences(page, pattern);
    if (count > previous) return count;
    if (Date.now() > deadline) {
      const text = await readTerminal(page);
      throw new Error(`Timed out waiting for another ${pattern}.\n--- buffer tail ---\n${text.slice(-3000)}`);
    }
    await page.waitForTimeout(150);
  }
}

async function typeLine(page, value) {
  await page.locator('.xterm-screen').click();
  if (value) await page.keyboard.type(value, { delay: 5 });
  await page.keyboard.press('Enter');
}

// The browser terminal is reached by a deliberate dial-in step; no session
// exists until the caller takes it.
async function openTerminal(page, baseUrl) {
  await page.goto(baseUrl + '/');
  await page.locator('#dialinBtn').click();
  await expect(page.locator('#status')).toHaveText('Connected', { timeout: 20000 });
  return page;
}

// Logs into the web terminal as the given caller and waits for the main prompt.
async function terminalLogin(page, username, password) {
  await waitForTerminalText(page, /Username: /);
  await typeLine(page, username);
  await waitForTerminalText(page, /Password: /);
  await typeLine(page, password);
  await waitForTerminalText(page, /SINCE YOUR LAST CALL/);
  await typeLine(page, '');
  await waitForTerminalText(page, /Message of the Day|Main command \(/);
  const text = await readTerminal(page);
  if (/Message of the Day/.test(text)) {
    await typeLine(page, '');
  }
  await waitForTerminalText(page, /Main command \(/);
  return page;
}

async function expectTerminalText(page, pattern) {
  await expect.poll(() => readTerminal(page)).toMatch(pattern);
}

module.exports = {
  readTerminal,
  countOccurrences,
  waitForTerminalText,
  waitForMoreOccurrences,
  typeLine,
  openTerminal,
  terminalLogin,
  expectTerminalText,
};
