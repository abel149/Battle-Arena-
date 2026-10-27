// Simulated on-chain ledger — drop-in replaceable with a real
// ethers.js contract call (e.g. MatchResult.sol on Polygon Amoy).
// Each completed match produces: matchId, winner, timestamp,
// resultHash (sha256 of the full match payload), and a txHash.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = path.join(__dirname, 'ledger.json');

let ledger = [];
try {
  ledger = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
} catch {
  ledger = [];
}

function persist() {
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
}

export function recordMatch({ matchId, gameType, players, winner, moves }) {
  const timestamp = Date.now();
  const payload = { matchId, gameType, players, winner, moves, timestamp };
  const resultHash = '0x' + crypto.createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');

  // Simulated transaction hash — on a real chain this comes from tx.hash
  const txHash = '0x' + crypto.randomBytes(32).toString('hex');

  const entry = { matchId, gameType, players, winner, timestamp, resultHash, txHash };
  ledger.push(entry);
  persist();
  return entry;
}

export function getLedger() {
  return ledger.slice().reverse(); // newest first
}
