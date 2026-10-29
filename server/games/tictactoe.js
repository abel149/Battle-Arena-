// Tic Tac Toe game engine — pluggable module.
// Interface: createGame(pX, pO, opts), applyMove(game, address, move),
//            botMove(game), serialize(game)

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function createGame(addrX, addrO, opts = {}) {
  const difficulty = ['easy', 'medium', 'hard'].includes(opts?.difficulty)
    ? opts.difficulty
    : 'medium';
  return {
    board: Array(9).fill(null),
    turn: 'X',
    players: { X: addrX, O: addrO },
    difficulty,
    moves: [],
    winner: null,      // 'X' | 'O' | 'draw' | null
    winLine: null,
  };
}

export function applyMove(game, address, move) {
  const index = move?.index;
  if (game.winner) return { error: 'Game is over' };
  const symbol =
    game.players.X === address ? 'X' :
    game.players.O === address ? 'O' : null;
  if (!symbol) return { error: 'Not a player in this game' };
  if (game.turn !== symbol) return { error: 'Not your turn' };
  if (index < 0 || index > 8 || game.board[index]) return { error: 'Invalid cell' };

  game.board[index] = symbol;
  game.moves.push({ index, symbol, address, t: Date.now() });
  game.turn = symbol === 'X' ? 'O' : 'X';

  const win = checkWinner(game.board);
  if (win) {
    game.winner = win.symbol;
    game.winLine = win.line;
  } else if (game.moves.length === 9) {
    game.winner = 'draw';
  }
  return { ok: true };
}

function checkWinner(b) {
  for (const line of LINES) {
    const [a, c, d] = line;
    if (b[a] && b[a] === b[c] && b[a] === b[d]) {
      return { symbol: b[a], line };
    }
  }
  return null;
}

function findWinningMove(board, symbol) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] === symbol && board[b] === symbol && !board[c]) return c;
    if (board[a] === symbol && !board[b] && board[c] === symbol) return b;
    if (!board[a] && board[b] === symbol && board[c] === symbol) return a;
  }
  return null;
}

function minimax(board, currentSymbol, botSymbol, depth = 0) {
  const oppSymbol = botSymbol === 'X' ? 'O' : 'X';
  const win = checkWinner(board);
  if (win?.symbol === botSymbol) return { score: 10 - depth };
  if (win?.symbol === oppSymbol) return { score: depth - 10 };
  const empty = board.map((v, i) => (v ? null : i)).filter(v => v !== null);
  if (empty.length === 0) return { score: 0 };

  if (currentSymbol === botSymbol) {
    let bestScore = -Infinity;
    let bestIdx = empty[0];
    for (const idx of empty) {
      board[idx] = botSymbol;
      const res = minimax(board, oppSymbol, botSymbol, depth + 1);
      board[idx] = null;
      if (res.score > bestScore) {
        bestScore = res.score;
        bestIdx = idx;
      }
    }
    return { score: bestScore, index: bestIdx };
  } else {
    let bestScore = Infinity;
    let bestIdx = empty[0];
    for (const idx of empty) {
      board[idx] = oppSymbol;
      const res = minimax(board, botSymbol, botSymbol, depth + 1);
      board[idx] = null;
      if (res.score < bestScore) {
        bestScore = res.score;
        bestIdx = idx;
      }
    }
    return { score: bestScore, index: bestIdx };
  }
}

export function botMove(game, difficulty = game.difficulty || 'medium') {
  const empty = game.board.map((v, i) => (v ? null : i)).filter(v => v !== null);
  if (empty.length === 0) return { index: 0 };

  const botSymbol = game.turn;
  const oppSymbol = botSymbol === 'X' ? 'O' : 'X';

  if (difficulty === 'easy') {
    // 85% pure random move, 15% winning move
    if (Math.random() < 0.15) {
      const win = findWinningMove(game.board, botSymbol);
      if (win !== null) return { index: win };
    }
    return { index: empty[Math.floor(Math.random() * empty.length)] };
  }

  if (difficulty === 'medium') {
    // 1) Take winning move if available
    const win = findWinningMove(game.board, botSymbol);
    if (win !== null) return { index: win };

    // 2) Block opponent with 75% probability
    const block = findWinningMove(game.board, oppSymbol);
    if (block !== null && Math.random() < 0.75) return { index: block };

    // 3) Prefer center cell (4) with 50% probability
    if (empty.includes(4) && Math.random() < 0.50) return { index: 4 };

    // 4) Otherwise pick random empty cell
    return { index: empty[Math.floor(Math.random() * empty.length)] };
  }

  // hard: minimax optimal play
  const res = minimax([...game.board], botSymbol, botSymbol, 0);
  return { index: res.index !== undefined ? res.index : empty[0] };
}

// Strip internal refs, safe to broadcast
export function serialize(game) {
  return {
    board: game.board,
    turn: game.turn,
    players: game.players,
    difficulty: game.difficulty,
    winner: game.winner,
    winLine: game.winLine,
    moveCount: game.moves.length,
  };
}
