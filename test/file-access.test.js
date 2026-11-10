'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('file links enforce the selected area and current caller authorization', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-file-access-'));
  const previousDbPath = process.env.NODEHOUSE_DB_PATH;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODEHOUSE_DB_PATH = path.join(dir, 'nodehouse.db');
  process.env.NODE_ENV = 'test';
  const db = require('../src/core/database');
  const { FileService } = require('../src/services/file-service');
  t.after(() => {
    db.close();
    if (previousDbPath === undefined) delete process.env.NODEHOUSE_DB_PATH;
    else process.env.NODEHOUSE_DB_PATH = previousDbPath;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  db.init();

  const config = { fileAreas: [{ id: 1, accessLevel: 10 }, { id: 2, accessLevel: 200 }] };
  const files = new FileService({ database: db, config, root: path.join(dir, 'files') });
  const sysop = db.users.findByUsername('SysOp');
  const caller = db.users.create('FileReader', 'fixture-password');
  const upload = files.createUpload(sysop, { areaId: 2, filename: 'restricted.txt' });
  const { file } = files.consumeUpload(upload.token, 2, Buffer.from('restricted bytes'));
  files.approve(file.id);
  assert.equal(files.createDownload(caller, file.id, 1), null);
  assert.equal(files.createDownload(caller, file.id, 2), null);

  db.users.update(caller.id, { access_level: 200 });
  const elevated = db.users.getById(caller.id);
  assert.equal(files.createDownload(elevated, file.id, 1), null);
  const issued = files.createDownload(elevated, file.id, 2);
  assert.ok(issued);

  db.users.update(caller.id, { access_level: 10 });
  assert.equal(files.createDownload(elevated, file.id, 2), null);
  assert.equal(files.consumeDownload(issued.token, file.id), null);
  assert.equal(db.fileLibrary.get(file.id).download_count, 0);

  db.users.update(caller.id, { access_level: 200 });
  db.users.setState(caller.id, 'rejected');
  assert.equal(files.consumeDownload(issued.token, file.id), null);
  db.users.setState(caller.id, 'active');
  const download = files.consumeDownload(issued.token, file.id);
  assert.equal(fs.readFileSync(download.path, 'utf8'), 'restricted bytes');
  assert.equal(files.consumeDownload(issued.token, file.id), null);
  assert.equal(db.fileLibrary.get(file.id).download_count, 1);
});
