'use strict';

const express = require('express');
const { MAX_UPLOAD_BYTES } = require('../services/packet-service');
const { MAX_UPLOAD_BYTES: MAX_FILE_BYTES } = require('../services/file-service');

function noStore(res) {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
}

function setupTransferRoutes(app, packetService, fileService) {
  const router = express.Router();

  router.get('/packet/:format/:token', (req, res) => {
    noStore(res);
    try {
      if (!['briefcase', 'qwk'].includes(req.params.format)) return res.status(404).send('Not found.');
      const download = packetService.consumeDownload(req.params.token, req.params.format);
      if (!download) return res.status(404).send('Transfer expired or already used.');
      res.set('Content-Type', download.mime);
      res.set('Content-Disposition', `attachment; filename="${download.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
      res.once('finish', download.complete);
      return res.send(download.content);
    } catch {
      return res.status(400).send('Invalid packet transfer.');
    }
  });

  router.post('/packet/:format/:token', express.raw({ type: '*/*', limit: MAX_UPLOAD_BYTES }), (req, res) => {
    noStore(res);
    try {
      if (!['briefcase', 'rep'].includes(req.params.format)) return res.status(404).json({ error: 'Not found.' });
      const result = packetService.consumeUpload(req.params.token, req.params.format, req.body);
      if (!result) return res.status(404).json({ error: 'Transfer expired or already used.' });
      return res.json({ ok: true, imported: result.imported });
    } catch {
      return res.status(400).json({ error: 'Packet rejected. It may be invalid, expired, or already imported.' });
    }
  });

  // File library: uploads land in quarantine; downloads are one-use links.
  router.post('/file/upload/:areaId/:token', express.raw({ type: '*/*', limit: MAX_FILE_BYTES }), (req, res) => {
    noStore(res);
    try {
      const result = fileService.consumeUpload(req.params.token, Number(req.params.areaId), req.body);
      if (!result) return res.status(404).json({ error: 'Transfer expired or already used.' });
      return res.status(201).json({
        ok: true,
        file: { id: result.file.id, filename: result.file.filename, state: result.file.state },
      });
    } catch {
      return res.status(400).json({ error: 'Upload rejected.' });
    }
  });

  router.get('/file/download/:fileId/:token', (req, res) => {
    noStore(res);
    try {
      const download = fileService.consumeDownload(req.params.token, Number(req.params.fileId));
      if (!download) return res.status(404).send('Transfer expired or already used.');
      res.set('Content-Type', download.mime);
      res.set('Content-Disposition', `attachment; filename="${download.filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
      return res.sendFile(download.path);
    } catch {
      return res.status(400).send('Invalid transfer.');
    }
  });

  app.use('/transfers', router);
  return router;
}

module.exports = { setupTransferRoutes };
