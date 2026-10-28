'use strict';

// End-to-end coverage of the five persistent door games, driven against a real
// server process over the real Telnet transport.
//
// Advertised behavior quoted from README.md:
//   Features: "5 Persistent Door Games - Trusted registry, daily launch
//   allowances, bounded saves, completed-run scoring, and league tables..."
//   Door Games: "Prompt Quest, Token Tycoon, and Stack Overflow sit in the
//   general arcade. Vibe Wars and Dungeon of the Vibe Lords retain their names
//   as part of the Vibe corner's personality." / "all five doors participate in
//   daily launch allowances and completed-run league tables."
//   Dungeon of the Vibe Lords: "Requires ANTHROPIC_API_KEY in .env... Without
//   it, the dungeon entrance displays a 'sealed' message."

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, login, register, MAIN_PROMPT } = require('../helpers/board');

let board;

test.before(async () => {
  board = await startBoard();
});

test.after(async () => {
  if (board) await board.stop();
});

// ── helpers ────────────────────────────────────────────────────────────────

// Return the last match of `regex` in `text`, or null.
function parseLast(text, regex) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  let match;
  let last = null;
  while ((match = re.exec(text)) !== null) last = match;
  return last;
}

function lastCapture(text, regex) {
  const match = parseLast(text, regex);
  return match ? match[1] : null;
}

