// Shared provider + signing wallet for every on-chain module.
//
// chain-onchain.js (match recording) and chain-tokens.js (token/badge mints)
// send transactions from the same PRIVATE_KEY account. If each module wraps
// the key in its own NonceManager, their local nonce counters diverge from the
// chain's real nonce (NONCE_EXPIRED). One provider + one NonceManager for the
// whole process keeps every send on a single nonce counter.

import { JsonRpcProvider, Wallet, NonceManager } from 'ethers';

let provider = null;
let signer = null;

export function getProvider() {
  if (!provider) {
    if (!process.env.NODE_HTTP_URL) throw new Error('NODE_HTTP_URL is required for on-chain access');
    provider = new JsonRpcProvider(process.env.NODE_HTTP_URL);
  }
  return provider;
}

// NonceManager-wrapped wallet, or null when PRIVATE_KEY is unset (read-only).
export function getSigner() {
  if (!process.env.PRIVATE_KEY) return null;
  if (!signer) signer = new NonceManager(new Wallet(process.env.PRIVATE_KEY, getProvider()));
  return signer;
}
