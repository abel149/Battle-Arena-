/**
 * @file chain-chore.js
 * @description Parent-Backed Proof-of-Chore on-chain & simulated verification oracle ledger.
 * Connects to ProofOfChore.sol via ethers.js to record parent-verified real-world achievements.
 *
 * Falls back automatically to an off-chain JSON ledger file when blockchain access is unconfigured,
 * ensuring high availability and robust testing capabilities without mandatory RPC access.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Wallet, Contract, verifyMessage } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = path.join(__dirname, 'chore-ledger.json');
const ADDRESS_FILE = path.join(__dirname, 'chore-address.json');

/**
 * Reads chore contract deployment artifact if available on disk.
 *
 * @function readDeployment
 * @returns {Object | null} Parsed deployment JSON with contract address or null.
 */
function readDeployment() {
  try {
    return JSON.parse(fs.readFileSync(ADDRESS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const deployment = readDeployment();
const configuredAddress = process.env.CHORE_ORACLE_ADDRESS || deployment?.address;
const USE_ONCHAIN = Boolean(configuredAddress && process.env.NODE_HTTP_URL);

let contract = null;

/**
 * Initializes and caches the ProofOfChore contract instance connected to signer.
 *
 * @async
 * @function ensureContract
 * @returns {Promise<Contract | null>} Initialized ProofOfChore contract or null.
 */
async function ensureContract() {
  if (contract) return contract;
  if (!USE_ONCHAIN) return null;

  const provider = new JsonRpcProvider(process.env.NODE_HTTP_URL);
  const signerKey = process.env.PRIVATE_KEY || process.env.BASE_SEPOLIA_PRIVATE_KEY;
  if (!signerKey) return null;

  const signer = new Wallet(signerKey, provider);
  const artifactPath = path.join(
    __dirname,
    'artifacts/contracts/ProofOfChore.sol/ProofOfChore.json'
  );
  if (!fs.existsSync(artifactPath)) return null;

  const { abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  contract = new Contract(configuredAddress, abi, signer);
  return contract;
}

/**
 * Checks if on-chain ProofOfChore contract is actively configured.
 *
 * @function isChoreOnchain
 * @returns {boolean} True if on-chain chore oracle is configured.
 */
export function isChoreOnchain() {
  return USE_ONCHAIN;
}

/**
 * Reads local fallback chore verification ledger from disk.
 *
 * @function readLedger
 * @returns {Array<Object>} List of recorded chore verification objects.
 */
function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Persists fallback chore verification ledger to disk.
 *
 * @function writeLedger
 * @param {Array<Object>} entries - Array of chore entries.
 */
function writeLedger(entries) {
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Records a parent-verified chore completion on-chain or to local simulated ledger.
 *
 * @async
 * @function recordChoreVerification
 * @param {Object} params - Chore verification parameters.
 * @param {string} params.choreId - Unique chore task identifier.
 * @param {string} params.kidAddress - Child player wallet address.
 * @param {string} params.parentAddress - Parent oracle wallet address.
 * @param {string} params.title - Name / description of completed task.
 * @param {string} params.category - Chore classification category.
 * @param {number} [params.energyGranted=2] - Game energy units granted.
 * @param {number} [params.allowanceGranted=5] - Token allowance units awarded.
 * @returns {Promise<Object>} Verification record with receipt or cryptographic hash.
 */
export async function recordChoreVerification({
  choreId,
  kidAddress,
  parentAddress,
  title,
  category,
  energyGranted = 2,
  allowanceGranted = 5,
}) {
  const timestamp = Date.now();
  const c = await ensureContract().catch((err) => {
    console.warn('ProofOfChore onchain init failed, using simulated ledger:', err.message);
    return null;
  });

  if (c) {
    try {
      const tx = await c.verifyChore(
        kidAddress,
        choreId,
        title,
        category,
        energyGranted,
        allowanceGranted
      );
      const receipt = await tx.wait();
      const hash = receipt.hash || tx.hash;
      return {
        choreId,
        kidAddress,
        parentAddress,
        title,
        category,
        energyGranted,
        allowanceGranted,
        timestamp,
        txHash: hash,
        verifiedOnchain: true,
      };
    } catch (err) {
      console.warn('ProofOfChore onchain transaction failed, falling back:', err.message);
    }
  }

  // Simulated fallback ledger
  const proofPayload = `${parentAddress}:${kidAddress}:${choreId}:${timestamp}`;
  const choreHash = '0x' + crypto.createHash('sha256').update(proofPayload).digest('hex');
  const record = {
    choreId,
    choreHash,
    kidAddress,
    parentAddress,
    title,
    category,
    energyGranted,
    allowanceGranted,
    timestamp,
    txHash: choreHash,
    verifiedOnchain: false,
  };

  const ledger = readLedger();
  ledger.unshift(record);
  if (ledger.length > 500) ledger.length = 500;
  writeLedger(ledger);

  return record;
}

/**
 * Retrieves chore ledger entries, optionally filtered by child player wallet.
 *
 * @function getChoreLedger
 * @param {string} [kidAddress=null] - Optional child wallet address filter.
 * @returns {Array<Object>} Chore verification ledger records.
 */
export function getChoreLedger(kidAddress = null) {
  const entries = readLedger();
  if (!kidAddress) return entries;
  return entries.filter((e) => e.kidAddress.toLowerCase() === kidAddress.toLowerCase());
}

/**
 * Validates an EIP-191 personal sign attestation from a parent oracle.
 *
 * @function verifyParentAttestation
 * @param {string} signature - Hex-encoded EIP-191 signature string.
 * @param {string} parentAddress - Expected parent oracle wallet address.
 * @param {string} message - Original plain-text message that was signed.
 * @returns {boolean} True if signature was verifiably produced by parentAddress.
 */
export function verifyParentAttestation(signature, parentAddress, message) {
  if (!signature || !parentAddress || !message) return false;
  try {
    const recovered = verifyMessage(message, signature);
    return recovered.toLowerCase() === parentAddress.toLowerCase();
  } catch {
    return false;
  }
}
