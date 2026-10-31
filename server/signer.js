/**
 * @file signer.js
 * @description Shared Ethereum JSON-RPC provider and NonceManager-wrapped signer.
 * Both `chain-onchain.js` (match results) and `chain-tokens.js` (token & badge mints)
 * dispatch transactions from the same `PRIVATE_KEY` account.
 * Using a single global NonceManager across the entire server process prevents
 * nonce divergence, transaction replacement failures, and `NONCE_EXPIRED` errors.
 */

import { JsonRpcProvider, Wallet, NonceManager } from 'ethers';

/** @type {JsonRpcProvider | null} Global cached JSON-RPC provider instance */
let provider = null;

/** @type {NonceManager | null} Global cached NonceManager signer instance */
let signer = null;

/**
 * Returns the singleton JsonRpcProvider connected to NODE_HTTP_URL.
 *
 * @function getProvider
 * @returns {JsonRpcProvider} Configured Ethers JSON-RPC provider.
 * @throws {Error} If `NODE_HTTP_URL` environment variable is not set.
 */
export function getProvider() {
  if (!provider) {
    if (!process.env.NODE_HTTP_URL)
      throw new Error('NODE_HTTP_URL is required for on-chain access');
    provider = new JsonRpcProvider(process.env.NODE_HTTP_URL);
  }
  return provider;
}

/**
 * Returns the singleton NonceManager-wrapped Wallet for on-chain signing.
 * Returns null if `PRIVATE_KEY` is not configured (read-only mode).
 *
 * @function getSigner
 * @returns {NonceManager | null} NonceManager instance or null in read-only environment.
 */
export function getSigner() {
  if (!process.env.PRIVATE_KEY) return null;
  if (!signer) signer = new NonceManager(new Wallet(process.env.PRIVATE_KEY, getProvider()));
  return signer;
}
