// Game registry — adding a new game = one engine module + one line here.
// Engine interface:
//   createGame(addrX, addrO, opts) -> game
//   applyMove(game, address, move) -> { ok, pendingMs? } | { error }
//   resolve?(game)                 -> settle transient state after pendingMs
//   botMove(game)                  -> move object for the bot
//   serialize(game)                -> client-safe state

import * as tictactoe from './tictactoe.js';
import * as memory from './memory.js';
import * as mathArena from './math-arena.js';
import * as connectFour from './connectfour.js';
import * as cyberBlaster from './cyber-blaster.js';

export const ENGINES = {
  'tic-tac-toe': tictactoe,
  memory,
  'math-arena': mathArena,
  'connect-four': connectFour,
  'cyber-blaster': cyberBlaster,
};

export { DECKS, dailyDeckId } from './decks.js';
