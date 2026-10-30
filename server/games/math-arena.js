/**
 * @file math-arena.js
 * @description Neon Math Arena competitive arithmetic game engine.
 * Simultaneous multiplayer mechanics: both players are presented with the same math question.
 * Players choose from 4 multiple-choice options before the round timer expires.
 * Correct answers award points; incorrect answers or timeouts deduct a life.
 *
 * Security: Server generates questions and enforces authoritative scoring;
 * question options are sent to clients without revealing the `correct` index.
 */

const TOTAL_ROUNDS = 8;
const MAX_LIVES = 3;
const POINTS = 20;

/**
 * Server-side maximum round deadline in milliseconds before timeout enforcement.
 * @constant {number}
 */
export const ROUND_MS = 14000;

const OPERATORS = ['+', '−', '×', '÷'];

/**
 * Generates an inclusive random integer between min and max.
 *
 * @function rand
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} Random integer.
 */
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generates an arithmetic question with 4 unique multiple-choice answer options.
 *
 * @function makeQuestion
 * @returns {{text: string, expr: string, options: Array<number>, correct: number}} Generated question object.
 */
function makeQuestion() {
  const op = OPERATORS[rand(0, OPERATORS.length - 1)];
  let a, b, answer;
  if (op === '+') {
    a = rand(12, 89);
    b = rand(12, 89);
    answer = a + b;
  } else if (op === '−') {
    a = rand(40, 99);
    b = rand(11, 39);
    answer = a - b;
  } else if (op === '×') {
    a = rand(3, 12);
    b = rand(3, 12);
    answer = a * b;
  } else {
    b = rand(3, 12);
    answer = rand(3, 12);
    a = b * answer;
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

/**
 * Creates and initializes a new Neon Math Arena match instance.
 *
 * @function createGame
 * @param {string} addrX - Player 1 (X) address.
 * @param {string} addrO - Player 2 (O) address.
 * @param {Object} [opts={}] - Optional configuration.
 * @param {'easy'|'medium'|'hard'} [opts.difficulty='medium'] - Bot accuracy difficulty.
 * @returns {Object} Math Arena game state.
 */
export function createGame(addrX, addrO, opts = {}) {
  const difficulty = ['easy', 'medium', 'hard'].includes(opts?.difficulty)
    ? opts.difficulty
    : 'medium';
  return {
    players: { X: addrX, O: addrO },
    questions: Array.from({ length: TOTAL_ROUNDS }, makeQuestion),
    round: 0,
    difficulty,
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

/**
 * Evaluates terminal win/draw conditions based on remaining lives or completed rounds.
 *
 * @function finishIfDone
 * @param {Object} game - Mutable game state.
 */
function finishIfDone(game) {
  if (game.lives.X <= 0 || game.lives.O <= 0 || game.round >= TOTAL_ROUNDS) {
    if (game.lives.X <= 0 && game.lives.O > 0) game.winner = 'O';
    else if (game.lives.O <= 0 && game.lives.X > 0) game.winner = 'X';
    else if (game.scores.X === game.scores.O) game.winner = 'draw';
    else game.winner = game.scores.X > game.scores.O ? 'X' : 'O';
  }
}

/**
 * Resolves score rewards, life penalties, and advances round state.
 *
 * @function resolveRound
 * @param {Object} game - Mutable game state.
 */
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

/**
 * Processes a player's answer selection for the active round.
 *
 * @function applyMove
 * @param {Object} game - Game state.
 * @param {string} address - Submitting player address.
 * @param {Object} move - Move payload containing option index.
 * @param {number} move.index - Index 0-3 of selected answer.
 * @returns {{ok?: boolean, error?: string}} Move outcome.
 */
export function applyMove(game, address, move) {
  if (game.winner) return { error: 'Game is over' };
  const seat = game.players.X === address ? 'X' : game.players.O === address ? 'O' : null;
  if (!seat) return { error: 'Not a player in this game' };
  if (game.answered[seat]) return { error: 'Answer already locked' };
  const index =
    Number.isInteger(move?.index) && move.index >= 0 && move.index < 4 ? move.index : null;

  game.answered[seat] = true;
  game.picks[seat] = index;
  game.moves.push({ round: game.round, index, address, t: Date.now() });

  if (game.answered.X && game.answered.O) resolveRound(game);
  else game.turn = seat === 'X' ? 'O' : 'X';

  return { ok: true };
}

/**
 * Server timeout handler: forces uncommitted players to forfeit answer and deducts life.
 *
 * @function timeoutRound
 * @param {Object} game - Game state.
 * @returns {{ok: boolean, timedOut?: boolean}} Timeout status.
 */
export function timeoutRound(game) {
  if (game.winner) return { ok: false };
  let timedOut = false;
  for (const seat of ['X', 'O']) {
    if (!game.answered[seat]) {
      game.answered[seat] = true;
      game.picks[seat] = null;
      game.moves.push({
        round: game.round,
        index: null,
        address: game.players[seat],
        t: Date.now(),
        timeout: true,
      });
      timedOut = true;
    }
  }
  if (timedOut) {
    resolveRound(game);
    return { ok: true, timedOut: true };
  }
  return { ok: false };
}

/**
 * Alias for `timeoutRound` for backwards compatibility.
 * @constant {Function}
 */
export const timeoutMove = timeoutRound;

/**
 * Generates an automated answer move for bot opponent based on accuracy curve.
 *
 * @function botMove
 * @param {Object} game - Game state.
 * @param {'easy'|'medium'|'hard'} [difficulty] - Bot difficulty setting.
 * @returns {{index: number}} Selected answer index (0-3).
 */
export function botMove(game, difficulty = game.difficulty || 'medium') {
  const q = game.questions[game.round];
  if (!q) return { index: 0 };
  const accuracy = difficulty === 'easy' ? 0.35 : difficulty === 'hard' ? 0.95 : 0.7;

  if (Math.random() < accuracy) return { index: q.correct };
  const wrong = [0, 1, 2, 3].filter((i) => i !== q.correct);
  return { index: wrong[Math.floor(Math.random() * wrong.length)] };
}

/**
 * Serializes the Math Arena game state for client broadcast.
 * Never exposes the hidden correct index to clients, preventing devtools cheating.
 *
 * @function serialize
 * @param {Object} game - Game state.
 * @returns {Object} Public sanitized state representation.
 */
export function serialize(game) {
  const q = game.questions[game.round] || null;
  return {
    round: game.round,
    totalRounds: TOTAL_ROUNDS,
    maxLives: MAX_LIVES,
    difficulty: game.difficulty,
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
