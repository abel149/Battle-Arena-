/**
 * @file chain-onchain.js
 * @description On-chain match recording backed by ethers.js and MatchResult.sol.
 * Configured via MATCH_RESULT_ADDRESS and NODE_HTTP_URL (or local Hardhat/Anvil RPC).
 *
 * Falls back deterministically to the local simulated ledger (chain.js) when unconfigured,
 * ensuring seamless execution for local test runners and offline development.
 *
 * Match ID handling:
 *   The contract stores matchId as bytes32. Newer deployments encode the
 *   original server matchId as a bytes32 string via encodeBytes32String, so
 *   it can be recovered with decodeBytes32String. Older deployments may hash
 *   the matchId; in that case we cannot recover the original value and we keep
 *   the raw bytes32. To keep the rest of the server and the REST API from
 *   depending on which encoding a deployment used, this module returns a
 *   normalized entry shape with both fields:
 *     matchId        - the best-effort decoded original matchId, or the raw
 *                      bytes32 value if decoding is not possible
 *     matchIdRaw     - the exact bytes32 value stored on-chain (lowercase)
 *   The verify/ledger paths always use matchId for lookup, and leave
 *   matchIdRaw available when on-chain proof details matter.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Contract,
  getAddress,
  ZeroAddress,
  encodeBytes32String,
  decodeBytes32String,
} from 'ethers';
import { getProvider, getSigner } from './signer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADDRESS_FILE = path.join(__dirname, 'match-result-address.json');

/**
 * Reads local deployment artifact JSON if present.
 *
 * @function readDeployment
 * @returns {Object | null} Parsed deployment JSON with address and chainId, or null if absent.
 */
