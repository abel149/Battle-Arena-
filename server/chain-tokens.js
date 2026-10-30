/**
 * @file chain-tokens.js
 * @description ARENA token (ERC-20) and badge (ERC-1155) reward distribution.
 * Backed by ethers.js and deployed contracts (ArenaToken.sol and ArenaBadges.sol).
 *
 * Automatically enabled when `ARENA_TOKEN_ADDRESS` and `ARENA_BADGES_ADDRESS`
 * environment variables are present (or loaded from token-address.json).
 * Requires `NODE_HTTP_URL` and `PRIVATE_KEY` for server wallet minting rights.
 *
 * Fallback Mode: When unconfigured, falls back gracefully to simulated receipts (txHash: null)
 * allowing local test runners and dev servers to operate smoothly without a live blockchain.
 *
 * Badge IDs: Fixed according to store.js BADGE_DEFS indexing (id = index + 1).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Contract, formatUnits } from 'ethers';
import { getProvider, getSigner } from './signer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_ADDRESS_FILE = path.join(__dirname, 'token-address.json');

const ARENA_TOKEN_ABI = [
  'function mint(address to, uint256 value) external',
  'function mintBatch(address[] recipients, uint256[] values) external',
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
];

const ARENA_BADGES_ABI = [
  'function ensureBadge(uint256 id, string label) external',
  'function badgeLabel(uint256 id) view returns (string)',
  'function holderOf(uint256 id) view returns (address)',
  'function mint(address to, uint256 id) external',
  'function mintBatch(address[] recipients, uint256[] ids) external',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
];

/**
 * Reads token deployment artifact JSON if present on disk.
 *
 * @function readDeployment
 * @returns {Object | null} Parsed deployment JSON with contract addresses or null.
 */
function readDeployment() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_ADDRESS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const deployment = readDeployment();
const localDeployment =
  ['hardhat', 'hardhat-local', 'localhost'].includes(deployment?.network) ||
  Number(deployment?.chainId) === 31337;
const tokenAddress =
  process.env.ARENA_TOKEN_ADDRESS || (localDeployment ? null : deployment?.arenaToken);
const badgesAddress =
  process.env.ARENA_BADGES_ADDRESS || (localDeployment ? null : deployment?.arenaBadges);
const configuredTokenMatchesDeployment =
  tokenAddress?.toLowerCase() === deployment?.arenaToken?.toLowerCase();
const expectedChainId =
  process.env.ARENA_CHAIN_ID || (configuredTokenMatchesDeployment ? deployment?.chainId : null);
const USE_TOKENS_ONCHAIN = Boolean(tokenAddress && badgesAddress);

let provider, signer, tokenContract, badgesContract;

/**
 * Ensures Ethers contract instances for ArenaToken and ArenaBadges are initialized.
 *
 * @async
 * @function ensureContracts
 * @returns {Promise<{tokenContract: Contract, badgesContract: Contract} | null>} Connected contracts or null if tokens are off-chain.
 * @throws {Error} If NODE_HTTP_URL or PRIVATE_KEY are absent or contract bytecode is missing.
 */
async function ensureContracts() {
  if (tokenContract) return { tokenContract, badgesContract };
  if (!USE_TOKENS_ONCHAIN) return null;

  if (!process.env.NODE_HTTP_URL)
    throw new Error('NODE_HTTP_URL is required when on-chain rewards are enabled');
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY is required to mint on-chain rewards');

  provider = getProvider();
  const network = await provider.getNetwork();
  if (expectedChainId && network.chainId !== BigInt(expectedChainId)) {
    throw new Error(`Connected to chain ${network.chainId}, expected ${expectedChainId}`);
  }
  for (const [label, address] of [
    ['ArenaToken', tokenAddress],
    ['ArenaBadges', badgesAddress],
  ]) {
    const code = await provider.getCode(address);
    if (code === '0x')
      throw new Error(`No contract deployed at ${address} (${label}) on chain ${network.chainId}`);
  }

  // NonceManager avoids the automining nonce race: two sequential sends can
  // otherwise both read the same pending nonce (ensure/twin mints in one award).
  signer = getSigner();
  tokenContract = new Contract(tokenAddress, ARENA_TOKEN_ABI, signer);
  badgesContract = new Contract(badgesAddress, ARENA_BADGES_ABI, signer);
  return { tokenContract, badgesContract };
}

/**
 * Checks whether on-chain token & badge minting is enabled.
 *
 * @function isTokensOnchain
 * @returns {boolean} True if token and badge contracts are configured.
 */
