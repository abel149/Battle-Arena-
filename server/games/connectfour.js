/**
 * @file connectfour.js
 * @description Connect Four competitive gravity board game engine.
 * 7 columns × 6 rows vertical grid.
 * Players alternate dropping colored discs into columns; discs fall to the lowest unoccupied slot.
 * The first player to connect four discs horizontally, vertically, or diagonally wins the match.
 */

/** @constant {number} Number of columns in Connect Four board */
const COLS = 7;

/** @constant {number} Number of rows in Connect Four board */
const ROWS = 6;

/**
 * Creates and initializes a Connect Four game session.
 *
 * @function createGame
 * @param {string} addrX - Player 1 (X) wallet address.
 * @param {string} addrO - Player 2 (O) wallet address.
 * @param {Object} [opts={}] - Optional settings.
 * @param {'easy'|'medium'|'hard'} [opts.difficulty='medium'] - Bot tactical intelligence level.
 * @returns {Object} Initial Connect Four state object.
 */
export function createGame(addrX, addrO, opts = {}) {
  const difficulty = ['easy', 'medium', 'hard'].includes(opts?.difficulty)
    ? opts.difficulty
    : 'medium';

  // board: Array of 6 rows, each has 7 columns (null, 'X', 'O')
  // Row 0 is top, Row 5 is bottom (discs fall down to highest index)
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));

  return {
    grid,
    turn: 'X',
    players: { X: addrX, O: addrO },
    difficulty,
    moves: [],
    winner: null,     // 'X' | 'O' | 'draw' | null
    winCells: null,   // [[r, c], [r, c], [r, c], [r, c]]
    lastDrop: null,   // { row, col, symbol }
  };
}

/**
 * Executes a disc drop move into a designated column.
 *
 * @function applyMove
 * @param {Object} game - Mutable game state.
 * @param {string} address - Move initiator address.
 * @param {Object} move - Move details.
 * @param {number} [move.col] - Column index (0-6).
 * @param {number} [move.index] - Column index alias.
 * @returns {{ok?: boolean, error?: string}} Move outcome.
 */
export function applyMove(game, address, move) {
  if (game.winner) return { error: 'Game is over' };
  const symbol =
    game.players.X === address ? 'X' :
    game.players.O === address ? 'O' : null;
  if (!symbol) return { error: 'Not a player in this game' };
  if (game.turn !== symbol) return { error: 'Not your turn' };

  const col = Number(move?.col ?? move?.index);
  if (!Number.isInteger(col) || col < 0 || col >= COLS) {
    return { error: 'Invalid column' };
  }

  // Find lowest empty row in chosen column
  let row = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!game.grid[r][col]) {
      row = r;
      break;
    }
  }

  if (row === -1) return { error: 'Column is full' };

  game.grid[row][col] = symbol;
  game.lastDrop = { row, col, symbol };
  game.moves.push({ col, row, symbol, address, t: Date.now() });

  const win = checkWin(game.grid, row, col, symbol);
  if (win) {
    game.winner = symbol;
    game.winCells = win;
  } else if (game.moves.length === ROWS * COLS) {
    game.winner = 'draw';
  } else {
    game.turn = symbol === 'X' ? 'O' : 'X';
  }

  return { ok: true };
}

/**
 * Checks for a 4-in-a-row alignment radiating from the newly dropped disc coordinate.
 *
 * @function checkWin
 * @param {Array<Array<string|null>>} grid - Board matrix.
 * @param {number} r - Row index.
 * @param {number} c - Column index.
 * @param {string} sym - Disc symbol ('X' or 'O').
 * @returns {Array<[number, number]> | null} Coordinates of winning 4 cells, or null.
 */
