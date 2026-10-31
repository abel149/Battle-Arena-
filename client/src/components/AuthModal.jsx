import { useEffect, useState } from 'react';
import { socket } from '../socket.js';
import { BrandMark } from './Icons.jsx';
import './auth-modal.css';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// `gate` mode is the full-screen sign-in shown before the app: it cannot be
// dismissed (no onClose) and the app takes over once the server confirms the account.
export default function AuthModal({ onClose, gate = false, extra = null }) {
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onOk = () => {
      setBusy(false);
      onClose?.();
    };
    const onErr = ({ error: msg } = {}) => {
      setBusy(false);
      setError(msg || 'Something went wrong. Try again.');
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    socket.on('auth:success', onOk);
    socket.on('player:error', onErr);
    window.addEventListener('keydown', onKey);
    return () => {
      socket.off('auth:success', onOk);
      socket.off('player:error', onErr);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function switchTab(next) {
    setTab(next);
    setError(null);
  }

  function submit(e) {
    e.preventDefault();
    setError(null);
    const u = username.trim();
    if (!USERNAME_RE.test(u))
      return setError('Username must be 3–20 letters, numbers or underscores.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (tab === 'register' && password !== confirm) return setError('Passwords do not match.');
    if (!socket.connected) return setError('Cannot reach the server. Is it running?');

    setBusy(true);
    if (tab === 'login') {
      socket.emit('player:loginByCredentials', { username: u, password });
    } else {
      socket.emit('player:register', {
        username: u,
        name: name.trim() || u,
        email: email.trim() || undefined,
        password,
      });
    }
  }

  const isRegister = tab === 'register';

  return (
    <div
      className={`auth-overlay ${gate ? 'gate' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="auth-brand-badge">
            <BrandMark />
            <span>Battle Arena</span>
          </div>
          <h1>{isRegister ? 'Create Your Account' : 'Welcome Back, Champion'}</h1>
          <p>
            {isRegister
              ? 'Join the arena, earn verified energy, and compete for on-chain trophies.'
              : 'Sign in to jump straight into live matchmaking and claim daily rewards.'}
          </p>
        </div>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!isRegister}
            className={!isRegister ? 'on' : ''}
            onClick={() => switchTab('login')}
          >
            <span>🎮</span> Log In
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isRegister}
            className={isRegister ? 'on' : ''}
            onClick={() => switchTab('register')}
          >
            <span>✨</span> Create Account
          </button>
        </div>

        <p className="auth-note">
          {isRegister
            ? '💡 Free to play! Your account gets a non-custodial Web3 Profile ID + 5 free Energy.'
            : '⚡ Ready for duels: Connect Four, Memory Match, Math Arena, and Cyber Blaster.'}
        </p>

        <label>
          <span>
            Username <span className="hint">(3–20 characters)</span>
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. cyber_ninja"
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        {isRegister && (
          <>
            <label>
              <span>
                Display name <span className="hint">(Optional)</span>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex The Great"
              />
            </label>
            <label>
              <span>
                Email <span className="hint">(Optional — for password recovery)</span>
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="parent-or-kid@example.com"
                autoComplete="email"
              />
            </label>
          </>
        )}

        <label>
          <span>
            Password <span className="hint">(Minimum 8 characters)</span>
          </span>
          <div className="auth-pw">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              required
            />
            <button
              type="button"
              className="auth-pw-btn"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? '🙈 Hide' : '👁️ Show'}
            </button>
          </div>
        </label>

        {isRegister && (
          <label>
            <span>Repeat Password</span>
            <div className="auth-pw">
              <input
                type={showPw ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </div>
          </label>
        )}

        {error && (
          <div className="auth-error" role="alert">
            <span>⚠️</span> {error}
          </div>
        )}

        {isRegister && extra}

        <div className="auth-actions">
          {onClose && (
            <button type="button" className="auth-cancel" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? (
              <span>⏳ Please wait…</span>
            ) : isRegister ? (
              <span>🚀 Create Account &amp; Play</span>
            ) : (
              <span>⚔️ Enter the Arena</span>
            )}
          </button>
        </div>

        <div className="auth-trust-footer">
          <div className="auth-trust-item">
            <span>🛡️</span> Kid-Safe Chat
          </div>
          <div className="auth-trust-item">
            <span>⚡</span> Proof-of-Chore
          </div>
          <div className="auth-trust-item">
            <span>📜</span> On-Chain Receipts
          </div>
        </div>
      </form>
    </div>
  );
}
