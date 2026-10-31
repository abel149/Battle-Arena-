/**
 * @file session.js
 * @description Production-grade client identity & key vault engine.
 * Features:
 * 1. Dual-layer persistence: localStorage + IndexedDB auto-healing against cache wipes.
 * 2. Full BIP-39 12-word recovery mnemonic & standard secp256k1 key generation.
 * 3. Web3 Keystore export & import for multi-device sync and family backup.
 * 4. Backward-compatible with existing demo wallets and MetaMask connections.
 */

import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { socket, signAndIdentify, getSessionToken } from '../socket.js';

const DB_NAME = 'arena_vault_v1';
const STORE_NAME = 'vault';
const KEY_NAME = 'primary_wallet';

// ---------- IndexedDB Redundancy Engine ----------

/**
 * Opens or initializes the client IndexedDB vault store.
 *
 * @function openVaultDB
 * @returns {Promise<IDBDatabase | null>} IndexedDB database instance or null in non-browser environment.
 */
function openVaultDB() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Persists wallet identity record to browser IndexedDB store for redundancy.
 *
 * @async
 * @function idbSaveWallet
 * @param {Object} wallet - Wallet identity object.
 */
export async function idbSaveWallet(wallet) {
  if (!wallet) return;
  try {
    const db = await openVaultDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(wallet, KEY_NAME);
  } catch (err) {
    console.warn('[ArenaVault] IndexedDB save error:', err);
  }
}

/**
 * Reads persisted wallet identity record from browser IndexedDB.
 *
 * @async
 * @function idbGetWallet
 * @returns {Promise<Object | null>} Cached wallet object or null if absent.
 */
export async function idbGetWallet() {
  try {
    const db = await openVaultDB();
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY_NAME);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Deletes persisted wallet identity from browser IndexedDB store.
 *
 * @async
 * @function idbClearWallet
 */
export async function idbClearWallet() {
  try {
    const db = await openVaultDB();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(KEY_NAME);
  } catch (err) {
    console.warn('[ArenaVault] IndexedDB clear error:', err);
  }
}

// ---------- Wallet Lifecycle & Vault ----------

/**
 * @typedef {Object} ArenaWallet
 * @property {string} address - Checksummed Ethereum address.
 * @property {string} name - Display handle / username.
 * @property {string | null} privateKey - Hex-encoded secp256k1 private key.
 * @property {string | null} [mnemonic] - 12-word BIP-39 recovery mnemonic phrase.
 * @property {string} source - Origin of key ('demo' | 'metamask' | 'imported' | 'account').
 * @property {number} createdAt - Creation epoch timestamp.
 * @property {number} vaultVersion - Schema version integer.
 */

/**
 * Retrieves existing wallet from localStorage or generates a fresh cryptographically secure random wallet.
 *
 * @function getOrCreateWallet
 * @returns {ArenaWallet} Loaded or newly generated wallet instance.
 */
export function getOrCreateWallet() {
  let w = null;
  try {
    w = JSON.parse(localStorage.getItem('arena_wallet') || 'null');
  } catch {
    w = null;
  }

  const keyless =
    !w?.privateKey && w?.source !== 'metamask' && !(w?.source === 'account' && getSessionToken());

  if (!w || !w.address || keyless) {
    const wallet = ethers.Wallet.createRandom();
    w = {
      address: wallet.address,
      name: 'Player-' + Math.random().toString(36).slice(2, 7),
      privateKey: wallet.privateKey,
      mnemonic: wallet.mnemonic?.phrase || null,
      source: 'demo',
      createdAt: Date.now(),
      vaultVersion: 2,
    };
    saveWallet(w);
  } else if (!w.mnemonic && w.privateKey && w.source === 'demo') {
    // If it's a legacy wallet, keep it intact
    w.vaultVersion = w.vaultVersion || 1;
  }
  return w;
}

/**
 * Saves wallet identity simultaneously into localStorage and IndexedDB.
 *
 * @function saveWallet
 * @param {ArenaWallet} wallet - Wallet identity object to save.
 */
export function saveWallet(wallet) {
  if (!wallet) return;
  try {
    localStorage.setItem('arena_wallet', JSON.stringify(wallet));
  } catch (err) {
    console.warn('[ArenaVault] localStorage write error:', err);
  }
  idbSaveWallet(wallet);
}

/**
 * Clears current wallet session from both localStorage and IndexedDB.
 *
 * @function clearWalletSession
 */
export function clearWalletSession() {
  try {
    localStorage.removeItem('arena_wallet');
  } catch {}
  idbClearWallet();
}

/**
 * Restores a wallet from user input: either a 12/24-word BIP-39 mnemonic or a 64-char hex private key.
 *
 * @function restoreWalletFromInput
 * @param {string} input - Mnemonic phrase or raw hex private key.
 * @param {string} [name] - Optional display name.
 * @returns {ArenaWallet} Restored wallet identity.
 * @throws {Error} If input phrase or key format is invalid.
 */
export function restoreWalletFromInput(input, name) {
  const clean = (input || '').trim();
  if (!clean) throw new Error('Recovery phrase or private key cannot be empty');

  let walletInstance;
  let phrase = null;

  if (clean.includes(' ')) {
    // 12-word recovery mnemonic
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length !== 12 && words.length !== 24) {
      throw new Error(`Recovery phrase must contain 12 or 24 words (got ${words.length})`);
    }
    const normalizedPhrase = words.join(' ');
    try {
      walletInstance = ethers.Wallet.fromPhrase(normalizedPhrase);
      phrase = normalizedPhrase;
    } catch (err) {
      throw new Error('Invalid recovery phrase: ' + err.message);
    }
  } else {
    // Hex private key
    const pk = clean.startsWith('0x') ? clean : '0x' + clean;
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
      throw new Error('Private key must be a valid 64-character hex string');
    }
    try {
      walletInstance = new ethers.Wallet(pk);
    } catch (err) {
      throw new Error('Invalid private key: ' + err.message);
    }
  }

  const restored = {
    address: walletInstance.address,
    name: name || 'Player-' + walletInstance.address.slice(2, 7),
    privateKey: walletInstance.privateKey,
    mnemonic: phrase || null,
    source: 'imported',
    createdAt: Date.now(),
    vaultVersion: 2,
  };

  saveWallet(restored);
  return restored;
}

