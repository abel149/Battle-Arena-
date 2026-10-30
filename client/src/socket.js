/**
 * @file socket.js
 * @description WebSocket client connection, EIP-191 message signing, and session token management.
 * Provides unified authentication transport supporting both Web3 wallet signatures (MetaMask / embedded secp256k1)
 * and bearer session tokens with global automatic authorization header injection for fetch requests.
 */

import { io } from 'socket.io-client';
import { ethers } from 'ethers';

const defaultServer = typeof window !== 'undefined' && window.location?.hostname
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : 'http://localhost:3001';
const SERVER_URL = import.meta.env.VITE_SERVER_URL || defaultServer;

/** @type {import('socket.io-client').Socket} Singleton WebSocket connection instance */
export const socket = io(SERVER_URL, { autoConnect: true });

/** @type {string} Base URL for backend HTTP API endpoints */
export const API = SERVER_URL;

const SESSION_KEY = 'arena_session';
const WALLET_KEY = 'arena_wallet';

/**
 * Retrieves the current session Bearer token from localStorage.
 *
 * @function getSessionToken
 * @returns {string | null} Stored session token or null.
 */
export const getSessionToken = () => localStorage.getItem(SESSION_KEY);

/**
 * Persists an authenticated session Bearer token into localStorage.
 *
 * @function saveSessionToken
 * @param {string} token - Session token string.
 */
export const saveSessionToken = token => localStorage.setItem(SESSION_KEY, token);

/**
 * Clears the authenticated session token from localStorage.
 *
 * @function clearSessionToken
 */
export const clearSessionToken = () => localStorage.removeItem(SESSION_KEY);

/**
 * Constructs the canonical EIP-191 challenge authentication message.
 *
 * @function authMessage
 * @param {string} address - Player Ethereum wallet address.
 * @param {number|string} issuedAt - Epoch timestamp in milliseconds.
 * @returns {string} Plaintext authentication challenge string.
 */
export function authMessage(address, issuedAt) {
  return `Battle Arena login for ${address}\nIssued: ${issuedAt}`;
}

/**
 * Signs the authentication challenge message with MetaMask (personal_sign) or embedded private key.
 *
 * @async
 * @function signAuth
 * @param {Object} wallet - Wallet object containing address, source, and optional privateKey.
 * @returns {Promise<{signature: string, issuedAt: number} | null>} Signature bundle or null.
 */
export async function signAuth(wallet) {
  if (!wallet?.address) return null;
  const issuedAt = Date.now();
  const message = authMessage(wallet.address, issuedAt);
  if (wallet.source === 'metamask' && window.ethereum) {
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [message, wallet.address] });
    return { signature, issuedAt };
  }
  if (wallet.privateKey) {
    const signature = await new ethers.Wallet(wallet.privateKey).signMessage(message);
    return { signature, issuedAt };
  }
  return null;
}

/**
 * Emits the `identify` WebSocket event using an existing session token or fresh wallet signature.
 *
 * @async
 * @function signAndIdentify
 * @param {Object} wallet - Wallet instance to identify.
 */
export async function signAndIdentify(wallet) {
  const token = getSessionToken();
  if (token) return socket.emit('identify', { token });
  const signed = await signAuth(wallet);
  socket.emit('identify', { address: wallet.address, name: wallet.name, signature: signed?.signature, issuedAt: signed?.issuedAt });
}

// Attach the login session token to every request to our own API, so the server can
// tell who is calling (it no longer trusts an address sent in the request body).
if (typeof window !== 'undefined' && !window.__arenaFetchPatched) {
  window.__arenaFetchPatched = true;
  const baseFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const token = getSessionToken();
    if (token && url.startsWith(SERVER_URL)) {
      init = { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } };
    }
    return baseFetch(input, init);
  };
}

/**
 * Logs the player out: invalidates server session, clears local storage, and reloads page.
 *
 * @function logout
 */
export function logout() {
  socket.emit('auth:logout', { token: getSessionToken() });
  clearSessionToken();
  localStorage.removeItem(WALLET_KEY);
  setTimeout(() => window.location.reload(), 150);
}

/**
 * Cryptographically signs a plaintext message using a known hex private key.
 *
 * @function signMessage
 * @param {string} privateKeyHex - 64-char hex private key.
 * @param {string} message - Plaintext message to sign.
 * @returns {Promise<string>} Hex-encoded EIP-191 signature.
 */
export function signMessage(privateKeyHex, message) {
  return new ethers.Wallet(privateKeyHex).signMessage(message);
}

// ---- Session bookkeeping (module-level so it runs before any page mounts) ----

socket.on('auth:success', ({ token } = {}) => {
  if (token) saveSessionToken(token);
});

// Keep the stored wallet pointing at the logged-in account's address. After a
// login from a new browser the account's wallet differs from the local guest
// wallet, and pages derive their seat in a match from `wallet.address`.
socket.on('player:registered:user', ({ address, name } = {}) => {
  if (!address) return;
  let w = null;
  try {
    w = JSON.parse(localStorage.getItem(WALLET_KEY) || 'null');
  } catch {}
  if (!w || w.address?.toLowerCase() !== address.toLowerCase()) {
    w = {
      address,
      name: name || address.slice(0, 8),
      source: 'account',
      createdAt: Date.now(),
    };
    localStorage.setItem(WALLET_KEY, JSON.stringify(w));
  }
});
