// Shared client identity helpers — one wallet + one socket identity.
import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { socket, signAndIdentify, getSessionToken } from '../socket.js';

// Demo wallets carry a real secp256k1 private key so every identity can
// produce a genuine EIP-191 signature (the server verifies it). MetaMask
// wallets (source: 'metamask') sign via personal_sign and store no key here.
// Account wallets (source: 'account') belong to a logged-in session and are
// identified by token, so they need no key — but only while that token exists.
export function getOrCreateWallet() {
  let w = null;
  try { w = JSON.parse(localStorage.getItem('arena_wallet') || 'null'); } catch { /* ignore */ }
  const keyless = !w?.privateKey
    && w?.source !== 'metamask'
    && !(w?.source === 'account' && getSessionToken());
  if (!w || !w.address || keyless) {
    const wallet = ethers.Wallet.createRandom();
    w = {
      address: wallet.address,
      name: 'Player-' + Math.random().toString(36).slice(2, 7),
      privateKey: wallet.privateKey,
      source: 'demo',
    };
    localStorage.setItem('arena_wallet', JSON.stringify(w));
  }
  return w;
}

export function saveWallet(wallet) {
  localStorage.setItem('arena_wallet', JSON.stringify(wallet));
}

export const short = a => (a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a || '');

// App-level sign-in state: 'checking' | 'out' (show the sign-in screen) |
// 'in' (registered account) | 'offline' (server never answered).
// 'in' is set on `player:registered:user`, which arrives after the wallet in
// localStorage has been synced to the account — so pages mount with the right address.
export function useAuth() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    const identify = () => signAndIdentify(getOrCreateWallet());
    const onRegistered = yes => { if (!yes) setStatus('out'); };
    const onUser = () => setStatus('in');
    socket.on('connect', identify);
    socket.on('player:registered', onRegistered);
    socket.on('player:registered:user', onUser);
    if (socket.connected) identify();
    const timer = setTimeout(() => setStatus(s => (s === 'checking' ? 'offline' : s)), 5000);
    return () => {
      clearTimeout(timer);
      socket.off('connect', identify);
      socket.off('player:registered', onRegistered);
      socket.off('player:registered:user', onUser);
    };
  }, []);

  return status;
}

// Identifies this tab with the server and keeps the live profile in sync.
export function useProfile() {
  const [wallet, setWallet] = useState(getOrCreateWallet);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const identify = () => signAndIdentify(wallet);
    if (socket.connected) identify();
    socket.on('connect', identify);
    socket.on('player:update', setProfile);
    return () => {
      socket.off('connect', identify);
      socket.off('player:update', setProfile);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, wallet.name]);

  useEffect(() => {
    if (!profile) return;
    setWallet(w => (w.name === profile.name ? w : { ...w, name: profile.name }));
  }, [profile]);

  return { wallet, setWallet, profile };
}
