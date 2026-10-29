// Shared client identity helpers — one wallet + one socket identity.
import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { socket, signAndIdentify } from '../socket.js';

// Demo wallets carry a real secp256k1 private key so every identity can
// produce a genuine EIP-191 signature (the server verifies it). MetaMask
// wallets (source: 'metamask') sign via personal_sign and store no key here.
export function getOrCreateWallet() {
  let w = JSON.parse(localStorage.getItem('arena_wallet') || 'null');
  if (!w || !w.address || (!w.privateKey && w.source !== 'metamask')) {
    // Legacy wallets stored only a fake address — regenerate a real key pair.
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
