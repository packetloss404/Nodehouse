'use strict';

const { createZip, readZip } = require('./archive');

const FORMAT = 'nodehouse-briefcase';
const VERSION = 1;
const MAX_REPLIES = 100;
const MAX_BODY = 32 * 1024;

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|P[^\x1b]*(?:\x1b\\)?|.)/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
    .replace(/\r?\n/g, '\r\n').slice(0, max);
}

function exportBriefcase(payload) {
  const document = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    bbs: cleanText(payload.bbs || 'The Nodehouse', 80),
    user: cleanText(payload.user, 32),
    conferences: Array.isArray(payload.conferences) ? payload.conferences.slice(0, 100) : [],
    messages: Array.isArray(payload.messages) ? payload.messages.slice(0, 2000) : [],
    mail: Array.isArray(payload.mail) ? payload.mail.slice(0, 1000) : [],
    bulletins: Array.isArray(payload.bulletins) ? payload.bulletins.slice(0, 100) : [],
    replies: [],
  };
  return createZip([
    { name: 'README.TXT', data: 'Nodehouse Packet Briefcase\r\nEdit only the replies array in PACKET.JSON, then upload it on your next call.\r\n' },
    { name: 'PACKET.JSON', data: JSON.stringify(document, null, 2) },
  ]);
}

function importBriefcase(archive) {
  const entries = readZip(archive);
  const packet = entries.get('PACKET.JSON');
  if (!packet) throw new Error('PACKET.JSON is missing.');
  let document;
  try { document = JSON.parse(packet.toString('utf8')); } catch { throw new Error('PACKET.JSON is invalid.'); }
  if (document.format !== FORMAT || document.version !== VERSION || !Array.isArray(document.replies)) {
    throw new Error('Unsupported Packet Briefcase.');
  }
  if (document.replies.length > MAX_REPLIES) throw new Error('Too many packet replies.');
  return document.replies.map(reply => {
    const baseId = Number(reply.baseId);
    if (!Number.isSafeInteger(baseId) || baseId < 1) throw new Error('Invalid reply conference.');
    const subject = cleanText(reply.subject, 80).trim();
    const body = cleanText(reply.body, MAX_BODY).trim();
    const replyTo = reply.replyTo == null ? null : Number(reply.replyTo);
    if (!subject || !body || (replyTo !== null && (!Number.isSafeInteger(replyTo) || replyTo < 1))) {
      throw new Error('Invalid packet reply.');
    }
    return { baseId, subject, body, replyTo };
  });
}

module.exports = { exportBriefcase, importBriefcase, FORMAT, VERSION, MAX_REPLIES, MAX_BODY };
