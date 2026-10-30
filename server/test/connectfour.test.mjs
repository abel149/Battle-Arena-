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

test('rejects out of turn and invalid columns', () => {
  const g = c4.createGame('0xA', '0xB');
  // O plays out of turn
  const oMove = c4.applyMove(g, '0xB', { col: 0 });
  assert.equal(oMove.error, 'Not your turn');

  // Negative column
  const negMove = c4.applyMove(g, '0xA', { col: -1 });
  assert.equal(negMove.error, 'Invalid column');

  // Column out of range (>6)
  const highMove = c4.applyMove(g, '0xA', { col: 7 });
  assert.equal(highMove.error, 'Invalid column');

  // Foreign player
  const foreignMove = c4.applyMove(g, '0xForeign', { col: 0 });
  assert.equal(foreignMove.error, 'Not a player in this game');
});

test('rejects disc drops into an already full column', () => {
  const g = c4.createGame('0xA', '0xB');
  // Fill column 0 completely (6 rows)
  for (let r = 0; r < 6; r++) {
    const player = r % 2 === 0 ? '0xA' : '0xB';
    const res = c4.applyMove(g, player, { col: 0 });
    assert.ok(!res.error);
  }
  // Attempt 7th disc into col 0
  const turnPlayer = g.turn === 'X' ? '0xA' : '0xB';
  const fullRes = c4.applyMove(g, turnPlayer, { col: 0 });
  assert.equal(fullRes.error, 'Column is full');
});

test('detects draw when all 42 cells are filled with no 4-in-a-row', () => {
  const g = c4.createGame('0xA', '0xB');
  // Grid where no 4 consecutive cells have the same symbol
  // Row 0 is top, Row 5 is bottom
  const nonWinningGrid = [
    ['X', 'O', 'X', 'O', 'X', 'O', null],
    ['X', 'O', 'X', 'O', 'X', 'O', 'X'],
    ['O', 'X', 'O', 'X', 'O', 'X', 'O'],
    ['O', 'X', 'O', 'X', 'O', 'X', 'O'],
    ['X', 'O', 'X', 'O', 'X', 'O', 'X'],
    ['O', 'X', 'O', 'X', 'O', 'X', 'O'],
  ];
  g.grid = nonWinningGrid;
  g.moves = new Array(41).fill({ col: 0, row: 0, symbol: 'X', address: '0xA', t: Date.now() });
  g.turn = 'X';
  const lastMove = c4.applyMove(g, '0xA', { col: 6 });
  assert.ok(!lastMove.error);
  assert.equal(g.winner, 'draw');
});
