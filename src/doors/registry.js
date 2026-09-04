'use strict';

// Door modules are deliberately registered here rather than loaded from caller input.
// This is the trust boundary for first-party doors.
const registry = Object.freeze({
  vibe_wars: {
    id: 'vibe_wars', number: 1, name: 'Vibe Wars', dailyRuns: 5,
    Door: require('./door1'),
    save: door => ({ player: door.player }),
    restore: (door, save) => {
      if (save.player?.turnsLeft > 0 && save.player?.hull > 0) door.player = { ...door.player, ...save.player };
    },
    score: door => door.player?.credits || 0,
  },
  prompt_quest: {
    id: 'prompt_quest', number: 2, name: 'Prompt Quest', dailyRuns: 5,
    Door: require('./door2'),
    save: door => ({ player: door.player }),
    restore: (door, save) => {
      if (save.player?.hp > 0) door.player = { ...door.player, ...save.player };
    },
    score: door => ((door.player?.kills || 0) * 10) + (door.player?.gold || 0) + ((door.player?.floor || 1) * 50),
  },
  token_tycoon: {
    id: 'token_tycoon', number: 3, name: 'Token Tycoon', dailyRuns: 5,
    Door: require('./door3'),
    save: door => ({ company: door.company, turn: door.turn }),
    restore: (door, save) => {
      if (save.turn > 0 && save.turn <= door.maxTurns) {
        door.company = { ...door.company, ...save.company };
        door.turn = save.turn;
      }
    },
    score: door => (door.company?.money || 0) + ((door.company?.customers || 0) * 100) + ((door.company?.reputation || 0) * 50),
  },
  stack_overflow: {
    id: 'stack_overflow', number: 4, name: 'Stack Overflow', dailyRuns: 10,
    Door: require('./door4'),
    save: door => ({ score: door.score, wins: door.wins, losses: door.losses, round: door.round }),
    restore: (door, save) => {
      for (const key of ['score', 'wins', 'losses', 'round']) {
        if (Number.isSafeInteger(save[key]) && save[key] >= 0) door[key] = save[key];
      }
    },
    score: door => door.score || 0,
  },
  dungeon_vibe_lords: {
    id: 'dungeon_vibe_lords', number: 5, name: 'Dungeon of the Vibe Lords', dailyRuns: 5,
    Door: require('./door5'), save: null, restore: null, // Door 5 owns its richer save/history store.
    score: door => ((door.player?.level || 1) * 1000) + (door.player?.xp || 0) + ((door.player?.deepest_floor || 1) * 100),
  },
});

function getDoor(identifier) {
  if (typeof identifier === 'number' || /^\d+$/.test(String(identifier))) {
    return Object.values(registry).find(door => door.number === Number(identifier)) || null;
  }
  return registry[String(identifier)] || null;
}

module.exports = { registry, getDoor };