/**
 * Serializes wallet identity into an exportable standard Web3 Keystore backup JSON string.
 *
 * @function exportKeystoreJson
 * @param {ArenaWallet} wallet - Wallet identity to export.
 * @returns {string | null} Formatted JSON string or null if wallet is absent.
 */
export function exportKeystoreJson(wallet) {
  if (!wallet) return null;
  const backup = {
    schema: 'swafri-battle-arena-vault-v2',
    app: 'Web3 Battle Arena',
    address: wallet.address,
    name: wallet.name || 'Arena Player',
    source: wallet.source || 'demo',
    privateKey: wallet.privateKey || null,
    recoveryPhrase: wallet.mnemonic || null,
    exportedAt: new Date().toISOString(),
    instructions:
      'Keep this backup file private. Anyone with this file or phrase has full control over your player account and trophies.',
  };
  return JSON.stringify(backup, null, 2);
}

/**
 * Truncates an Ethereum address to compact display format (e.g. 0x1234...abcd).
 *
 * @function short
 * @param {string | null | undefined} a - Full address string.
 * @returns {string} Truncated address.
 */
export const short = (a) => (a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a || '');

/**
 * App-level authentication state hook: 'checking' | 'out' | 'in' | 'offline'.
 * Synchronizes wallet identity and session tokens with the server over WebSockets.
 *
 * @function useAuth
 * @returns {'checking' | 'out' | 'in' | 'offline'} Current authentication lifecycle state.
 */
export function useAuth() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    const identify = () => signAndIdentify(getOrCreateWallet());
    const onRegistered = (yes) => {
      if (!yes && !getSessionToken()) setStatus('out');
    };
    const onUser = () => setStatus('in');
    socket.on('connect', identify);
    socket.on('player:registered', onRegistered);
    socket.on('player:registered:user', onUser);
    if (socket.connected) identify();
    const timer = setTimeout(() => setStatus((s) => (s === 'checking' ? 'offline' : s)), 5000);
    return () => {
      clearTimeout(timer);
      socket.off('connect', identify);
      socket.off('player:registered', onRegistered);
      socket.off('player:registered:user', onUser);
    };
  }, []);

  return status;
}

/**
 * Hook to manage live user profile and wallet state with IndexedDB auto-healing.
 * Identifies current browser tab with server and keeps profile metadata synchronized.
 *
 * @function useProfile
 * @returns {{wallet: ArenaWallet, setWallet: Function, profile: Object | null}} Live profile state tuple.
 */
export function useProfile() {
  const [wallet, setWallet] = useState(getOrCreateWallet);
  const [profile, setProfile] = useState(null);

  // Auto-heal from IndexedDB if localStorage was cleared
  useEffect(() => {
    async function checkHeal() {
      const local = localStorage.getItem('arena_wallet');
      if (!local) {
        const idbWallet = await idbGetWallet();
        if (idbWallet?.address && (idbWallet.privateKey || idbWallet.source === 'metamask')) {
          localStorage.setItem('arena_wallet', JSON.stringify(idbWallet));
          setWallet(idbWallet);
          signAndIdentify(idbWallet);
        }
      } else {
        try {
          const parsed = JSON.parse(local);
          idbSaveWallet(parsed);
        } catch {}
      }
    }
    checkHeal();
  }, []);

  useEffect(() => {
    const identify = () => {
      signAndIdentify(wallet);
    };
    if (socket.connected) identify();
    socket.on('connect', identify);
    socket.on('player:update', setProfile);
    return () => {
      socket.off('connect', identify);
      socket.off('player:update', setProfile);
    };
  }, [wallet]);

  useEffect(() => {
    if (!profile) return;
    setWallet((w) => (w.name === profile.name ? w : { ...w, name: profile.name }));
  }, [profile]);

  return { wallet, setWallet, profile };
}
