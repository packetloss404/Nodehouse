'use strict';

// The gallery must decode CP437 (not CP850) and honour SAUCE iCE colours.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { AnsiGallery, decodeCp437 } = require('../src/services/ansi-gallery');

function sauceRecord({ size, flags }) {
  const record = Buffer.alloc(128, 0x20);
  record.write('SAUCE00', 0, 'ascii');
  record.writeUInt32LE(size, 90);
  record[94] = 1; // character data
  record[95] = 1; // ANSI
  record.writeUInt16LE(80, 96);
  record.writeUInt16LE(25, 98);
  record[105] = flags;
  return record;
}

test('CP437 decodes the box-drawing range that CP850 gets wrong', () => {
  const bytes = Buffer.from(Array.from({ length: 128 }, (_, index) => 0x80 + index));
  const text = decodeCp437(bytes);
  assert.equal(text.length, 128);
  assert.equal(text[0xb5 - 0x80], '╡');
  assert.equal(text[0xb6 - 0x80], '╢');
  assert.equal(text[0xc6 - 0x80], '╞');
  assert.equal(text[0xdd - 0x80], '▌');
  assert.equal(text[0xde - 0x80], '▐');
  assert.equal(text[0xff - 0x80], '\u00a0');
  assert.match(text, /[╔╗╚╝║═╬]/);
  assert.doesNotMatch(text, /[ÁÂÀ©]/);
});

test('SAUCE iCE colours become bright backgrounds and blink never renders', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-ansi-'));
  try {
    const body = Buffer.concat([
      Buffer.from('\x1b[5;44m', 'latin1'),
      Buffer.from([0xb5, 0xc6]),
      Buffer.from('\x1b[0m', 'latin1'),
    ]);
    fs.writeFileSync(path.join(dir, 'ice.ans'), Buffer.concat([
      body, sauceRecord({ size: body.length, flags: 1 }),
    ]));

    const art = new AnsiGallery(dir).read('ice');
    assert.match(art.content, /╡╞/);
    assert.match(art.content, /\x1b\[104m/);
    assert.doesNotMatch(art.content, /\x1b\[5;44m/);
    assert.doesNotMatch(art.content, /\x1b\[5[;m]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('without the iCE flag, blink is stripped and the background is kept', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-ansi-'));
  try {
    const body = Buffer.from('\x1b[5;44mplain\x1b[0m', 'latin1');
    fs.writeFileSync(path.join(dir, 'plain.ans'), Buffer.concat([
      body, sauceRecord({ size: body.length, flags: 0 }),
    ]));
    const art = new AnsiGallery(dir).read('plain');
    assert.match(art.content, /\x1b\[44m/);
    assert.doesNotMatch(art.content, /\x1b\[5[;m]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
