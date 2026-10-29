import test from 'node:test';
import assert from 'node:assert/strict';
import * as ttt from '../games/tictactoe.js';

test('createGame sets up an empty 9-cell board with X to move', () => {
  const g = ttt.createGame('0xA', '0xB');
  assert.equal(g.board.length, 9);
  assert.deepEqual(g.players, { X: '0xA', O: '0xB' });
  assert.equal(g.turn, 'X');
  assert.equal(g.winner, null);
});

test('moves alternate turns and are recorded', () => {
  const g = ttt.createGame('0xA', '0xB');
  const a = ttt.applyMove(g, '0xA', { index: 0 });
  assert.ok(!a.error);
  assert.equal(g.turn, 'O');
  assert.equal(g.moves.length, 1);
  assert.equal(g.moves[0].symbol, 'X');
  const b = ttt.applyMove(g, '0xB', { index: 3 });
  assert.ok(!b.error);
  assert.equal(g.turn, 'X');
});

test('X wins with a top row and winLine is exposed', () => {
  const g = ttt.createGame('0xA', '0xB');
  ttt.applyMove(g, '0xA', { index: 0 });
  ttt.applyMove(g, '0xB', { index: 3 });
  ttt.applyMove(g, '0xA', { index: 1 });
  ttt.applyMove(g, '0xB', { index: 4 });
  ttt.applyMove(g, '0xA', { index: 2 });
  assert.equal(g.winner, 'X');
  assert.deepEqual(g.winLine, [0, 1, 2]);
});

test('rejects out-of-turn, foreign, occupied and out-of-range moves', () => {
  const g = ttt.createGame('0xA', '0xB');
  assert.ok(ttt.applyMove(g, '0xB', { index: 0 }).error);       // not their turn
  assert.ok(ttt.applyMove(g, '0xC', { index: 0 }).error);      // not a player
  ttt.applyMove(g, '0xA', { index: 0 });
  assert.ok(ttt.applyMove(g, '0xB', { index: 0 }).error);      // occupied cell
  assert.ok(ttt.applyMove(g, '0xB', { index: 9 }).error);      // out of range
  assert.ok(ttt.applyMove(g, '0xB', { index: -1 }).error);
});

test('full board without a winner is a draw', () => {
  const g = ttt.createGame('0xA', '0xB');
  // A known forced-draw sequence; X must block O's 1-4-7 diag at move 7.
  const seq = [[0,'0xA'],[1,'0xB'],[2,'0xA'],[3,'0xB'],[5,'0xA'],[4,'0xB'],[7,'0xA'],[8,'0xB'],[6,'0xA']];
  for (const [idx, addr] of seq) {
    ttt.applyMove(g, addr, { index: idx });
  }
  assert.equal(g.winner, 'draw');
  assert.equal(ttt.applyMove(g, '0xB', { index: 0 }).error, 'Game is over');
});

test('botMove returns an empty cell', () => {
  const g = ttt.createGame('0xA', '0xB');
  ttt.applyMove(g, '0xA', { index: 0 });
  const mv = ttt.botMove(g);
  assert.ok(mv.index >= 1 && mv.index <= 8);
});
