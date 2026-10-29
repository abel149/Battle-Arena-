// Parent-Backed Proof-of-Chore on-chain & simulated verification ledger.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JsonRpcProvider, Wallet, Contract, verifyMessage } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_FILE = path.join(__dirname, 'chore-ledger.json');
const ADDRESS_FILE = path.join(__dirname, 'chore-address.json');

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

async function ensureContract() {
  if (contract) return contract;
  if (!USE_ONCHAIN) return null;

  const provider = new JsonRpcProvider(process.env.NODE_HTTP_URL);
  const signerKey = process.env.PRIVATE_KEY || process.env.BASE_SEPOLIA_PRIVATE_KEY;
  if (!signerKey) return null;

  const signer = new Wallet(signerKey, provider);
  const artifactPath = path.join(__dirname, 'artifacts/contracts/ProofOfChore.sol/ProofOfChore.json');
  if (!fs.existsSync(artifactPath)) return null;

  const { abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  contract = new Contract(configuredAddress, abi, signer);
  return contract;
}

export function isChoreOnchain() {
  return USE_ONCHAIN;
}

function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLedger(entries) {
  fs.writeFileSync(LEDGER_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Record a chore verification on-chain or to the fallback ledger.
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
  const c = await ensureContract().catch(err => {
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

export function getChoreLedger(kidAddress = null) {
  const entries = readLedger();
  if (!kidAddress) return entries;
  return entries.filter(e => e.kidAddress.toLowerCase() === kidAddress.toLowerCase());
}

/**
 * Verify Parent Oracle signature (EIP-191)
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
