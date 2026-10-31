import { useState } from 'react';
import { signAndIdentify } from '../socket.js';
import { getOrCreateWallet, saveWallet, short } from '../lib/session.js';
import AuthModal from './AuthModal.jsx';
import './auth-modal.css';
import '../pages/hub.css';

// Full-screen sign-in shown before the hub and the games. Nothing else in the
// app is reachable until the server confirms a registered account.
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

      <div className="auth-gate-layout">
        {/* Left Side: Game & Platform Showcase */}
        <section className="auth-hero">
          <div className="auth-badge-row">
            <span className="auth-hackathon-badge">🏆 Swafri Hackathon 2026</span>
            <span className="auth-status-pill">
              <span className="auth-status-dot" />
              {status === 'offline' ? 'Connecting to Arena…' : 'Arena Live & Ready'}
            </span>
          </div>

          <h2 className="auth-hero-title">
            Where Learning Fuels the <span className="highlight">Battle Arena</span>
          </h2>

          <p className="auth-hero-desc">
            The family-first Web3 esports arena where kids earn game Energy by doing real-world chores
            and homework, competing in live tactical duels with on-chain cryptographic receipts.
          </p>

          <div className="auth-hero-features">
            <div className="auth-feature-card">
              <div className="auth-feature-icon">⚡</div>
              <div className="auth-feature-text">
                <h4>Proof-of-Chore</h4>
                <p>Non-purchasable Energy earned through parent-verified household tasks.</p>
              </div>
            </div>

            <div className="auth-feature-card">
              <div className="auth-feature-icon">🎮</div>
              <div className="auth-feature-text">
                <h4>4 Live Duels</h4>
                <p>Neon Math Arena, Connect Four, Memory Match, and Cyber Blaster.</p>
              </div>
            </div>

            <div className="auth-feature-card">
              <div className="auth-feature-icon">🛡️</div>
              <div className="auth-feature-text">
                <h4>Zero-Gas Web3</h4>
                <p>Instant dual-vault burner wallet with automatic client-side recovery.</p>
              </div>
            </div>

            <div className="auth-feature-card">
              <div className="auth-feature-icon">📜</div>
              <div className="auth-feature-text">
                <h4>Verifiable Receipts</h4>
                <p>Immutable SHA-256 result hashes and winner proofs committed on-chain.</p>
              </div>
            </div>
          </div>

          <div className="auth-game-strip">
            <span className="auth-game-strip-label">Arena Duels:</span>
            <span className="auth-game-pill">🧠 Math Arena</span>
            <span className="auth-game-pill">🔴 Connect Four</span>
            <span className="auth-game-pill">🎴 Memory Match</span>
            <span className="auth-game-pill">🚀 Cyber Blaster</span>
          </div>
        </section>

        {/* Right Side: Auth Form Card */}
        <section className="auth-form-column">
          <AuthModal gate extra={walletBox} />
        </section>
      </div>
    </div>
  );
}
