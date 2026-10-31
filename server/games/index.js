/**
 * @file index.js
 * @description Central Game Engine Registry for Web3 Battle Arena.
 * Modular architecture: register new game types by importing the engine module and adding
 * a key to the ENGINES map.
 *
 * Each engine adheres to the uniform Battle Arena lifecycle interface:
 *   - createGame(addrX, addrO, opts) -> Initial game state object
 *   - applyMove(game, address, move) -> Move validation and execution result
 *   - resolve?(game)                 -> Optional transient step resolver (e.g. card flips)
 *   - botMove(game, difficulty)      -> Algorithmic AI opponent move generator
 *   - serialize(game)                -> Sanitized client-safe broadcast state
 */

import * as memory from './memory.js';
import * as mathArena from './math-arena.js';
import * as connectFour from './connectfour.js';
import * as cyberBlaster from './cyber-blaster.js';

/**
 * Registry of all available game engine implementations keyed by gameType string.
 * @constant {Object.<string, Object>}
 */
export const ENGINES = {
  memory,
  'math-arena': mathArena,
  'connect-four': connectFour,
  'cyber-blaster': cyberBlaster,
};

export { DECKS, dailyDeckId } from './decks.js';