async function openDoors(client) {
  await client.sendAndWait('D', /Door #: /);
}

async function quitVibeWars(client) {
  await client.sendAndWait('Q', /GAME OVER/);
  await client.sendAndWait('', /Door #: /);
}

// Prompt Quest opens straight into either exploration or combat; escape combat
// (R) until the explore menu appears, then quit.
async function quitPromptQuest(client) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const from = client.mark();
    await client.send('R');
    const match = await client.waitFor(/Action: |Combat: |QUEST COMPLETE|YOU HAVE BEEN DEFEATED/, { from });
    if (/QUEST COMPLETE|YOU HAVE BEEN DEFEATED/.test(match[0])) {
      await client.sendAndWait('', /Door #: /);
      return;
    }
    if (/Action: /.test(match[0])) break;
  }
  await client.sendAndWait('Q', /QUEST COMPLETE|YOU HAVE BEEN DEFEATED/);
  await client.sendAndWait('', /Door #: /);
}

async function quitTokenTycoon(client) {
  await client.sendAndWait('Q', /FINAL RESULTS/);
  await client.sendAndWait('', /Door #: /);
}

// Stack Overflow has no in-round quit; end the round (win or lose) by guessing
// the alphabet, then choose Q at the round-over prompt.
async function quitStackOverflow(client) {
  let roundOver = false;
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const from = client.mark();
    await client.send(letter);
    const match = await client.waitFor(/Choice: |Guess a letter: /, { from });
    if (/Choice: /.test(match[0])) { roundOver = true; break; }
  }
  assert.ok(roundOver, 'Stack Overflow should reach the round-over prompt');
  await client.sendAndWait('Q', /FINAL SCORE/);
  await client.sendAndWait('', /Door #: /);
}

// ── tests ──────────────────────────────────────────────────────────────────

test('Door Games menu lists all five advertised doors and the league tables', async () => {
  const client = await board.connectTelnet();
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    const from = client.mark();
    await client.sendAndWait('D', /Door #: /);
    const menu = client.since(from);

    assert.match(menu, /Vibe Wars/);
    assert.match(menu, /Prompt Quest/);
    assert.match(menu, /Token Tycoon/);
    assert.match(menu, /Stack Overflow/);
    // The menu wraps the fifth name across two lines, with its description
    // rendered between them.
    assert.match(menu, /Dungeon of the/);
    assert.match(menu, /Vibe Lords/);
    assert.match(menu, /League tables/);
    assert.match(menu, /Return to Main Menu/);

    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('each arcade door launches, starts, and returns to the door menu on exit', async () => {
  const client = await board.connectTelnet();
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await openDoors(client);

    // 1 — Vibe Wars
    let from = client.mark();
    await client.send('1');
    await client.waitFor(/Command: /, { from });
    assert.match(client.since(from), /Sector 1: Sol Station/);
    await quitVibeWars(client);

    // 2 — Prompt Quest
    from = client.mark();
    await client.send('2');
    await client.waitFor(/Action: |Combat: /, { from });
    assert.match(client.since(from), /Floor 1/);
    await quitPromptQuest(client);

    // 3 — Token Tycoon
    from = client.mark();
    await client.send('3');
    await client.waitFor(/Action: /, { from });
    assert.match(client.since(from), /Month\s+1\/24/);
    await quitTokenTycoon(client);

    // 4 — Stack Overflow
    from = client.mark();
    await client.send('4');
    await client.waitFor(/Guess a letter: /, { from });
    assert.match(client.since(from), /Category:/);
    await quitStackOverflow(client);

    // Each quit landed us back at the door menu prompt.
    assert.match(client.text(), /Door #: /);
    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('league tables list completed runs with scores', async () => {
  const client = await board.connectTelnet();
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await openDoors(client);

    const from = client.mark();
    await client.sendAndWait('L', /DOOR LEAGUE TABLES/);
    const leagues = client.since(from);

    assert.match(leagues, /Vibe Wars/);
    assert.match(leagues, /Prompt Quest/);
    assert.match(leagues, /Token Tycoon/);
    assert.match(leagues, /Stack Overflow/);
    assert.match(leagues, /Dungeon of the Vibe Lords/);
    // Completed runs from the previous test are listed with a numeric score.
    assert.match(leagues, /SysOp\s+\d+/);

    await client.sendAndWait('', /Door #: /);
  } finally {
    client.close();
  }
});

test('Vibe Wars reflects buy, sell, and warp turns in its state', async () => {
  const client = await board.connectTelnet();
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await openDoors(client);

    const launchFrom = client.mark();
    await client.send('1');
    await client.waitFor(/Command: /, { from: launchFrom });
    const launch = client.since(launchFrom);
    assert.equal(lastCapture(launch, /Credits: (\d+)/), '1000');
    assert.equal(lastCapture(launch, /Cargo: (\d+)\/50/), '0');

    // Buy one unit of commodity 1.
    await client.sendAndWait('B', /Buy which commodity/);
    const selectMark = client.mark();
    await client.send('1');
    const quote = await client.waitFor(/You can buy up to (\d+)/, { from: selectMark });
    assert.ok(Number(quote[1]) >= 1, 'at least one unit should be affordable');
    const amountMark = client.mark();
    await client.send('1');
    await client.waitFor(/Command: /, { from: amountMark });
    const afterBuy = client.since(amountMark);
    assert.match(afterBuy, /Bought 1 GPU Cores for \d+cr/);
    const creditsAfterBuy = Number(lastCapture(afterBuy, /Credits: (\d+)/));
    const cargoAfterBuy = Number(lastCapture(afterBuy, /Cargo: (\d+)\/50/));
    assert.ok(creditsAfterBuy < 1000, 'buying should spend credits');
    assert.equal(cargoAfterBuy, 1, 'buying should add cargo');

    // Sell the unit back.
    await client.sendAndWait('S', /Sell which commodity/);
    const sellSelectMark = client.mark();
    await client.send('1');
    await client.waitFor(/Quantity \(or ALL\): /, { from: sellSelectMark });
    const sellAmountMark = client.mark();
    await client.send('1');
    await client.waitFor(/Command: /, { from: sellAmountMark });
    const afterSell = client.since(sellAmountMark);
    assert.match(afterSell, /Sold 1 GPU Cores for \d+cr/);
    const creditsAfterSell = Number(lastCapture(afterSell, /Credits: (\d+)/));
    const cargoAfterSell = Number(lastCapture(afterSell, /Cargo: (\d+)\/50/));
    assert.ok(creditsAfterSell > creditsAfterBuy, 'selling should earn credits');
    assert.equal(cargoAfterSell, 0, 'selling should empty the cargo hold');

    // Warp to sector 2 (one fuel, one turn).
    await client.sendAndWait('W', /Warp to sector/);
    const warpMark = client.mark();
    await client.send('2');
    await client.waitFor(/Command: /, { from: warpMark });
    const afterWarp = client.since(warpMark);
    assert.match(afterWarp, /Sector 2: GPU Nebula/);
    assert.equal(Number(lastCapture(afterWarp, /Turns: (\d+)/)), 29, 'a warp should spend a turn');

    await quitVibeWars(client);
    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('a stateful door save survives logoff and a new login', async () => {
  const client = await board.connectTelnet();
  let savedCredits;
  let savedCargo;
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await openDoors(client);

    await client.sendAndWait('1', /Command: /);
    await client.sendAndWait('B', /Buy which commodity/);
    const selectMark = client.mark();
    await client.send('1');
    await client.waitFor(/Quantity: /, { from: selectMark });
    const amountMark = client.mark();
    await client.send('1');
    await client.waitFor(/Command: /, { from: amountMark });
    const afterBuy = client.since(amountMark);
    assert.match(afterBuy, /Bought 1 GPU Cores/);
    savedCredits = Number(lastCapture(afterBuy, /Credits: (\d+)/));
    savedCargo = Number(lastCapture(afterBuy, /Cargo: (\d+)\/50/));
    assert.ok(savedCargo >= 1, 'a purchased item should be in the hold before logoff');

    await quitVibeWars(client);
    await client.sendAndWait('Q', MAIN_PROMPT);
    await client.sendAndWait('G', /Goodbye|Thanks for calling|Nodehouse/i);
  } finally {
    client.close();
  }

  const second = await board.connectTelnet();
  try {
    await login(second, { username: 'SysOp', password: board.sysopPassword });
    await openDoors(second);

    const from = second.mark();
    await second.send('1');
    await second.waitFor(/Command: /, { from });
    const restored = second.since(from);
    assert.equal(Number(lastCapture(restored, /Credits: (\d+)/)), savedCredits,
      'saved credits should be restored after reconnect');
    assert.equal(Number(lastCapture(restored, /Cargo: (\d+)\/50/)), savedCargo,
      'saved cargo should be restored after reconnect');

    await quitVibeWars(second);
  } finally {
    second.close();
  }
});

test('daily launch allowance is enforced with a clear refusal', async () => {
  const username = 'DoorE2E';
  const client = await board.connectTelnet();
  try {
    await register(client, { username });
    await openDoors(client);

    // Token Tycoon (door 3) advertises a five-launch daily allowance.
    let allowed = 0;
    let refused = false;
    for (let attempt = 0; attempt < 8 && !refused; attempt += 1) {
      const from = client.mark();
      await client.send('3');
      const match = await client.waitFor(/Daily turns used|Action: /, { from });
      if (/Daily turns used/.test(match[0])) { refused = true; break; }
      allowed += 1;
      await client.sendAndWait('Q', /FINAL RESULTS/);
      await client.sendAndWait('', /Door #: /);
    }

    assert.equal(allowed, 5, 'the door should admit five launches before refusing');
    assert.ok(refused, 'a sixth launch should be refused');
    assert.match(client.text(), /Daily turns used\. The door reopens tomorrow\./);
    // The refusal returns the caller to the door menu rather than crashing.
    assert.match(client.text(), /Door #: /);
    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('Door 5 reports a sealed entrance without the API key and the session survives', async () => {
  const client = await board.connectTelnet();
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await openDoors(client);

    const from = client.mark();
    await client.send('5');
    await client.waitFor(/The Dungeon is sealed!/, { from });
    const sealed = client.since(from);
    assert.match(sealed, /ANTHROPIC_API_KEY not configured/);
    assert.match(sealed, /No daily turn was used/);

    // The refusal returns straight to the door menu (no pause prompt).
    await client.waitFor(/Door #: /, { from });

    // The other doors still work after the sealed entrance.
    const doorFrom = client.mark();
    await client.send('2');
    await client.waitFor(/Action: |Combat: /, { from: doorFrom });
    assert.match(client.since(doorFrom), /Floor 1/);
    await quitPromptQuest(client);

    // The session engine is still healthy: reach the main menu and use a screen.
    await client.sendAndWait('Q', MAIN_PROMPT);
    const statsFrom = client.mark();
    await client.send('S');
    await client.waitFor(/System Information/, { from: statsFrom });
    assert.match(client.since(statsFrom), /Total Users:/);
  } finally {
    client.close();
  }
});

test('Vibe Wars charges exactly the price it quotes', async () => {
  const client = await board.connectTelnet();
  try {
    await login(client, { username: 'SysOp', password: board.sysopPassword });
    await openDoors(client);

    const launchMark = client.mark();
    await client.send('1');
    await client.waitFor(/Command: /, { from: launchMark });
    const beforeCredits = Number(lastCapture(client.since(launchMark), /Credits: (\d+)/));
    assert.ok(Number.isFinite(beforeCredits), 'the sector screen should show the credit balance');

    await client.sendAndWait('B', /Buy which commodity/);
    const quoteMark = client.mark();
    await client.send('1');
    await client.waitFor(/You can buy up to \d+/, { from: quoteMark });
    const quotedPrice = Number(lastCapture(client.since(quoteMark), /@ (\d+)cr each/));
    assert.ok(quotedPrice > 0, 'the buy screen should quote a price');

    const amountMark = client.mark();
    await client.send('1');
    await client.waitFor(/Command: /, { from: amountMark });
    const after = client.since(amountMark);
    assert.match(after, /Bought 1 GPU Cores/);
    const spent = beforeCredits - Number(lastCapture(after, /Credits: (\d+)/));
    assert.equal(spent, quotedPrice, 'the price charged must equal the price quoted');

    await quitVibeWars(client);
    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});

test('a sealed door is refused without consuming a daily turn', async () => {
  const username = 'SealE2E';
  const client = await board.connectTelnet();
  try {
    await register(client, { username });
    await openDoors(client);

    // Door 5's daily allowance is 5. Six sealed attempts must each be refused
    // without ever reporting the allowance as spent.
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const from = client.mark();
      await client.send('5');
      await client.waitFor(/Door #: /, { from });
      const screen = client.since(from);
      assert.match(screen, /The Dungeon is sealed!/, `attempt ${attempt} should report the sealed entrance`);
      assert.match(screen, /No daily turn was used/, `attempt ${attempt} should say no turn was used`);
      assert.doesNotMatch(screen, /Daily turns used/, `attempt ${attempt} must not burn a daily turn`);
    }

    await client.sendAndWait('Q', MAIN_PROMPT);
  } finally {
    client.close();
  }
});
