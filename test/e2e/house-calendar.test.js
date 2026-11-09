'use strict';

// House calendar: an opt-in birthday (month and day only) and call
// anniversaries, surfaced in the Daily Call.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startBoard, register, login } = require('../helpers/board');

function todayMmDd() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

test('a birthday shows in the Daily Call and greets the caller', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    const creds = await register(client, { username: 'CalE2E' });

    await client.sendAndWait('H', /Porch command: /);
    await client.sendAndWait('E', /Card as display name/);
    await client.sendAndWait(`Cal | modems | keeps old hardware | ${todayMmDd()}`, /Porch command: /);

    await client.sendAndWait('Q', /Main command \(/);
    const from = client.mark();
    await client.sendAndWait('Z', /THE DAILY CALL/);
    assert.match(client.since(from), /This week at the House:.*CalE2E/);

    await client.sendAndWait('Q', /Main command \(/);
    await client.sendAndWait('G', /Thanks for calling/);
    client.close();

    const second = await board.connectTelnet();
    await login(second, { username: creds.username, password: creds.password });
    assert.match(second.text(), /Happy birthday/);
    second.close();
  } finally {
    await board.stop();
  }
});

test('an invalid birthday is rejected', async () => {
  const board = await startBoard();
  try {
    const client = await board.connectTelnet();
    await register(client, { username: 'BadDateE2E' });
    await client.sendAndWait('H', /Porch command: /);
    await client.sendAndWait('E', /Card as display name/);
    const before = client.mark();
    await client.send('Cal | modems | bio | 13-40');
    await client.waitFor(/Birthday must be MM-DD|Caller card saved/, { from: before });
    client.close();
  } finally {
    await board.stop();
  }
});
