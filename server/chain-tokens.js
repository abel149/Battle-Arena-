// ARENA token (ERC-20) + badge (ERC-1155) reward distribution, backed by
// ethers.js + ArenaToken.sol / ArenaBadges.sol.
// Enabled when ARENA_TOKEN_ADDRESS + ARENA_BADGES_ADDRESS env vars are set
// (or when a token-address.json deployment file exists for the local node).
// Requires NODE_HTTP_URL and PRIVATE_KEY so the server wallet can mint.
// When not configured, this module falls back to a simulated receipt
// (txHash: null) so local dev works without a blockchain â€” same pattern as
// chain-onchain.js.
//
// The canonical badge ids are fixed in store.js BADGE_DEFS order (id = index
// + 1), so ensureBadge(id, label) creates deterministic on-chain badge types.

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

function readDeployment() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_ADDRESS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const deployment = readDeployment();
const localDeployment = ['hardhat', 'hardhat-local', 'localhost'].includes(deployment?.network)
  || Number(deployment?.chainId) === 31337;
const tokenAddress = process.env.ARENA_TOKEN_ADDRESS || (localDeployment ? null : deployment?.arenaToken);
const badgesAddress = process.env.ARENA_BADGES_ADDRESS || (localDeployment ? null : deployment?.arenaBadges);
const configuredTokenMatchesDeployment = tokenAddress?.toLowerCase() === deployment?.arenaToken?.toLowerCase();
const expectedChainId = process.env.ARENA_CHAIN_ID
  || (configuredTokenMatchesDeployment ? deployment?.chainId : null);
const USE_TOKENS_ONCHAIN = Boolean(tokenAddress && badgesAddress);

let provider, signer, tokenContract, badgesContract;

async function ensureContracts() {
  if (tokenContract) return { tokenContract, badgesContract };
  if (!USE_TOKENS_ONCHAIN) return null;

  if (!process.env.NODE_HTTP_URL) throw new Error('NODE_HTTP_URL is required when on-chain rewards are enabled');
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY is required to mint on-chain rewards');

  provider = getProvider();
  const network = await provider.getNetwork();
  if (expectedChainId && network.chainId !== BigInt(expectedChainId)) {
    throw new Error(`Connected to chain ${network.chainId}, expected ${expectedChainId}`);
  }
  for (const [label, address] of [['ArenaToken', tokenAddress], ['ArenaBadges', badgesAddress]]) {
    const code = await provider.getCode(address);
    if (code === '0x') throw new Error(`No contract deployed at ${address} (${label}) on chain ${network.chainId}`);
  }

  // NonceManager avoids the automining nonce race: two sequential sends can
  // otherwise both read the same pending nonce (ensure/twin mints in one award).
  signer = getSigner();
  tokenContract = new Contract(tokenAddress, ARENA_TOKEN_ABI, signer);
  badgesContract = new Contract(badgesAddress, ARENA_BADGES_ABI, signer);
  return { tokenContract, badgesContract };
}

export function isTokensOnchain() {
  return USE_TOKENS_ONCHAIN;
}

export function tokenAddresses() {
  return USE_TOKENS_ONCHAIN ? { arenaToken: tokenAddress, arenaBadges: badgesAddress } : null;
}

export async function tokenBalance(address) {
  if (!USE_TOKENS_ONCHAIN) return null;
  const { tokenContract: c } = await ensureContracts();
  return Number(formatUnits(await c.balanceOf(hexAddress(address)), 18));
}

// Small helpers ------------------------------------------------------------

// Lowercase hex addresses are always valid for ethers calls; avoids checksum
// complaints for internal bot addresses like 0xB070â€¦00B.
const hexAddress = a => String(a).toLowerCase();

// ARENA has 18 decimals; store.js counts whole ARENA units (10 / 3 / 1 ...).
const amountFor = whole => BigInt(whole) * 10n ** 18n;

/**
 * Distribute match rewards on-chain.
 * rewards: [{ address, tokens, badges: [{ id, label }] }]
 * Returns: { address: { tokens: n, tokenTx: '0xâ€¦' | null,
 *                       badges: [{ id, label, tx: '0xâ€¦' | null }] } }
 * Per-award errors are captured in `.error` so one bad address cannot
 * block the other player's payout.
 */
export async function distributeRewards(rewards) {
  if (!USE_TOKENS_ONCHAIN) {
    // Simulated fallback â€” same shape, no tx hashes.
    return Object.fromEntries(rewards.map(r => [r.address, {
      tokens: r.tokens,
      tokenTx: null,
      badges: (r.badges || []).map(b => ({ id: b.id, label: b.label, tx: null })),
    }]));
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