function readDeployment() {
  try {
    return JSON.parse(fs.readFileSync(ADDRESS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const deployment = readDeployment();
const localDeployment =
  ['hardhat', 'hardhat-local', 'localhost'].includes(deployment?.network) ||
  Number(deployment?.chainId) === 31337;
const deploymentAddress = localDeployment ? null : deployment?.address;
const configuredAddress = process.env.MATCH_RESULT_ADDRESS || deploymentAddress;
const configuredAddressMatchesDeployment =
  configuredAddress?.toLowerCase() === deploymentAddress?.toLowerCase();
const expectedChainId =
  process.env.MATCH_RESULT_CHAIN_ID ||
  (configuredAddressMatchesDeployment ? deployment?.chainId : null);
const USE_ONCHAIN = Boolean(configuredAddress);

let contract, provider, signer;

/**
 * Initializes and caches the Ethers contract instance for MatchResult.
 *
 * @async
 * @function ensureContract
 * @returns {Promise<Contract | null>} Contract instance or null if on-chain mode is inactive.
 * @throws {Error} If required environment variables are missing or network chain ID mismatches.
 */
async function ensureContract() {
  if (contract) return contract;
  if (!USE_ONCHAIN) return null;

  const address = configuredAddress;
  if (!address) throw new Error('Set MATCH_RESULT_ADDRESS to enable on-chain recording');
  if (!process.env.NODE_HTTP_URL)
    throw new Error('NODE_HTTP_URL is required when on-chain recording is enabled');

  provider = getProvider();
  const network = await provider.getNetwork();
  if (expectedChainId && network.chainId !== BigInt(expectedChainId)) {
    throw new Error(`Connected to chain ${network.chainId}, expected ${expectedChainId}`);
  }
  const code = await provider.getCode(address);
  if (code === '0x')
    throw new Error(`No contract deployed at ${address} on chain ${network.chainId}`);

  // Shared NonceManager (signer.js) — must be the same instance chain-tokens.js uses.
  signer = getSigner() || provider;
  contract = new Contract(address, MATCH_RESULT_ABI, signer);
  return contract;
}

const MATCH_RESULT_ABI = [
  'function recordMatch(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves) external',
  'function recordMatchBatch(tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves)[] inputs) external',
  'function matchCount() external view returns (uint256)',
  'function getMatch(bytes32 matchId) external view returns (tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp))',
  'function getMatchByIndex(uint256 index) external view returns (tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp))',
  'event MatchRecorded(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp)',
];

/**
 * Runtime field mapping labels for cross-module ledger format compatibility.
 * @constant {Object}
 */
export const ONCHAIN_LABELS = {
  matchIdField: 'matchId',
  matchIdRawField: 'matchIdRaw',
};

/**
 * Normalizes an Ethereum address into checksum format.
 *
 * @function hexAddress
 * @param {string} addr - Raw Ethereum address string.
 * @returns {string} EIP-55 checksummed hex address string.
 */
function hexAddress(addr) {
  return getAddress(addr);
}

/**
 * Decodes a bytes32 string back to a readable UTF-8 string.
 * Falls back to lowercase hex representation if bytes32 was hashed.
 *
 * @function decodeMatchId
 * @param {string} value - Bytes32 hex string from blockchain storage.
 * @returns {string} Decoded human-readable match ID or hex string.
 */
function decodeMatchId(value) {
  try {
    return decodeBytes32String(value);
  } catch {
    // Older deployments hashed match IDs and cannot recover the original room ID.
    return value.toLowerCase();
  }
}

/**
 * Normalizes raw contract match struct data into standardized server match record shape.
 *
 * @function normalizeMatch
 * @param {Object} match - Raw match struct returned from ethers Contract call.
 * @returns {Object} Normalized match entry object with hash and player addresses.
 */
function normalizeMatch(match) {
  const matchIdRaw = match.matchId.toLowerCase();
  const matchId = decodeMatchId(match.matchId);
  const players = {
    X: hexAddress(match.playerA),
    O: hexAddress(match.playerB),
  };
  const winner =
    match.winner.toLowerCase() === ZeroAddress.toLowerCase() ? 'draw' : hexAddress(match.winner);
  const timestamp = Number(match.timestamp);
  const gameType = match.gameType;
  const moves = Number(match.moves);
  const resultHash =
    '0x' +
    crypto
      .createHash('sha256')
      .update(JSON.stringify({ matchId, gameType, players, winner, moves, timestamp }))
      .digest('hex');
  return { matchId, matchIdRaw, gameType, players, winner, timestamp, moves, resultHash };
}

/**
 * Checks whether live on-chain recording is enabled via configuration.
 *
 * @function isOnchain
 * @returns {boolean} True if on-chain contract address is configured, false otherwise.
 */
export function isOnchain() {
  return USE_ONCHAIN;
}

// Human-readable chain info for the front end (GET /api/chain/status).
const CHAIN_NAMES = {
  31337: 'Local Hardhat',
  84532: 'Base Sepolia',
  8453: 'Base',
  80002: 'Polygon Amoy',
  11155111: 'Sepolia',
};

// Block-explorer tx URL prefixes. The local Hardhat chain has no explorer.
const EXPLORER_TX = {
  84532: 'https://sepolia.basescan.org/tx/',
  8453: 'https://basescan.org/tx/',
  80002: 'https://amoy.polygonscan.com/tx/',
  11155111: 'https://sepolia.etherscan.io/tx/',
};

/**
 * Retrieves human-readable network, block, and contract diagnostics for client UI display.
 *
 * @async
 * @function chainInfo
 * @returns {Promise<Object>} Object containing chain status, network name, block number, and explorer links.
 */
export async function chainInfo() {
  if (!USE_ONCHAIN) {
    return {
      onchain: false,
      network: 'Simulated ledger',
      chainId: null,
      blockNumber: null,
      contract: null,
      explorerTx: null,
    };
  }
  try {
    await ensureContract();
    const [network, blockNumber] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
    ]);
    const chainId = Number(network.chainId);
    return {
      onchain: true,
      network: CHAIN_NAMES[chainId] || `Chain ${chainId}`,
      chainId,
      blockNumber,
      contract: configuredAddress,
      explorerTx: EXPLORER_TX[chainId] || null,
    };
  } catch (err) {
    return {
      onchain: true,
      error: err.message,
      network: 'Chain unreachable',
      chainId: null,
      blockNumber: null,
      contract: configuredAddress,
      explorerTx: null,
    };
  }
}

/**
 * Records a single completed match on-chain (or in simulated ledger if on-chain is disabled).
 *
 * @async
 * @function recordMatch
 * @param {Object} params - Match details.
 * @param {string} params.matchId - Unique match identifier (max 31 UTF-8 bytes for bytes32 storage).
 * @param {string} params.gameType - Name of game (e.g. 'memory', 'math', 'connectfour', 'cyberblaster').
 * @param {Object} params.players - Map of players ({ X: address, O: address }).
 * @param {string} params.winner - Winner wallet address, or 'draw'.
 * @param {Array|number} params.moves - Array of move records or total count.
 * @returns {Promise<Object>} Normalized match entry augmented with transaction hash `txHash`.
 * @throws {Error} If private key is missing or matchId exceeds 31 bytes.
 */
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
 * Batch records multiple completed matches in a single atomic transaction.
 *
 * @async
 * @function recordMatchBatch
 * @param {Array<Object>} matchesList - List of match objects to record atomically.
 * @returns {Promise<Object>} Object with transaction hash `txHash` and total count.
 */
export async function recordMatchBatch(matchesList) {
  if (!USE_ONCHAIN) {
    return matchesList.map((m) => recordMatchSimulated(m));
  }
  const c = await ensureContract();
  if (!c) throw new Error('On-chain recording requested but contract is not available');

  const formattedInputs = matchesList.map((m) => ({
    matchId: encodeBytes32String(m.matchId),
    gameType: m.gameType,
    winner: m.winner && m.winner !== 'draw' ? hexAddress(m.winner) : ZeroAddress,
    playerA: hexAddress(m.players.X),
    playerB: hexAddress(m.players.O),
    moves: Array.isArray(m.moves) ? m.moves.length : Number(m.moves),
  }));

  const tx = await c.recordMatchBatch(formattedInputs);
  const rc = await tx.wait();
  return { txHash: rc.hash, count: matchesList.length };
}

/**
 * Fetches the full match ledger from the chain (or simulation), newest records first.
 * Each entry uses the normalized shape with both matchId and matchIdRaw.
 *
 * @async
 * @function getLedger
 * @returns {Promise<Array<Object>>} Array of match entries with on-chain metadata and tx hashes.
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
  const txHashByMatchId = new Map(
    events.map((event) => [decodeMatchId(event.args.matchId).toLowerCase(), event.transactionHash])
  );
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

/**
 * Normalizes a simulated ledger entry to match the on-chain shape.
 *
 * @function normalizeLedgerEntry
 * @param {Object} entry - Ledger entry object.
 * @returns {Object} Normalized ledger entry with `matchIdRaw` field populated.
 */
export function normalizeLedgerEntry(entry) {
  // The on-chain path already returns normalized entries. For the simulated
  // path, matchIdRaw is the same as matchId because the ledger is stored as
  // plain strings, not as bytes32.
  return {
    ...entry,
    matchIdRaw: entry.matchIdRaw || entry.matchId.toLowerCase(),
  };
}
