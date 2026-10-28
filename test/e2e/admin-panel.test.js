'use strict';

// The SysOp panel is a single-page app served as one HTML document. Its inline
// script is generated from a template literal, so a stray escape character can
// ship a page that loads but never runs. This guards that regression without
// needing a browser (the Playwright suite also exercises it for real).

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { startBoard } = require('../helpers/board');

let board;

test.before(async () => {
  board = await startBoard();
});

test.after(async () => {
  if (board) await board.stop();
});

test('the admin panel document ships a parseable inline script', async () => {
  const response = await board.fetch('/admin');
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /SysOp Panel/);
  assert.match(html, /id="loginUser"/);
  assert.match(html, /id="admin"/);

  const start = html.indexOf('<script>');
  const end = html.indexOf('</script>', start);
  assert.ok(start !== -1 && end > start, 'expected an inline script block');
  const script = html.slice(start + '<script>'.length, end);
  assert.ok(script.includes('function doLogin'), 'expected the panel login handler');

  // Throws a SyntaxError if the generated JavaScript is malformed.
  assert.doesNotThrow(() => new vm.Script(script), 'admin inline script must parse');
});

test('the panel HTML escapes template placeholders instead of leaking them', async () => {
  const html = await (await board.fetch('/admin')).text();
  assert.doesNotMatch(html, /\$\{/, 'unresolved template placeholder leaked into the page');
});
