import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ClientIO } from 'socket.io-client';
import { ethers } from 'ethers';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDb = path.join(os.tmpdir(), `arena-flow-test-${process.pid}-${Date.now()}.sqlite`);
process.env.ARENA_DB_PATH = tmpDb;
process.env.PORT = '3987';

after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(tmpDb + suffix, { force: true }); } catch { /* ignore */ }
  }
});

test('Full flow: two players register, matchmake, complete match, record receipt, and update leaderboard', async () => {
  const { server, io } = await import('../index.js');
  const serverUrl = 'http://localhost:3987';

  const w1 = ethers.Wallet.createRandom();
  const w2 = ethers.Wallet.createRandom();

  const sock1 = ClientIO(serverUrl, { reconnection: false });
  const sock2 = ClientIO(serverUrl, { reconnection: false });

  await Promise.all([
    new Promise(r => sock1.on('connect', r)),
    new Promise(r => sock2.on('connect', r)),
  ]);

  // Setup registration promises before identify
  const reg1Promise = new Promise((resolve) => {
    sock1.on('player:registered', (yes) => {
      if (!yes) {
        sock1.emit('player:register', { username: 'alice_' + Math.random().toString(36).slice(2, 8), password: 'password123' });
      }
    });
    sock1.on('auth:success', resolve);
  });

  const reg2Promise = new Promise((resolve) => {
    sock2.on('player:registered', (yes) => {
      if (!yes) {
        sock2.emit('player:register', { username: 'bob_' + Math.random().toString(36).slice(2, 8), password: 'password123' });
      }
    });
    sock2.on('auth:success', resolve);
  });

  // Identify Player 1
  const sig1 = await w1.signMessage(`Battle Arena login for ${w1.address}`);
  sock1.emit('identify', { address: w1.address, name: 'Alice', signature: sig1 });

  // Identify Player 2
  const sig2 = await w2.signMessage(`Battle Arena login for ${w2.address}`);
  sock2.emit('identify', { address: w2.address, name: 'Bob', signature: sig2 });

  await Promise.all([reg1Promise, reg2Promise]);

  // Setup match start listeners
  let matchRoomId = null;
  const matchStartP1 = new Promise((resolve) => {
    sock1.on('match:start', (data) => {
      matchRoomId = data.roomId;
      resolve(data);
    });
  });
  const matchStartP2 = new Promise((resolve) => {
    sock2.on('match:start', resolve);
  });

  sock1.emit('queue:join', { gameType: 'math-arena' });
  sock2.emit('queue:join', { gameType: 'math-arena' });

  const [start1, start2] = await Promise.all([matchStartP1, matchStartP2]);
  assert.ok(matchRoomId, 'Match room created');
  assert.equal(start1.roomId, start2.roomId);

  // Setup match end listener
  const endPromise = new Promise((resolve) => {
    sock1.on('match:end', resolve);
  });

  // Bob forfeits
  sock2.emit('match:leave', { roomId: matchRoomId });

  const matchEnd = await endPromise;
  assert.equal(matchEnd.winner, w1.address, 'Player 1 won');
  assert.ok(matchEnd.receipt?.matchId, 'Receipt created');

  // Verify match ledger
  const resMatches = await fetch(`${serverUrl}/api/matches`);
  assert.ok(resMatches.ok);
  const ledger = await resMatches.json();
  const entry = ledger.find(m => m.matchId === matchEnd.receipt.matchId);
  assert.ok(entry, 'Match in ledger');
  assert.equal(entry.winner, w1.address);

  // Verify leaderboard
  const resLb = await fetch(`${serverUrl}/api/leaderboard`);
  assert.ok(resLb.ok);
  const lb = await resLb.json();
  const aliceRow = lb.find(p => p.address === w1.address);
  assert.ok(aliceRow, 'Alice in leaderboard');
  assert.equal(aliceRow.wins, 1);

  sock1.disconnect();
  sock2.disconnect();
  io.close();
  await new Promise(r => server.close(r));
  process.exit(0);
});