export function isTokensOnchain() {
  return USE_TOKENS_ONCHAIN;
}

/**
 * Returns deployed addresses for ArenaToken and ArenaBadges contracts.
 *
 * @function tokenAddresses
 * @returns {{arenaToken: string, arenaBadges: string} | null} Deployed contract addresses or null.
 */
export function tokenAddresses() {
  return USE_TOKENS_ONCHAIN ? { arenaToken: tokenAddress, arenaBadges: badgesAddress } : null;
}

/**
 * Fetches the on-chain ARENA token balance for an Ethereum wallet.
 *
 * @async
 * @function tokenBalance
 * @param {string} address - Player wallet address to query.
 * @returns {Promise<number | null>} Balance formatted in whole ARENA units, or null if off-chain.
 */
export async function tokenBalance(address) {
  if (!USE_TOKENS_ONCHAIN) return null;
  const { tokenContract: c } = await ensureContracts();
  return Number(formatUnits(await c.balanceOf(hexAddress(address)), 18));
}

// Small helpers ------------------------------------------------------------

/**
 * Normalizes an address string to lowercase for safe contract interactions.
 * Avoids checksum complaints for synthetic bot accounts (e.g. 0xB070...00B).
 *
 * @function hexAddress
 * @param {string} a - Ethereum address.
 * @returns {string} Lowercase address string.
 */
const hexAddress = (a) => String(a).toLowerCase();

/**
 * Converts a whole ARENA token amount to 18-decimal wei integer BigInt.
 *
 * @function amountFor
 * @param {number|string} whole - Whole ARENA token units.
 * @returns {bigint} Token amount in 10^18 units.
 */
const amountFor = (whole) => BigInt(whole) * 10n ** 18n;

/**
 * Distributes match rewards (ERC-20 ARENA tokens and ERC-1155 badges) on-chain.
 * Uses batched mint transactions when multiple players receive tokens to save gas.
 *
 * @async
 * @function distributeRewards
 * @param {Array<{address: string, tokens: number, badges?: Array<{id: number, label: string}>}>} rewards - Array of reward targets.
 * @returns {Promise<Object.<string, {tokens: number, tokenTx: string | null, badges: Array<{id: number, label: string, tx: string | null}>, error?: string}>>} Result map keyed by player address.
 */
export async function distributeRewards(rewards) {
  if (!USE_TOKENS_ONCHAIN) {
    // Simulated fallback — same shape, no tx hashes.
    return Object.fromEntries(
      rewards.map((r) => [
        r.address,
        {
          tokens: r.tokens,
          tokenTx: null,
          badges: (r.badges || []).map((b) => ({ id: b.id, label: b.label, tx: null })),
        },
      ])
    );
  }

  const c = await ensureContracts();
  const out = {};

  // Gas Relayer Optimization: Batch token mints for multiple players in one tx
  const tokenRecipients = [];
  const tokenAmounts = [];
  for (const r of rewards) {
    if (r.tokens > 0) {
      tokenRecipients.push(hexAddress(r.address));
      tokenAmounts.push(amountFor(r.tokens));
    }
  }

  let sharedTokenTx = null;
  if (tokenRecipients.length > 1) {
    try {
      const tx = await c.tokenContract.mintBatch(tokenRecipients, tokenAmounts);
      const rc = await tx.wait();
      sharedTokenTx = rc.hash;
    } catch (err) {
      console.warn('Batch token mint fallback to individual mints:', err.message);
    }
  }

  for (const r of rewards) {
    const entry = { tokens: r.tokens, tokenTx: null, badges: [] };
    const to = hexAddress(r.address);
    if (r.tokens > 0) {
      if (sharedTokenTx) {
        entry.tokenTx = sharedTokenTx;
      } else {
        try {
          const tx = await c.tokenContract.mint(to, amountFor(r.tokens));
          const rc = await tx.wait();
          entry.tokenTx = rc.hash;
        } catch (err) {
          entry.error = `token mint failed: ${err.shortMessage || err.message}`;
        }
      }
    }
    for (const b of r.badges || []) {
      const item = { id: b.id, label: b.label, tx: null };
      try {
        const ensure = await c.badgesContract.ensureBadge(b.id, b.label);
        await ensure.wait();
        const mint = await c.badgesContract.mint(to, b.id);
        const rc = await mint.wait();
        item.tx = rc.hash;
      } catch (err) {
        item.error = `badge mint failed: ${err.shortMessage || err.message}`;
      }
      entry.badges.push(item);
    }
    out[r.address] = entry;
  }
  return out;
}
