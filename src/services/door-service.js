'use strict';

const db = require('../core/database');
const { registry, getDoor } = require('../doors/registry');

const MAX_SAVE_BYTES = 64 * 1024;

function cloneSave(value) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SAVE_BYTES) {
    throw new Error('Door save is too large.');
  }
  return JSON.parse(encoded);
}

function normalizeScore(score) {
  const value = Number(score);
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.trunc(value), 2147483647)) : 0;
}

class DoorService {
  constructor(database = db) {
    this.db = database;
  }

  list() {
    return Object.values(registry).map(({ Door, save, restore, score, ...entry }) => ({ ...entry }));
  }

  launch(session, identifier) {
    const definition = getDoor(identifier);
    if (!definition) throw new Error('Unknown door.');
    if (!session?.user?.id || typeof session.exitDoor !== 'function') throw new Error('A logged-in BBS session is required.');
    if (!this.db.doors) throw new Error('Door storage is not initialized.');

    // Constructors are trusted but still run before charging a daily play, so a broken
    // optional integration cannot silently burn a caller's allowance.
    const door = new definition.Door(session);
    if (definition.restore) {
      const saved = this.db.doors.getSave(session.user.id, definition.id);
      if (saved?.state) definition.restore(door, cloneSave(saved.state));
    }
    // A door that cannot run (e.g. a sealed optional integration) is refused
    // before an admission is charged, so it never burns a daily launch.
    if (typeof definition.available === 'function' && !definition.available(session)) {
      return { allowed: false, unavailable: true, definition };
    }
    const admission = this.db.doors.beginRun(session.user.id, definition.id, definition.dailyRuns);
    if (!admission.allowed) {
      return { allowed: false, remaining: 0, definition };
    }

    let finished = false;
    const originalExit = session.exitDoor.bind(session);
    const finish = () => {
      if (finished) return;
      finished = true;
      let score = 0;
      try {
        score = normalizeScore(definition.score(door));
        if (definition.save) {
          this.db.doors.save(session.user.id, definition.id, cloneSave(definition.save(door)), 1);
        }
      } finally {
        try { this.db.doors.finishRun(admission.runId, score); }
        finally { session.exitDoor = originalExit; }
      }
    };

    session.exitDoor = (...args) => {
      finish();
      return originalExit(...args);
    };
    const originalHandle = door.handleInput.bind(door);
    door.handleInput = input => {
      const result = originalHandle(input);
      if (definition.save && !finished) {
        this.db.doors.save(session.user.id, definition.id, cloneSave(definition.save(door)), 1);
      }
      return result;
    };

    return { allowed: true, remaining: admission.remaining, definition, door, finish };
  }

  leaderboard(identifier, limit = 10, period = 'all') {
    const definition = getDoor(identifier);
    if (!definition) throw new Error('Unknown door.');
    return this.db.doors.getLeaderboard(definition.id, Math.max(1, Math.min(Number(limit) || 10, 50)), period);
  }
}

module.exports = { DoorService, MAX_SAVE_BYTES };
