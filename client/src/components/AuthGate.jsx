import { useState } from 'react';
import { signAndIdentify } from '../socket.js';
import { getOrCreateWallet, saveWallet, short } from '../lib/session.js';
import AuthModal from './AuthModal.jsx';
import '../pages/hub.css';

// Full-screen sign-in shown before the hub and the games. Nothing else in the
// app is reachable until the server confirms a registered account.
export default function AuthGate({ status }) {
  const [wallet, setWallet] = useState(getOrCreateWallet);
  const [walletError, setWalletError] = useState(null);

  // Optional: register with a MetaMask address as the blockchain profile ID
  // instead of the auto-generated one.
  async function useMetaMask() {
    setWalletError(null);
    if (!window.ethereum) return setWalletError('MetaMask is not installed in this browser.');
    try {
      const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!address) return;
      const next = { address, name: wallet.name, source: 'metamask' };
      saveWallet(next);
      setWallet(next);
      await signAndIdentify(next);
    } catch {
      setWalletError('MetaMask connection was cancelled.');
    }
  }

  const walletBox = (
    <div className="auth-wallet">
      <span>
        Profile ID <b title={wallet.address}>{short(wallet.address)}</b>
        {wallet.source === 'metamask' ? ' (MetaMask)' : ''}
      </span>
      {wallet.source !== 'metamask' && (
        <button type="button" onClick={useMetaMask}>Use my MetaMask wallet</button>
      )}
      {walletError && <em>{walletError}</em>}
    </div>
  );

  return (
    <div className="hub auth-gate">
      <div className="hub-glow" aria-hidden="true" />
      {status === 'offline' && (
        <div className="hub-alert">
          Cannot reach the arena server. Start it with "cd server &amp;&amp; npm start" — this page reconnects automatically.
        </div>
      )}
      <AuthModal gate extra={walletBox} />
    </div>
  );
}
