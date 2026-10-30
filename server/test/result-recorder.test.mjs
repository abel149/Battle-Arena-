import test from 'node:test';
import assert from 'node:assert/strict';
import { ResultRecorder, defaultRecorder } from '../result-recorder.js';

test('ResultRecorder falls back to simulated ledger when unconfigured', async () => {
  assert.equal(typeof defaultRecorder.isOnchain(), 'boolean');
  const info = await defaultRecorder.chainInfo();
  assert.ok(info);

  const receipt = await defaultRecorder.recordMatch({
    matchId: 'recorder_test_' + Date.now(),
    gameType: 'memory',
    players: {
      X: '0x1111111111111111111111111111111111111111',
      O: '0x2222222222222222222222222222222222222222',
    },
    winner: '0x1111111111111111111111111111111111111111',
    moves: 4,
  });

  assert.ok(receipt);
  assert.ok(receipt.matchId);
  assert.ok(receipt.resultHash);
});

test('ResultRecorder forced to simulated mode produces simulated receipt', async () => {
  const simulatedRecorder = new ResultRecorder('simulated');
  assert.equal(simulatedRecorder.isOnchain(), false);

  const info = await simulatedRecorder.chainInfo();
  assert.equal(info.configured, false);
  assert.equal(info.network, 'simulated-local');

  const receipt = await simulatedRecorder.recordMatch({
    matchId: 'sim_test_' + Date.now(),
    gameType: 'connect-four',
    players: {
      X: '0x3333333333333333333333333333333333333333',
      O: '0x4444444444444444444444444444444444444444',
    },
    winner: 'draw',
    moves: 42,
  });

  assert.ok(receipt.resultHash);
  assert.ok(receipt.txHash);
  assert.equal(receipt.winner, 'draw');
});
