import { useEffect, useState } from 'react';
import { socket } from '../socket.js';

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
    const onOk = () => { setBusy(false); onClose?.(); };
    const onErr = ({ error: msg } = {}) => {
      setBusy(false);
      setError(msg || 'Something went wrong. Try again.');
    };
    const onKey = e => { if (e.key === 'Escape') onClose?.(); };
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
    if (!USERNAME_RE.test(u)) return setError('Username must be 3–20 letters, numbers or underscores.');
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
    <div className={`auth-overlay ${gate ? 'gate' : ''}`}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <form className="auth-card" onSubmit={submit}>
        {gate && (
          <div className="auth-brand">
            <h1>Battle Arena</h1>
            <p>Real-time multiplayer matches with on-chain results, rewards and badges.</p>
          </div>
        )}
        <div className="auth-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!isRegister}
            className={!isRegister ? 'on' : ''} onClick={() => switchTab('login')}>Log in</button>
          <button type="button" role="tab" aria-selected={isRegister}
            className={isRegister ? 'on' : ''} onClick={() => switchTab('register')}>Create account</button>
        </div>

        <p className="auth-note">
          {isRegister
            ? 'Your account gets a unique blockchain profile ID for ranked matches, badges and rewards.'
            : 'Welcome back — log in to jump into a match.'}
        </p>

        <label>
          <span>Username</span>
          <input value={username} onChange={e => setUsername(e.target.value)}
            autoComplete="username" autoFocus required />
        </label>

        {isRegister && (
          <>
            <label>
              <span>Display name (optional)</span>
              <input value={name} onChange={e => setName(e.target.value)} />
            </label>
            <label>
              <span>Email (optional)</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            </label>
          </>
        )}

        <label>
          <span>Password</span>
          <div className="auth-pw">
            <input type={showPw ? 'text' : 'password'} value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete={isRegister ? 'new-password' : 'current-password'} required />
            <button type="button" onClick={() => setShowPw(v => !v)}>{showPw ? 'Hide' : 'Show'}</button>
          </div>
        </label>

        {isRegister && (
          <label>
            <span>Repeat password</span>
            <input type={showPw ? 'text' : 'password'} value={confirm}
              onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
          </label>
        )}

        {error && <div className="auth-error" role="alert">{error}</div>}

        {isRegister && extra}

        <div className="auth-actions">
          {onClose && <button type="button" className="auth-cancel" onClick={onClose}>Cancel</button>}
          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
          </button>
        </div>
      </form>
    </div>
  );
}