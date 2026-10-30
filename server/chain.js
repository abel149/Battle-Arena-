/**
 * @file chain.js
 * @description Simulated on-chain ledger module.
 * Provides a drop-in local implementation of match recording and ledger retrieval.
 * Used for local unit tests and development when an external EVM node is not configured.
 * Each completed match produces: matchId, winner, timestamp, resultHash, and txHash.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = path.join(__dirname, 'ledger.json');

/** @type {Array<Object>} In-memory cached ledger entries */
let ledger = [];
try {
  ledger = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
} catch {
  ledger = [];
}

/**
 * Persists the current in-memory ledger array to disk in JSON format.
 *
 * @function persist
 */
function persist() {
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
}

/**
 * Records a completed game match into the simulated ledger.
 *
 * @function recordMatch
 * @param {Object} params - Match result parameters.
 * @param {string} params.matchId - Unique match identifier.
 * @param {string} params.gameType - Game identifier (e.g., 'memory', 'math-arena').
 * @param {Object} params.players - Players mapping ({ X: address, O: address }).
 * @param {string} params.winner - Winning address or 'draw'.
 * @param {Array<Object>|number} params.moves - Move array or total move count.
 * @returns {Object} Newly recorded ledger entry including resultHash and simulated txHash.
 */
export function recordMatch({ matchId, gameType, players, winner, moves }) {
  const timestamp = Date.now();
  const payload = { matchId, gameType, players, winner, moves, timestamp };
  const resultHash =
    '0x' + crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  // Simulated transaction hash — on a real chain this comes from tx.hash
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');

  const entry = { matchId, gameType, players, winner, timestamp, resultHash, txHash };
  ledger.push(entry);
  persist();
  return entry;
}

/**
 * Retrieves the full simulated ledger ordered by newest matches first.
 *
 * @function getLedger
 * @returns {Array<Object>} Cloned and reversed array of all recorded match entries.
 */
export function getLedger() {
  return ledger.slice().reverse(); // newest first
}
