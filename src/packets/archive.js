'use strict';

const zlib = require('zlib');

const DEFAULT_LIMITS = Object.freeze({ entries: 64, entryBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024 });
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function safeName(name) {
  if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 120) throw new Error('Invalid archive filename.');
  if (name.includes('\\') || name.includes('/') || name.includes('\0') || name === '.' || name === '..') {
    throw new Error('Archive paths are not allowed.');
  }
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

function createZip(entries, limits = DEFAULT_LIMITS) {
  if (!Array.isArray(entries) || entries.length > limits.entries) throw new Error('Too many archive entries.');
  const locals = [];
  const centrals = [];
  let offset = 0;
  let total = 0;

  for (const item of entries) {
    const name = Buffer.from(safeName(item.name), 'ascii');
    const body = Buffer.isBuffer(item.data) ? item.data : Buffer.from(String(item.data), 'utf8');
    total += body.length;
    if (body.length > limits.entryBytes || total > limits.totalBytes) throw new Error('Archive content is too large.');
    const compressed = zlib.deflateRawSync(body, { level: 9 });
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(body.length, 22); local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function readZip(input, limits = DEFAULT_LIMITS) {
  const data = Buffer.from(input);
  if (data.length > limits.totalBytes * 2) throw new Error('Archive is too large.');
  const endOffset = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endOffset < 0 || endOffset + 22 > data.length) throw new Error('Invalid ZIP archive.');
  const count = data.readUInt16LE(endOffset + 10);
  let cursor = data.readUInt32LE(endOffset + 16);
  if (count > limits.entries) throw new Error('Too many archive entries.');
  const output = new Map();
  let total = 0;

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory.');
    const flags = data.readUInt16LE(cursor + 8);
    const method = data.readUInt16LE(cursor + 10);
    const expectedCrc = data.readUInt32LE(cursor + 16);
    const packedSize = data.readUInt32LE(cursor + 20);
    const size = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    if (flags & 1 || ![0, 8].includes(method) || size > limits.entryBytes || packedSize > limits.entryBytes) {
      throw new Error('Unsupported or oversized ZIP entry.');
    }
    const name = safeName(data.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    if (output.has(name)) throw new Error('Duplicate archive entry.');
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP entry.');
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    if (start + packedSize > data.length) throw new Error('Truncated ZIP entry.');
    const packed = data.subarray(start, start + packedSize);
    const body = method === 8 ? zlib.inflateRawSync(packed, { maxOutputLength: limits.entryBytes }) : Buffer.from(packed);
    if (body.length !== size || crc32(body) !== expectedCrc) throw new Error('Corrupt ZIP entry.');
    total += body.length;
    if (total > limits.totalBytes) throw new Error('Archive expands beyond its limit.');
    output.set(name, body);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return output;
}

module.exports = { createZip, readZip, safeName, crc32, DEFAULT_LIMITS };
