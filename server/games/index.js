// Game registry — adding a new game = one engine module + one line here.
// Engine interface:
//   createGame(addrX, addrO, opts) -> game
//   applyMove(game, address, move) -> { ok, pendingMs? } | { error }
//   resolve?(game)                 -> settle transient state after pendingMs
//   botMove(game)                  -> move object for the bot
//   serialize(game)                -> client-safe state

import * as memory from './memory.js';
import * as mathArena from './math-arena.js';

export const ENGINES = {
  memory,
  'math-arena': mathArena,
};

export { DECKS, dailyDeckId } from './decks.js';
