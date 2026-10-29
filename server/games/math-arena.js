// Neon Math Arena game engine — pluggable module.
// Both players answer the same question at the same time: move on the 2×2
// floor, lock the tile you are standing on (or send `index: null` when the
// clock runs out). A correct answer scores, a wrong one costs a life.
//
// The client owns the 10s clock and submits its answer when time is up, so the
// server stays authoritative for scoring without any extra timers.
//
// Interface: createGame(pX, pO, opts), applyMove(game, address, move),
//            botMove(game), serialize(game)

const TOTAL_ROUNDS = 8;
const MAX_LIVES = 3;
const POINTS = 20;

const OPERATORS = ['+', '−', '×', '÷'];

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeQuestion() {
  const op = OPERATORS[rand(0, OPERATORS.length - 1)];
  let a, b, answer;
  if (op === '+') {
    a = rand(12, 89); b = rand(12, 89); answer = a + b;
  } else if (op === '−') {
    a = rand(40, 99); b = rand(11, 39); answer = a - b;
  } else if (op === '×') {
    a = rand(3, 12); b = rand(3, 12); answer = a * b;
  } else {
    b = rand(3, 12); answer = rand(3, 12); a = b * answer;
  }

  const options = new Set([answer]);
  while (options.size < 4) {
    const delta = rand(1, 9) * (Math.random() < 0.5 ? -1 : 1);
    const candidate = answer + delta;
    if (candidate > 0 && !options.has(candidate)) options.add(candidate);
  }
  const shuffled = [...options].sort(() => Math.random() - 0.5);
  return {
    text: `What is ${a} ${op} ${b}?`,
    expr: `${a} ${op} ${b}`,
    options: shuffled,
    correct: shuffled.indexOf(answer),
  };
}

export function createGame(addrX, addrO, _opts = {}) {
  return {
    players: { X: addrX, O: addrO },
    questions: Array.from({ length: TOTAL_ROUNDS }, makeQuestion),
    round: 0,
    picks: { X: null, O: null },
    answered: { X: false, O: false },
    scores: { X: 0, O: 0 },
    lives: { X: MAX_LIVES, O: MAX_LIVES },
    turn: 'X',
    lastResult: null,
    winner: null,
    moves: [],
  };
}

function finishIfDone(game) {
  if (game.lives.X <= 0 || game.lives.O <= 0 || game.round >= TOTAL_ROUNDS) {
    if (game.lives.X <= 0 && game.lives.O > 0) game.winner = 'O';
    else if (game.lives.O <= 0 && game.lives.X > 0) game.winner = 'X';
    else if (game.scores.X === game.scores.O) game.winner = 'draw';
    else game.winner = game.scores.X > game.scores.O ? 'X' : 'O';
  }
}

function resolveRound(game) {
  const q = game.questions[game.round];
  const correct = q.correct;

  for (const seat of ['X', 'O']) {
    if (game.picks[seat] === correct) game.scores[seat] += POINTS;
    else game.lives[seat] = Math.max(0, game.lives[seat] - 1);
  }

  game.lastResult = {
    round: game.round,
    correct,
    picks: { ...game.picks },
    scores: { ...game.scores },
    lives: { ...game.lives },
  };

  game.round += 1;
  game.picks = { X: null, O: null };
  game.answered = { X: false, O: false };
  game.turn = 'X';
  finishIfDone(game);
}

export function applyMove(game, address, move) {
  if (game.winner) return { error: 'Game is over' };
  const seat =
    game.players.X === address ? 'X' :
    game.players.O === address ? 'O' : null;
  if (!seat) return { error: 'Not a player in this game' };
  if (game.answered[seat]) return { error: 'Answer already locked' };
  const index = Number.isInteger(move?.index) && move.index >= 0 && move.index < 4
    ? move.index
    : null;

  game.answered[seat] = true;
  game.picks[seat] = index;
  game.moves.push({ round: game.round, index, address, t: Date.now() });

  if (game.answered.X && game.answered.O) resolveRound(game);
  else game.turn = seat === 'X' ? 'O' : 'X';

  return { ok: true };
}

export function botMove(game) {
  const q = game.questions[game.round];
  if (!q) return { index: 0 };
  if (Math.random() < 0.65) return { index: q.correct };
  const wrong = [0, 1, 2, 3].filter(i => i !== q.correct);
  return { index: wrong[Math.floor(Math.random() * wrong.length)] };
}

export function serialize(game) {
  const q = game.questions[game.round] || null;
  return {
    round: game.round,
    totalRounds: TOTAL_ROUNDS,
    maxLives: MAX_LIVES,
    question: q ? { text: q.text, expr: q.expr, options: q.options } : null,
    picks: game.picks,
    answered: game.answered,
    scores: game.scores,
    lives: game.lives,
    players: game.players,
    turn: game.turn,
    lastResult: game.lastResult,
    winner: game.winner,
    moveCount: game.moves.length,
  };
}
