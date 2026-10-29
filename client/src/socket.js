import { io } from 'socket.io-client';
import { ethers } from 'ethers';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
export const socket = io(SERVER_URL, { autoConnect: true });
export const API = SERVER_URL;

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

/** Emit `identify` with a fresh wallet-ownership signature. */
export async function signAndIdentify(wallet) {
  const signature = await signAuth(wallet);
  socket.emit('identify', { address: wallet.address, name: wallet.name, signature });
}

/**
 * Sign a message with a known private key (for e2e tests / debug scripts).
 */
export function signMessage(privateKeyHex, message) {
  return new ethers.Wallet(privateKeyHex).signMessage(message);
}
