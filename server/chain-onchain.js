// On-chain match recording backed by ethers.js + MatchResult.sol.
// Swap this in for chain.js by setting MATCH_RESULT_ADDRESS and either
// NODE_HTTP_URL (for a real RPC) or running against a local Hardhat/Anvil node.
//
// When the env is not configured, this module falls back to the simulated
// ledger so the server still works for local dev without a blockchain.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Wallet, Contract, getAddress, ZeroAddress } from 'ethers';
import * as ethersCore from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADDRESS_FILE = path.join(__dirname, 'match-result-address.json');
const ARTIFACT_PATH = path.join(__dirname, 'artifacts', 'contracts', 'MatchResult.sol', 'MatchResult.json');

const USE_ONCHAIN = !!(process.env.MATCH_RESULT_ADDRESS || fs.existsSync(ADDRESS_FILE));

let contract, provider, signer;

async function ensureContract() {
  if (contract) return contract;
  if (!USE_ONCHAIN) return null;

  const Address = process.env.MATCH_RESULT_ADDRESS || readAddressFile().address;
  if (!Address) throw new Error('MATCH_RESULT_ADDRESS not configured and no match-result-address.json found');

  provider = new JsonRpcProvider(process.env.NODE_HTTP_URL || 'http://127.0.0.1:8545');

  const pk = process.env.PRIVATE_KEY;
  if (pk) {
    signer = new Wallet(pk, provider);
  } else {
    signer = provider;
  }

  contract = new Contract(Address, MATCH_RESULT_ABI, signer);
  return contract;
}

function readAddressFile() {
  try {
    return JSON.parse(fs.readFileSync(ADDRESS_FILE, 'utf8'));
  } catch {
    return { address: null };
  }
}

const MATCH_RESULT_ABI = [
  'function recordMatch(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves) external',
  'function matchCount() external view returns (uint256)',
  'function getMatch(bytes32 matchId) external view returns (tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp))',
  'function getMatchByIndex(uint256 index) external view returns (tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp))',
  'event MatchRecorded(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp)',
];

function hexAddress(addr) {
  return getAddress(addr);
}

export function isOnchain() {
  return USE_ONCHAIN;
}

/// Record a completed match on-chain. Returns the receipt entry.
export async function recordMatch({ matchId, gameType, players, winner, moves }) {
  if (!USE_ONCHAIN) {
    return recordMatchSimulated({ matchId, gameType, players, winner, moves });
  }

  const c = await ensureContract();
  if (!c) throw new Error('On-chain recording requested but contract is not available');

  const matchIdBytes = crypto.createHash('sha256').update(matchId).digest(); // bytes32
  const playerA = hexAddress(players.X);
  const playerB = hexAddress(players.O);
  const winnerAddr = winner && winner !== 'draw' ? hexAddress(winner) : ZeroAddress;

  const tx = await c.recordMatch(matchIdBytes, gameType, winnerAddr, playerA, playerB, moves);
  const receipt = await tx.wait();

  const timestamp = Math.floor(Date.now() / 1000);
  const resultHash = '0x' + crypto.createHash('sha256')
    .update(JSON.stringify({ matchId, gameType, players, winner, moves, timestamp }))
    .digest('hex');

  return {
    matchId,
    gameType,
    players,
    winner: winner === 'draw' ? 'draw' : winner,
    timestamp,
    resultHash,
    txHash: receipt.hash,
  };
}

/// Fetch the full match ledger from the chain (newest first).
export async function getLedger() {
  if (!USE_ONCHAIN) {
    return getLedgerSimulated();
  }

  const c = await ensureContract();
  if (!c) throw new Error('On-chain ledger requested but contract is not available');

  const count = await c.matchCount();
  const entries = [];
  for (let i = 0; i < count; i++) {
    const match = await c.getMatchByIndex(i);
    entries.push({
      matchId: match.matchId,
      gameType: match.gameType,
      players: { X: match.playerA, O: match.playerB },
      winner: match.winner === ZeroAddress ? 'draw' : match.winner,
      timestamp: Number(match.timestamp),
      txHash: '0x' + (await c.getAddress()) + '0'.repeat(40), // placeholder; replace with actual tx hash if tracked
      resultHash: '0x' + crypto.createHash('sha256').update(JSON.stringify(match)).digest('hex'),
    });
  }
  return entries.reverse();
}

// ---- Simulated fallbacks (same shape as chain.js) ----

import { recordMatch as recordMatchSimulated, getLedger as getLedgerSimulated } from './chain.js';

export { recordMatchSimulated, getLedgerSimulated };
