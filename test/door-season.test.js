'use strict';

// Door days roll at the configured local reset hour, not UTC midnight, and
// seasons rotate lazily on the first run of a day.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodehouse-door-day-'));
process.env.NODEHOUSE_DB_PATH = path.join(dir, 'nodehouse.db');
process.env.NODE_ENV = 'test';

const database = require('../src/core/database');
const config = require('../config.json');
const { doorDayKey } = database;

let db;

test.after(() => {
  if (db && db.open) db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the door day follows the configured reset hour, not UTC midnight', () => {
  assert.equal(doorDayKey(new Date(2026, 10, 9, 3, 30), 4), '2026-11-08');
  assert.equal(doorDayKey(new Date(2026, 10, 9, 4, 30), 4), '2026-11-09');
  assert.equal(doorDayKey(new Date(2026, 10, 9, 0, 30), 0), '2026-11-09');
  assert.equal(doorDayKey(new Date(2026, 11, 1, 2, 0), 4), '2026-11-30');
});

test('usage is recorded against the board day', () => {
  db = database.init();
  const user = database.users.create('DayCaller', 'long-enough-password');
  const run = database.doors.beginRun(user.id, 'vibe_wars', 5);
  assert.equal(run.allowed, true);
  const row = db.prepare("SELECT usage_date FROM door_usage WHERE user_id = ? AND door_key = 'vibe_wars'").get(user.id);
  assert.equal(row.usage_date, doorDayKey(new Date(), Number(config.doorResetHour) || 0));
});

test('a banked bonus turn is spent after the daily allowance', () => {
  if (!db || !db.open) db = database.init();
  const user = database.users.create('BonusCaller', 'long-enough-password');
  database.users.completeQuest(user.id);

  for (let run = 0; run < 5; run += 1) {
    assert.equal(database.doors.beginRun(user.id, 'token_tycoon', 5).allowed, true);
  }
  assert.equal(database.doors.beginRun(user.id, 'token_tycoon', 5).allowed, true, 'the bonus turn should be spent');
  assert.equal(database.doors.beginRun(user.id, 'token_tycoon', 5).allowed, false, 'the allowance is then exhausted');
});

test('an expired season is closed and a new one opened', () => {
  if (!db || !db.open) db = database.init();
  const user = database.users.create('SeasonCaller', 'long-enough-password');
  const old = database.doors.createSeason('prompt_quest', {
    name: 'Old season',
    startsAt: '2020-01-01 00:00:00',
    endsAt: '2020-01-31 00:00:00',
    state: 'active',
  });

  const run = database.doors.beginRun(user.id, 'prompt_quest', 5);
  assert.equal(run.allowed, true);
  assert.equal(db.prepare('SELECT state FROM door_seasons WHERE id = ?').get(old.id).state, 'complete');

  const active = db.prepare("SELECT * FROM door_seasons WHERE door_key = 'prompt_quest' AND state = 'active'").all();
  assert.equal(active.length, 1);
  const assigned = db.prepare('SELECT season_id FROM door_runs WHERE id = ?').get(run.runId);
  assert.equal(Number(assigned.season_id), Number(active[0].id));
});
