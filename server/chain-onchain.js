// On-chain match recording backed by ethers.js + MatchResult.sol.
// Swap this in for chain.js by setting MATCH_RESULT_ADDRESS and either
// NODE_HTTP_URL (for a real RPC) or running against a local Hardhat/Anvil node.
//
// When the env is not configured, this module falls back to the simulated
// ledger so the server still works for local dev without a blockchain.
//
// Match ID handling:
//   The contract stores matchId as bytes32. Newer deployments encode the
//   original server matchId as a bytes32 string via encodeBytes32String, so
//   it can be recovered with decodeBytes32String. Older deployments may hash
//   the matchId; in that case we cannot recover the original value and we keep
//   the raw bytes32. To keep the rest of the server and the REST API from
//   depending on which encoding a deployment used, this module returns a
//   normalized entry shape with both fields:
//     matchId        - the best-effort decoded original matchId, or the raw
//                      bytes32 value if decoding is not possible
//     matchIdRaw     - the exact bytes32 value stored on-chain (lowercase)
//   The verify/ledger paths always use matchId for lookup, and leave
//   matchIdRaw available when on-chain proof details matter.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Wallet, Contract, NonceManager, getAddress, ZeroAddress, encodeBytes32String, decodeBytes32String } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADDRESS_FILE = path.join(__dirname, 'match-result-address.json');

