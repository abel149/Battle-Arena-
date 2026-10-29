// Tic Tac Toe game engine — pluggable module.
// Interface: createGame(pX, pO, opts), applyMove(game, address, move),
//            botMove(game), serialize(game)

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function createGame(addrX, addrO, _opts = {}) {
  return {
    board: Array(9).fill(null),
    turn: 'X',
    players: { X: addrX, O: addrO },
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
  if (!Number.isInteger(index) || index < 0 || index > 8 || game.board[index]) return { error: 'Invalid cell' };

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

export function botMove(game) {
  const empty = game.board.map((v, i) => (v ? null : i)).filter(v => v !== null);
  return { index: empty[Math.floor(Math.random() * empty.length)] };
}

// Strip internal refs, safe to broadcast
export function serialize(game) {
  return {
    board: game.board,
    turn: game.turn,
    players: game.players,
    winner: game.winner,
    winLine: game.winLine,
    moveCount: game.moves.length,
  };
}
