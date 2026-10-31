import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDb = path.join(os.tmpdir(), `arena-persist-test-${process.pid}-${Date.now()}.sqlite`);
process.env.ARENA_DB_PATH = tmpDb;

const store = await import('../store.js');

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(tmpDb + suffix, { force: true });
    } catch {
      /* ignore */
    }
  }
});

const P1 = '0x1111111111111111111111111111111111111111';
const P2 = '0x2222222222222222222222222222222222222222';

test('Active match persistence survives server restart and rehydration', () => {
  const matchId = 'match_restart_test_99';
  const room = {
    id: matchId,
    gameType: 'connect-four',
    deck: null,
    names: { [P1]: 'Player1', [P2]: 'Player2' },
    game: {
      turn: 'O',
      grid: Array(42).fill(null),
      players: { X: P1, O: P2 },
      winner: null,
      moves: [
        { col: 3, row: 5, player: 'X' },
        { col: 3, row: 4, player: 'O' },
      ],
    },
    chat: [
      { from: 'Player1', text: 'Good luck!', t: 1000 },
      { from: 'Player2', text: 'You too!', t: 1002 },
    ],
    spectators: new Set(['spectator_sock_1']),
    createdAt: Date.now(),
  };

  // 1. Save room while active
  store.saveActiveRoom(room);

  // 2. Simulate server restart: query database directly as if cold-booting
  const activeRooms = store.listActiveRooms();
  const restored = activeRooms.find((r) => r.roomId === matchId);

  assert.ok(restored, 'Active room was rehydrated from SQLite');
  assert.equal(restored.roomId, matchId);
  assert.equal(restored.gameType, 'connect-four');
  assert.equal(restored.game.turn, 'O');
  assert.equal(restored.game.moves.length, 2);
  assert.deepEqual(restored.game.moves[0], { col: 3, row: 5, player: 'X' });
  assert.equal(restored.chat.length, 2);
  assert.equal(restored.spectators[0], 'spectator_sock_1');

  // 3. Complete match and remove
  store.removeActiveRoom(matchId);
  assert.equal(store.getActiveRoom(matchId), null);
});

test('Parent PIN lockout persists in database across server restarts (brute-force defense)', () => {
  const parent = '0xParentBruteForce' + Math.random().toString(36).slice(2, 7);

  // Trigger 5 failed attempts
  for (let i = 0; i < 4; i++) {
    const res = store.verifyParentPin(parent, '0000');
    assert.equal(res.ok, false);
    assert.equal(res.locked, undefined);
  }

  const lockedRes = store.verifyParentPin(parent, '0000');
  assert.equal(lockedRes.ok, false);
  assert.equal(lockedRes.locked, true);

  // Simulate a server restart: reading pin attempt directly from DB
  const attemptRow = store.getPinAttempt(parent);
  assert.ok(attemptRow, 'Lockout row exists in SQLite');
  assert.equal(attemptRow.count, 5);
  assert.ok(attemptRow.lockedUntil > Date.now());

  // Subsequent verification remains locked
  const stillLocked = store.verifyParentPin(parent, '1234');
  assert.equal(stillLocked.ok, false);
  assert.equal(stillLocked.locked, true);

  // Resetting unlocks
  store.resetPinAttempts(parent);
  assert.equal(store.verifyParentPin(parent, '1234').ok, true);
});