function checkWin(grid, r, c, sym) {
  const directions = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal down-right
    [1, -1],  // diagonal down-left
  ];

  for (const [dr, dc] of directions) {
    const cells = [[r, c]];

    // Search positive direction
    let step = 1;
    while (true) {
      const nr = r + dr * step;
      const nc = c + dc * step;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === sym) {
        cells.push([nr, nc]);
        step++;
      } else break;
    }

    // Search negative direction
    step = 1;
    while (true) {
      const nr = r - dr * step;
      const nc = c - dc * step;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && grid[nr][nc] === sym) {
        cells.push([nr, nc]);
        step++;
      } else break;
    }

    if (cells.length >= 4) return cells.slice(0, 4);
  }
  return null;
}

/**
 * Finds lowest empty row index in a specific column.
 *
 * @function getLowestEmptyRow
 * @param {Array<Array<string|null>>} grid - Board matrix.
 * @param {number} col - Column index.
 * @returns {number} Row index (0-5) or -1 if column is filled.
 */
function getLowestEmptyRow(grid, col) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!grid[r][col]) return r;
  }
  return -1;
}

/**
 * Tactical Connect Four bot choosing optimal column drops based on winning opportunities,
 * threat blocking, blunder avoidance, and center-column control heuristics.
 *
 * @function botMove
 * @param {Object} game - Game state.
 * @param {'easy'|'medium'|'hard'} [difficulty] - Bot intelligence level.
 * @returns {{col: number}} Selected column.
 */
export function botMove(game, difficulty = game.difficulty || 'medium') {
  const botSymbol = game.turn;
  const oppSymbol = botSymbol === 'X' ? 'O' : 'X';

  const validCols = [];
  for (let c = 0; c < COLS; c++) {
    if (getLowestEmptyRow(game.grid, c) !== -1) validCols.push(c);
  }

  if (validCols.length === 0) return { col: 0 };

  // Helper: test if dropping into col produces a win for sym
  const testWin = (col, sym) => {
    const r = getLowestEmptyRow(game.grid, col);
    if (r === -1) return false;
    game.grid[r][col] = sym;
    const win = checkWin(game.grid, r, col, sym);
    game.grid[r][col] = null;
    return !!win;
  };

  if (difficulty === 'easy') {
    // 80% random, 20% instant win
    if (Math.random() < 0.20) {
      for (const col of validCols) {
        if (testWin(col, botSymbol)) return { col };
      }
    }
    return { col: validCols[Math.floor(Math.random() * validCols.length)] };
  }

  // 1) Can bot win right now?
  for (const col of validCols) {
    if (testWin(col, botSymbol)) return { col };
  }

  // 2) Can opponent win right now?
  if (difficulty === 'hard' || Math.random() < 0.75) {
    for (const col of validCols) {
      if (testWin(col, oppSymbol)) return { col };
    }
  }

  // 3) Avoid moves that hand the opponent a win directly above us
  const safeCols = validCols.filter(col => {
    const r = getLowestEmptyRow(game.grid, col);
    if (r <= 0) return true; // top row, nothing can go above
    // simulate drop
    game.grid[r][col] = botSymbol;
    const givesOppWin = testWin(col, oppSymbol);
    game.grid[r][col] = null;
    return !givesOppWin;
  });

  const pool = safeCols.length > 0 ? safeCols : validCols;

  // 4) Prefer center columns (3, then 2 & 4, then 1 & 5)
  const centerPriority = [3, 2, 4, 1, 5, 0, 6];
  for (const c of centerPriority) {
    if (pool.includes(c) && (difficulty === 'hard' ? Math.random() < 0.85 : Math.random() < 0.50)) {
      return { col: c };
    }
  }

  return { col: pool[Math.floor(Math.random() * pool.length)] };
}

/**
 * Serializes the Connect Four game state for client broadcast.
 *
 * @function serialize
 * @param {Object} game - Game state.
 * @returns {Object} Public sanitized state representation.
 */
export function serialize(game) {
  return {
    grid: game.grid,
    cols: COLS,
    rows: ROWS,
    turn: game.turn,
    players: game.players,
    difficulty: game.difficulty,
    winner: game.winner,
    winCells: game.winCells,
    lastDrop: game.lastDrop,
    moveCount: game.moves.length,
  };
}
