'use strict';

const { createZip, readZip } = require('./archive');

const BLOCK = 128;
const EOL = 0xe3;
const MAX_MESSAGES = 100;
const MAX_BODY = 32 * 1024;

function field(buffer, offset, length, value) {
  buffer.fill(0x20, offset, offset + length);
  Buffer.from(String(value ?? '').replace(/[^\x20-\x7e]/g, '?'), 'ascii').copy(buffer, offset, 0, length);
}

function qwkBody(text) {
  const normalized = String(text ?? '').replace(/\0/g, '').replace(/\r?\n/g, String.fromCharCode(EOL));
  const raw = Buffer.from(normalized, 'latin1');
  const size = Math.ceil(raw.length / BLOCK) * BLOCK;
  const result = Buffer.alloc(Math.max(BLOCK, size), 0x20);
  raw.copy(result);
  return result;
}

function messageRecord(message, conferenceNumber) {
  const body = qwkBody(message.body);
  const header = Buffer.alloc(BLOCK, 0x20);
  const created = message.created_at ? new Date(`${message.created_at}Z`) : new Date();
  const stamp = Number.isNaN(created.valueOf()) ? new Date() : created;
  const date = `${String(stamp.getUTCMonth() + 1).padStart(2, '0')}-${String(stamp.getUTCDate()).padStart(2, '0')}-${String(stamp.getUTCFullYear()).slice(-2)}`;
  const time = `${String(stamp.getUTCHours()).padStart(2, '0')}:${String(stamp.getUTCMinutes()).padStart(2, '0')}`;
  field(header, 0, 1, ' '); field(header, 1, 7, message.id || 0); field(header, 8, 8, date); field(header, 16, 5, time);
  field(header, 21, 25, message.to_user || 'All'); field(header, 46, 25, message.from_user || 'SysOp'); field(header, 71, 25, message.subject);
  field(header, 108, 8, message.reply_to || 0); field(header, 116, 6, 1 + (body.length / BLOCK));
  header[122] = 0xe1; header.writeUInt16LE(conferenceNumber, 123); header[127] = 0x20;
  return Buffer.concat([header, body]);
}

function exportQwk({ bbs = 'NODEHOUSE', city = '', phone = '', sysop = 'SysOp', user, conferences = [], messages = [] }) {
  const safeConferences = conferences.slice(0, 255).map((conference, index) => {
    const id = Number(conference.id);
    const number = Number.isSafeInteger(id) && id > 0 && id <= 65535 ? id : index + 1;
    return { id, number, name: String(conference.name || `Conference ${conference.id}`).slice(0, 12) };
  });
  const conferenceById = new Map(safeConferences.map(item => [item.id, item]));
  const control = [bbs, city, phone, sysop, '00000,Nodehouse', new Date().toISOString().slice(0, 10), user || '', '', '0', String(safeConferences.length - 1)];
  for (const conference of safeConferences) control.push(String(conference.number), conference.name);
  control.push('HELLO', 'NEWS', 'GOODBYE');

  const header = Buffer.alloc(BLOCK, 0x20);
  field(header, 0, 128, `${bbs} QWK packet for ${user}`);
  const records = [header];
  for (const message of messages.slice(0, 2000)) {
    const conference = conferenceById.get(Number(message.base_id));
    if (conference) records.push(messageRecord(message, conference.number));
  }
  const entries = [
    { name: 'CONTROL.DAT', data: `${control.join('\r\n')}\r\n` },
    { name: 'MESSAGES.DAT', data: Buffer.concat(records) },
    { name: 'DOOR.ID', data: 'DOOR = NODEHOUSE\r\nVERSION = 1\r\nSYSTEM = Nodehouse\r\nCONTROLTYPE = ADD\r\n' },
  ];
  return createZip(entries, { entries: 16, entryBytes: 4 * 1024 * 1024, totalBytes: 8 * 1024 * 1024 });
}

function textAt(buffer, offset, length) {
  return cleanReplyText(buffer.subarray(offset, offset + length).toString('latin1'))
    .replace(/[ ]+$/g, '').trim();
}

function cleanReplyText(value) {
  return String(value ?? '')
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|P[^\x1b]*(?:\x1b\\)?|.)/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}

function importRep(archive, conferenceMap) {
  const entries = readZip(archive, { entries: 16, entryBytes: 2 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 });
  const messages = entries.get('MESSAGES.DAT');
  if (!messages || messages.length < BLOCK || messages.length % BLOCK !== 0) throw new Error('Invalid REP MESSAGES.DAT.');
  const allowed = conferenceMap instanceof Map ? conferenceMap : new Map(Object.entries(conferenceMap || {}).map(([key, value]) => [Number(key), Number(value)]));
  const replies = [];
  let block = 1;
  while (block < messages.length / BLOCK) {
    if (replies.length >= MAX_MESSAGES) throw new Error('Too many REP replies.');
    const offset = block * BLOCK;
    const count = Number.parseInt(textAt(messages, offset + 116, 6), 10);
    const conferenceNumber = messages.readUInt16LE(offset + 123);
    if (!Number.isSafeInteger(count) || count < 2 || block + count > messages.length / BLOCK) throw new Error('Invalid REP message length.');
    const baseId = allowed.get(conferenceNumber);
    if (!baseId) throw new Error('REP targets an unknown conference.');
    const rawBody = messages.subarray(offset + BLOCK, offset + (count * BLOCK));
    const body = cleanReplyText(rawBody.toString('latin1').replace(/[ \0]+$/g, '')
      .replaceAll(String.fromCharCode(EOL), '\r\n')).slice(0, MAX_BODY).trim();
    const subject = textAt(messages, offset + 71, 25).slice(0, 80);
    const replyToText = textAt(messages, offset + 108, 8);
    const replyTo = /^\d+$/.test(replyToText) && Number(replyToText) > 0 ? Number(replyToText) : null;
    if (!subject || !body) throw new Error('REP contains an empty reply.');
    replies.push({ baseId, subject, body, replyTo });
    block += count;
  }
  return replies;
}

module.exports = { exportQwk, importRep, BLOCK, EOL, MAX_MESSAGES, MAX_BODY };