function readDeployment() {
  try {
    return JSON.parse(fs.readFileSync(ADDRESS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const deployment = readDeployment();
const localDeployment = ['hardhat', 'hardhat-local', 'localhost'].includes(deployment?.network)
  || Number(deployment?.chainId) === 31337;
const deploymentAddress = localDeployment ? null : deployment?.address;
const configuredAddress = process.env.MATCH_RESULT_ADDRESS || deploymentAddress;
const configuredAddressMatchesDeployment = configuredAddress?.toLowerCase() === deploymentAddress?.toLowerCase();
const expectedChainId = process.env.MATCH_RESULT_CHAIN_ID
  || (configuredAddressMatchesDeployment ? deployment?.chainId : null);
const USE_ONCHAIN = Boolean(configuredAddress);

let contract, provider, signer;

async function ensureContract() {
  if (contract) return contract;
  if (!USE_ONCHAIN) return null;

  const address = configuredAddress;
  if (!address) throw new Error('Set MATCH_RESULT_ADDRESS to enable on-chain recording');
  if (!process.env.NODE_HTTP_URL) throw new Error('NODE_HTTP_URL is required when on-chain recording is enabled');

  provider = new JsonRpcProvider(process.env.NODE_HTTP_URL);
  const network = await provider.getNetwork();
  if (expectedChainId && network.chainId !== BigInt(expectedChainId)) {
    throw new Error(`Connected to chain ${network.chainId}, expected ${expectedChainId}`);
  }
  const code = await provider.getCode(address);
  if (code === '0x') throw new Error(`No contract deployed at ${address} on chain ${network.chainId}`);

  signer = process.env.PRIVATE_KEY
    ? new NonceManager(new Wallet(process.env.PRIVATE_KEY, provider))
    : provider;
  contract = new Contract(address, MATCH_RESULT_ABI, signer);
  return contract;
}

const MATCH_RESULT_ABI = [
  'function recordMatch(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves) external',
  'function matchCount() external view returns (uint256)',
  'function getMatch(bytes32 matchId) external view returns (tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp))',
  'function getMatchByIndex(uint256 index) external view returns (tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp))',
  'event MatchRecorded(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp)',
];

// Runtime type tag so other modules can tell whether a ledger/entry came from
// the on-chain path or the simulated fallback.
export const ONCHAIN_LABELS = {
  matchIdField: 'matchId',
  matchIdRawField: 'matchIdRaw',
};

// Normalize an address for ethers calls and for the normalized ledger shape.
function hexAddress(addr) {
  return getAddress(addr);
}

// Best-effort recovery of the original matchId from the on-chain bytes32.
// Older deployments that hashed matchIds cannot recover the original value;
// in that case we keep the raw bytes32 and surface it as matchIdRaw.
function decodeMatchId(value) {
  try {
    return decodeBytes32String(value);
  } catch {
    // Older deployments hashed match IDs and cannot recover the original room ID.
    return value.toLowerCase();
  }
}

function normalizeMatch(match) {
  const matchIdRaw = match.matchId.toLowerCase();
  const matchId = decodeMatchId(match.matchId);
  const players = {
    X: hexAddress(match.playerA),
    O: hexAddress(match.playerB),
  };
  const winner = match.winner.toLowerCase() === ZeroAddress.toLowerCase()
    ? 'draw'
    : hexAddress(match.winner);
  const timestamp = Number(match.timestamp);
  const gameType = match.gameType;
  const moves = Number(match.moves);
  const resultHash = '0x' + crypto.createHash('sha256')
    .update(JSON.stringify({ matchId, gameType, players, winner, moves, timestamp }))
    .digest('hex');
  return { matchId, matchIdRaw, gameType, players, winner, timestamp, moves, resultHash };
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

  if (!process.env.PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY is required to submit on-chain match results');
  }

  if (Buffer.byteLength(matchId, 'utf8') > 31) {
    throw new Error('Match ID must be 31 UTF-8 bytes or fewer to be stored on-chain');
  }
  const matchIdBytes = encodeBytes32String(matchId);
  const playerA = hexAddress(players.X);
  const playerB = hexAddress(players.O);
  const winnerAddr = winner && winner !== 'draw' ? hexAddress(winner) : ZeroAddress;

  const moveCount = Array.isArray(moves) ? moves.length : Number(moves);
  const tx = await c.recordMatch(matchIdBytes, gameType, winnerAddr, playerA, playerB, moveCount);
  const receipt = await tx.wait();
  const recorded = normalizeMatch(await c.getMatch(matchIdBytes));
  // Return the on-chain fields plus the transaction hash from the submitted tx.
  // matchId is the best-effort decoded original; on current deployments this is
  // the same string that was passed in. matchIdRaw is the exact bytes32 on-chain.
  return { ...recorded, txHash: receipt.hash };
}

/**
 * Fetch the full match ledger from the chain (newest first).
 *
 * Each entry uses the normalized shape from chain-onchain.js, with both:
 *   matchId     - best-effort decoded original matchId, or raw bytes32
 *   matchIdRaw  - exact bytes32 stored on-chain (lowercase)
 * Simulated fallbacks use the same shape but with matchIdRaw equal to matchId.
 */
export async function getLedger() {
  if (!USE_ONCHAIN) {
    return getLedgerSimulated().map(normalizeLedgerEntry);
  }

  const c = await ensureContract();
  if (!c) throw new Error('On-chain ledger requested but contract is not available');

  const [count, events] = await Promise.all([
    c.matchCount(),
    c.queryFilter(c.filters.MatchRecorded(), 0, 'latest'),
  ]);
  const txHashByMatchId = new Map(events.map(event => [
    decodeMatchId(event.args.matchId).toLowerCase(),
    event.transactionHash,
  ]));
  const entries = [];
  for (let i = 0; i < Number(count); i++) {
    const match = normalizeMatch(await c.getMatchByIndex(i));
    entries.push({ ...match, txHash: txHashByMatchId.get(match.matchId.toLowerCase()) || null });
  }
  return entries.reverse();
}

// ---- Simulated fallbacks (same shape as chain.js) ----

import { recordMatch as recordMatchSimulated, getLedger as getLedgerSimulated } from './chain.js';

export { recordMatchSimulated, getLedgerSimulated };

// Keep the simulated fallback compatible with the normalized on-chain shape so
// callers do not have to branch on whether recording went on-chain or not.
export function normalizeLedgerEntry(entry) {
  // The on-chain path already returns normalized entries. For the simulated
  // path, matchIdRaw is the same as matchId because the ledger is stored as
  // plain strings, not as bytes32.
  return {
    ...entry,
    matchIdRaw: entry.matchIdRaw || entry.matchId.toLowerCase(),
  };
}
