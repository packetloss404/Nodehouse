'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'art', 'gallery');
const MAX_ART_BYTES = 256 * 1024;
// Gallery art may select colors, but cannot move the cursor, erase the screen,
// set a title, emit hyperlinks, or use device-control escape sequences.
const ALLOWED_CSI = /\x1b\[(?:[0-9]{0,3}(?:;[0-9]{0,3})*)?m/g;
const PALETTES = Object.freeze({
  '01_nodehouse': ['\x1b[96m', '\x1b[36m', '\x1b[95m'],
  '02_wire_city': ['\x1b[94m', '\x1b[96m', '\x1b[35m'],
  '03_sysop_den': ['\x1b[93m', '\x1b[33m', '\x1b[96m'],
  '04_packet_ship': ['\x1b[95m', '\x1b[96m', '\x1b[94m'],
});
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐' +
  '└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀' +
  'ÓßÔÒõÕµþÞÚÛÙýÝ¯´≡±‗¾¶§÷¸°¨·¹³²■ ';

function decodeCp437(buffer) {
  let value = '';
  for (const byte of buffer) value += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
  return value;
}

function parseSauce(buffer) {
  if (buffer.length < 128) return null;
  const record = buffer.subarray(buffer.length - 128);
  if (record.subarray(0, 7).toString('ascii') !== 'SAUCE00') return null;
  const text = (start, size) => record.subarray(start, start + size).toString('latin1').trim();
  const declaredSize = record.readUInt32LE(90);
  return {
    title: text(7, 35), author: text(42, 20), group: text(62, 20), date: text(82, 8),
    fileSize: Math.min(declaredSize, buffer.length - 128), dataType: record[94], fileType: record[95],
    width: record.readUInt16LE(96) || 80, height: record.readUInt16LE(98) || 0,
  };
}

function sanitizeAnsi(value) {
  const input = String(value);
  let output = '';
  for (let index = 0; index < input.length;) {
    const code = input.charCodeAt(index);
    if (code !== 0x1b) {
      if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) {
        output += input[index];
      }
      index += 1;
      continue;
    }
    if (input[index + 1] === '[') {
      let end = index + 2;
      while (end < input.length && !/[A-Za-z@`~]/.test(input[end])) end += 1;
      const sequence = input.slice(index, Math.min(end + 1, input.length));
      if (/^\x1b\[(?:[0-9]{0,3}(?:;[0-9]{0,3})*)?m$/.test(sequence)) output += sequence;
      index = Math.min(end + 1, input.length);
      continue;
    }
    if (input[index + 1] === ']') {
      const bell = input.indexOf('\x07', index + 2);
      const stringTerminator = input.indexOf('\x1b\\', index + 2);
      const endings = [bell < 0 ? Infinity : bell + 1, stringTerminator < 0 ? Infinity : stringTerminator + 2];
      index = Math.min(...endings, input.length);
      continue;
    }
    if (input[index + 1] === 'P') {
      const end = input.indexOf('\x1b\\', index + 2);
      index = end < 0 ? input.length : end + 2;
      continue;
    }
    index += Math.min(2, input.length - index);
  }
  return output;
}

function stripAnsi(value) { return String(value).replace(ALLOWED_CSI, ''); }

class AnsiGallery {
  constructor(root = DEFAULT_ROOT) {
    this.root = path.resolve(root);
  }

  list() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^[A-Za-z0-9_-]+\.ans$/i.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(entry => {
        const buffer = this.readBuffer(entry.name);
        const sauce = parseSauce(buffer);
        return {
          id: entry.name.slice(0, -4), filename: entry.name,
          title: sauce?.title || entry.name.slice(0, -4).replaceAll('_', ' '),
          author: sauce?.author || 'Nodehouse Art Department',
          group: sauce?.group || 'NODEHOUSE', width: sauce?.width || 80, height: sauce?.height || null,
          encoding: sauce ? 'CP437' : 'UTF-8',
        };
      });
  }

  read(id) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) throw new Error('Invalid artwork id.');
    const filename = `${id}.ans`;
    const buffer = this.readBuffer(filename);
    const sauce = parseSauce(buffer);
    const body = buffer.subarray(0, sauce ? sauce.fileSize : buffer.length);
    const content = (sauce ? decodeCp437(body) : body.toString('utf8')).replace(/\r?\n/g, '\r\n');
    let clean = sanitizeAnsi(content);
    for (const line of stripAnsi(clean).split('\r\n')) {
      if ([...line].length > 80) throw new Error('Artwork exceeds 80 columns.');
    }
    const palette = PALETTES[String(id)];
    if (palette && !clean.includes('\x1b[')) {
      clean = clean.split('\r\n').map((line, index) => `${palette[index % palette.length]}${line}`).join('\r\n');
    }
    return { id: String(id), metadata: sauce, content: clean.endsWith('\x1b[0m') ? clean : `${clean}\x1b[0m` };
  }

  readBuffer(filename) {
    const resolved = path.resolve(this.root, filename);
    if (path.dirname(resolved) !== this.root || !resolved.toLowerCase().endsWith('.ans')) throw new Error('Invalid artwork path.');
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_ART_BYTES) throw new Error('Artwork is too large.');
    return fs.readFileSync(resolved);
  }
}

module.exports = { AnsiGallery, parseSauce, sanitizeAnsi, stripAnsi, decodeCp437, MAX_ART_BYTES, DEFAULT_ROOT };
