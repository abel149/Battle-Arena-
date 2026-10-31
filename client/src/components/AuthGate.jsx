import { useState } from 'react';
import { signAndIdentify } from '../socket.js';
import { getOrCreateWallet, saveWallet, short } from '../lib/session.js';
import AuthModal from './AuthModal.jsx';
import './auth-modal.css';
import '../pages/hub.css';

// Full-screen sign-in shown before the hub and the games.
export default function AuthGate({ status }) {
  const [wallet, setWallet] = useState(getOrCreateWallet);
  const [walletError, setWalletError] = useState(null);
  const [copied, setCopied] = useState(false);

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

  function copyAddress() {
    if (!wallet?.address) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const walletBox = (
    <div className="auth-wallet">
      <div className="auth-wallet-header">
        <span className="auth-wallet-title">
          <span>⚡</span> Web3 Profile ID (Dual-Vault)
        </span>
        <span className="auth-wallet-tag">Gasless Account</span>
      </div>

      <div className="auth-wallet-addr">
        <span title={wallet.address}>{short(wallet.address)}</span>
        <button
          type="button"
          className="auth-copy-btn"
          onClick={copyAddress}
          title="Copy full blockchain address"
        >
          {copied ? '✓ Copied!' : '📋 Copy'}
        </button>
      </div>

      {wallet.source !== 'metamask' && (
        <button type="button" className="auth-metamask-btn" onClick={useMetaMask}>
          <span>🦊</span> Connect MetaMask Wallet
        </button>
      )}

      {walletError && <em>⚠️ {walletError}</em>}
    </div>
  );

  return (
    <div className="hub auth-gate">
      <div className="hub-glow" aria-hidden="true" />

      {status === 'offline' && (
        <div className="hub-alert" style={{ marginBottom: '24px', zIndex: 10 }}>
          ⚠️ Cannot reach the arena server. Start it with "cd server &amp;&amp; npm start" — this page
          reconnects automatically.
        </div>
      )}

      <div className="auth-container">
        <AuthModal gate extra={walletBox} />
      </div>
    </div>
  );
}
