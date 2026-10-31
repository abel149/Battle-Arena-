/**
 * @file chain-signer.js
 * @description Provider and NonceManager singleton factory for EVM wallet management.
 * Provides unified access to the server signing wallet across multiple chain modules.
 */

import { JsonRpcProvider, Wallet, NonceManager } from 'ethers';

/**
 * @typedef {Object} SharedSignerBundle
 * @property {JsonRpcProvider} provider - The initialized Ethers JSON-RPC provider.
 * @property {NonceManager | null} signer - NonceManager wrapped wallet instance, or null if read-only.
 */

/** @type {SharedSignerBundle | null} Cached shared signer bundle */
let shared = null;

/**
 * Returns the cached provider and NonceManager signer bundle.
 *
 * @function getSharedSigner
 * @returns {SharedSignerBundle} Object containing { provider, signer }.
 * @throws {Error} If `NODE_HTTP_URL` is not defined in environment.
 */
export function getSharedSigner() {
  if (shared) return shared;
  if (!process.env.NODE_HTTP_URL)
    throw new Error('NODE_HTTP_URL is required for on-chain features');
  const provider = new JsonRpcProvider(process.env.NODE_HTTP_URL);
  const signer = process.env.PRIVATE_KEY
    ? new NonceManager(new Wallet(process.env.PRIVATE_KEY, provider))
    : null; // read-only (no PRIVATE_KEY): callers fall back to the provider
  shared = { provider, signer };
  return shared;
}
