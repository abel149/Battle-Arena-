import { io } from 'socket.io-client';
import { ethers } from 'ethers';

const defaultServer = typeof window !== 'undefined' && window.location?.hostname
  ? `${window.location.protocol}//${window.location.hostname}:3001`
  : 'http://localhost:3001';
const SERVER_URL = import.meta.env.VITE_SERVER_URL || defaultServer;
export const socket = io(SERVER_URL, { autoConnect: true });
export const API = SERVER_URL;

const SESSION_KEY = 'arena_session';
const WALLET_KEY = 'arena_wallet';

export const getSessionToken = () => localStorage.getItem(SESSION_KEY);
export const saveSessionToken = token => localStorage.setItem(SESSION_KEY, token);
export const clearSessionToken = () => localStorage.removeItem(SESSION_KEY);

/**
 * The shared auth message. Must match server/index.js AUTH_MESSAGE exactly;
 * the server verifies it with standard EIP-191 (ethers.verifyMessage).
 */
export function authMessage(address) {
  return `Battle Arena login for ${address}`;
}

/**
 * Sign the auth message as a human user would:
 *  - MetaMask-connected wallet → personal_sign via window.ethereum
 *  - Demo wallet (has a stored private key) → ethers Wallet.signMessage
 * Returns null when neither is available.
 */
export async function signAuth(wallet) {
  if (!wallet?.address) return null;
  const message = authMessage(wallet.address);
  if (wallet.source === 'metamask' && window.ethereum) {
    return window.ethereum.request({ method: 'personal_sign', params: [message, wallet.address] });
  }
  if (wallet.privateKey) {
    return new ethers.Wallet(wallet.privateKey).signMessage(message);
  }
  return null;
}

/**
 * Emit `identify`. A saved login session (token) is used when present — it works
 * from any browser and never opens a MetaMask popup. Otherwise the wallet signs.
 */
export async function signAndIdentify(wallet) {
  const token = getSessionToken();
  if (token) return socket.emit('identify', { token });
  const signature = await signAuth(wallet);
  socket.emit('identify', { address: wallet.address, name: wallet.name, signature });
}

/** End the login session on the server and this browser, then reload to the sign-in screen. */
export function logout() {
  socket.emit('auth:logout', { token: getSessionToken() });
  clearSessionToken();
  localStorage.removeItem(WALLET_KEY);
  setTimeout(() => window.location.reload(), 150);
}

/**
 * Sign a message with a known private key (for e2e tests / debug scripts).
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
  try { w = JSON.parse(localStorage.getItem(WALLET_KEY) || 'null'); } catch { /* ignore */ }
  if (w?.address?.toLowerCase() === address.toLowerCase()) {
    if (name && w.name !== name) localStorage.setItem(WALLET_KEY, JSON.stringify({ ...w, name }));
    return;
  }
  localStorage.setItem(WALLET_KEY, JSON.stringify({ address, name: name || w?.name, source: 'account' }));
});

socket.on('auth:expired', () => {
  clearSessionToken();
  localStorage.removeItem(WALLET_KEY);
  window.location.reload();
});
