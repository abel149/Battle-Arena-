// ONE provider + ONE NonceManager for the server wallet, shared by chain-onchain.js
// (match results) and chain-tokens.js (ARENA tokens + badges).
import { JsonRpcProvider, Wallet, NonceManager } from 'ethers';

let shared = null;

export function getSharedSigner() {
  if (shared) return shared;
  if (!process.env.NODE_HTTP_URL) throw new Error('NODE_HTTP_URL is required for on-chain features');
  const provider = new JsonRpcProvider(process.env.NODE_HTTP_URL);
  const signer = process.env.PRIVATE_KEY
    ? new NonceManager(new Wallet(process.env.PRIVATE_KEY, provider))
    : null; // read-only (no PRIVATE_KEY): callers fall back to the provider
  shared = { provider, signer };
  return shared;
}