// Shared client identity helpers — one wallet + one socket identity.
import { useEffect, useState } from 'react';
import { socket } from '../socket.js';

export function getOrCreateWallet() {
  let w = JSON.parse(localStorage.getItem('arena_wallet') || 'null');
  if (!w) {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    w = {
      address: '0x' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''),
      name: 'Player-' + Math.random().toString(36).slice(2, 7),
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
    const identify = () => socket.emit('identify', wallet);
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
