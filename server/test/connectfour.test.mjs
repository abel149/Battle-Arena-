import test from 'node:test';
import assert from 'node:assert/strict';
import * as c4 from '../games/connectfour.js';

test('createGame sets up 6x7 empty grid with X to move', () => {
  const g = c4.createGame('0xA', '0xB');
  assert.equal(g.grid.length, 6);
  assert.equal(g.grid[0].length, 7);
  assert.equal(g.turn, 'X');
  assert.equal(g.winner, null);
});

test('applyMove drops disc to lowest unoccupied row in column', () => {
  const g = c4.createGame('0xA', '0xB');
  const r1 = c4.applyMove(g, '0xA', { col: 3 });
  assert.ok(!r1.error);
  assert.equal(g.grid[5][3], 'X'); // row 5 is bottom
  assert.equal(g.turn, 'O');

  const r2 = c4.applyMove(g, '0xB', { col: 3 });
  assert.ok(!r2.error);
  assert.equal(g.grid[4][3], 'O'); // row 4 rests above row 5
  assert.equal(g.turn, 'X');
});

test('detects horizontal 4-in-a-row win', () => {
  const g = c4.createGame('0xA', '0xB');
  // X: 0, 1, 2, 3
  // O: 0, 1, 2
  for (let c = 0; c < 3; c++) {
    c4.applyMove(g, '0xA', { col: c });
    c4.applyMove(g, '0xB', { col: c });
  }
  const winMove = c4.applyMove(g, '0xA', { col: 3 });
  assert.ok(!winMove.error);
  assert.equal(g.winner, 'X');
  assert.equal(g.winCells.length, 4);
});

test('botMove blocks an opponent win', () => {
  const g = c4.createGame('0xA', '0xB', { difficulty: 'hard' });
  // Set up X with 3-in-a-row along bottom row: cols 0, 1, 2
  g.grid[5][0] = 'X';
  g.grid[5][1] = 'X';
  g.grid[5][2] = 'X';
  g.turn = 'O';

  const mv = c4.botMove(g, 'hard');
  // Column 3 must be blocked!
  assert.equal(mv.col, 3);
});
