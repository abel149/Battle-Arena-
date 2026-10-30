// Store tests run against a throwaway SQLite file so the developer's real
// data.sqlite is never touched. ARENA_DB_PATH must be set before store.js is
// imported because it reads the env at module load.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDb = path.join(os.tmpdir(), `arena-test-${process.pid}-${Date.now()}.sqlite`);
process.env.ARENA_DB_PATH = tmpDb;

const store = await import('../store.js');

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(tmpDb + suffix, { force: true }); } catch { /* ignore */ }
  }
});

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);

test('upsertPlayer creates a profile; saveMatch + getReplay round-trips', () => {
  store.upsertPlayer(A, 'Alice');
  assert.equal(store.getPlayer(A).name, 'Alice');

  const moves = [{ index: 0, symbol: 'X', address: A, t: 1 }, { index: 4, symbol: 'O', address: B, t: 2 }];
  store.saveMatch({
    matchId: 'match_test1',
    gameType: 'tic-tac-toe',
    deck: null,
    players: { X: A, O: B },
    names: { [A]: 'Alice', [B]: 'Bob' },
    layout: null,
    result: 'X',
    winner: A,
    moves,
  });
  const replay = store.getReplay('match_test1');
  assert.equal(replay.matchId, 'match_test1');
  assert.equal(replay.result, 'X');
  assert.equal(replay.winner, A);
  assert.deepEqual(replay.moves, moves);
  assert.equal(replay.names[A], 'Alice');
  assert.equal(replay.names[B], 'Bob');
  assert.equal(store.getReplay('nope'), null);
});

test('applyResult awards tokens, xp, levels and increments weekly points', () => {
  const before = store.getPlayer(A);
  const p = store.applyResult(A, 'win', { gameType: 'tic-tac-toe' });
  assert.equal(p.tokens, before.tokens + 10);
  assert.equal(p.xp, before.xp + 50);
  assert.equal(p.wins, before.wins + 1);
  assert.equal(p.level, Math.floor(p.xp / 100) + 1);

  const weekly = store.leaderboardWeekly();
  const row = weekly.find(r => r.address === A);
  assert.ok(row, 'A appears in weekly leaderboard');
  assert.equal(row.points, 10);
  assert.equal(row.wins, 1);

  const stats = store.weeklyStats(A);
  assert.equal(stats.points, 10);
  assert.equal(stats.wins, 1);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(stats.week)); // ISO Monday key
});

test('a loss adds 1 weekly point; unknown players start at zero', () => {
  store.upsertPlayer(B, 'Bob');
  store.applyResult(B, 'loss', {});
  assert.equal(store.weeklyStats(B).points, 1);
  assert.equal(store.weeklyStats(B).wins, 0);
});

test('weekStartFor computes the Monday (UTC) of the week', () => {
  // 2026-10-29 is a Thursday → Monday is 2026-10-26.
  assert.equal(store.weekStartFor(new Date('2026-10-29T15:00:00Z')), '2026-10-26');
  // Sunday 2026-10-25 rolls back to that same Monday.
  assert.equal(store.weekStartFor(new Date('2026-10-25T23:00:00Z')), '2026-10-19');
});

test('weekly leaderboard key rotation acts as the reset', () => {
  // Rows live under their own week key, so a past week does not leak in.
  const weekly = store.leaderboardWeekly(new Date('2020-01-01T00:00:00Z'));
  assert.equal(weekly.length, 0);
});

test('badges are awarded by stats and map to deterministic token ids', () => {
  const p = store.getPlayer(A);
  assert.ok(p.badges.some(b => b.id === 'first_blood'), 'first win badge awarded');
  assert.equal(store.badgeNumericId('first_blood'), 1); // index 0 + 1
  assert.equal(store.badgeNumericId('hat_trick'), 2);
  assert.equal(store.badgeNumericId('memory_king'), 10);
  assert.equal(store.badgeNumericId('does_not_exist'), null);
  for (const b of p.badges) {
    assert.ok(Number.isInteger(store.badgeNumericId(b.id)), `on-chain id exists for ${b.id}`);
  }
});

test('registration validates username, hashes password and logins verify it', async () => {
  const u = 'weekly_tester';
  const reg = await store.registerPlayer('0x' + 'c'.repeat(40), { username: u, password: 'supersecret9', name: 'Weekly' });
  assert.ok(!reg.error, reg.error || '');
  assert.ok(reg.password, 'store keeps the hash internally for auth');
  assert.ok(reg.password.startsWith('$2'), 'hash is bcrypt');
  assert.ok(!store.withoutPassword(reg).password, 'withoutPassword strips it');
  assert.equal(reg.username, u);

  const ok = await store.loginPlayerByCredentials({ username: u, password: 'supersecret9' });
  assert.ok(!ok.error);
  const bad = await store.loginPlayerByCredentials({ username: u, password: 'wrongpass1' });
  assert.equal(bad.error, 'Incorrect password');

  const short = await store.registerPlayer('0x' + 'd'.repeat(40), { username: 'x', password: 'longenough1' });
  assert.match(short.error, /3–20/);
});

test('withoutPassword strips the hash', () => {
  const p = store.withoutPassword(store.getPlayer(A));
  assert.equal(p.password, undefined);
});

test('saveActiveRoom, getActiveRoom, listActiveRooms, removeActiveRoom survive persistence', () => {
  const roomId = 'room_persistence_test_1';
  const dummyRoom = {
    id: roomId,
    gameType: 'connect-four',
    deck: null,
    names: { [A]: 'Alice', [B]: 'Bob' },
    game: {
      turn: 'X',
      grid: Array(42).fill(null),
      players: { X: A, O: B },
      winner: null,
      moves: [{ col: 3, row: 5, player: 'X' }],
    },
    chat: [{ from: 'Alice', text: 'Good game!', t: 100 }],
    spectators: new Set(['socket_spectator_1']),
    createdAt: Date.now(),
  };

  store.saveActiveRoom(dummyRoom);

  const fetched = store.getActiveRoom(roomId);
  assert.ok(fetched, 'active room retrieved from SQLite');
  assert.equal(fetched.roomId, roomId);
  assert.equal(fetched.gameType, 'connect-four');
  assert.equal(fetched.game.turn, 'X');
  assert.equal(fetched.game.moves.length, 1);
  assert.equal(fetched.chat.length, 1);
  assert.equal(fetched.spectators[0], 'socket_spectator_1');

  const list = store.listActiveRooms();
  assert.ok(list.some(r => r.roomId === roomId));

  store.removeActiveRoom(roomId);
  assert.equal(store.getActiveRoom(roomId), null);
});
