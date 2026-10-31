import { useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { socket, API, signAndIdentify } from './socket.js';
import { getOrCreateWallet, saveWallet, short, clearWalletSession } from './lib/session.js';
import { navigate } from './lib/router.js';
import './classic.css';

const usernameRe = /^[a-zA-Z0-9_]{3,20}$/;

export default function App() {
  const [wallet, setWallet] = useState(getOrCreateWallet());
  const [profile, setProfile] = useState(null);
  const [registered, setRegistered] = useState(false); // has a logged-in registered identity?
  const [view, setView] = useState('lobby'); // register | login | lobby | game
  const [queueing, setQueueing] = useState(false);
  const [room, setRoom] = useState(null); // { roomId, game, names }
  const [chat, setChat] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [matches, setMatches] = useState([]);
  const [liveRooms, setLiveRooms] = useState([]);
  const [spectating, setSpectating] = useState(false);
  const [decks, setDecks] = useState([]);
  const [gameType, setGameType] = useState('memory');
  const [deckId, setDeckId] = useState('flags');
  const [botDifficulty, setBotDifficulty] = useState('medium');

  // Auth form state
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [regUsername, setRegUsername] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regPasswordConfirm, setRegPasswordConfirm] = useState('');
  const [regShowPw, setRegShowPw] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginShowPw, setLoginShowPw] = useState(false);
  const spectatingRef = useRef(false);
  const walletRef = useRef(wallet);

  useEffect(() => {
    const identify = () => {
      signAndIdentify(walletRef.current);
    };
    socket.on('connect', identify);
    if (socket.connected) identify();
    socket.on('player:update', setProfile);
    socket.on('player:registered', (yes) => {
      setRegistered(yes);
      setView((current) =>
        yes
          ? current === 'login' || current === 'register'
            ? 'lobby'
            : current
          : current === 'lobby'
            ? 'register'
            : current
      );
    });
    socket.on('player:registered:user', (u) => {
      setProfile((p) => (p ? { ...p, username: u.username, name: u.name } : p));
      if (u.address) {
        setWallet((current) => {
          const next = { ...current, address: u.address, name: u.name || current.name };
          saveWallet(next);
          return next;
        });
      }
    });
    socket.on('player:error', ({ error }) => setAuthError(error));
    socket.on('queue:waiting', () => setQueueing(true));
    socket.on('match:start', (data) => {
      setRoom(data);
      setChat([]);
      setReceipt(null);
      setQueueing(false);
      setSpectating(spectatingRef.current);
      setView('game');
    });
    socket.on('game:state', (data) => setRoom((r) => ({ ...(r || {}), ...data })));
    socket.on('match:end', (data) => {
      setReceipt(data.receipt);
      refresh();
    });
    socket.on('chat:message', (m) => setChat((c) => [...c, m]));
    socket.on('rooms:list', setLiveRooms);
    return () => socket.removeAllListeners();
  }, []);

  useEffect(() => {
    walletRef.current = wallet;
    if (socket.connected) signAndIdentify(wallet); // re-identify with a fresh signature
  }, [wallet]);

  const [replay, setReplay] = useState(null);
  const [lbScope, setLbScope] = useState('all'); // all | weekly

  async function refresh() {
    const [lb, ms, dk] = await Promise.all([
      fetch(`${API}/api/leaderboard${lbScope === 'weekly' ? '/weekly' : ''}`).then((r) => r.json()),
      fetch(`${API}/api/matches`).then((r) => r.json()),
      fetch(`${API}/api/decks`).then((r) => r.json()),
    ]);
    setLeaderboard(lb);
    setMatches(ms);
    setDecks(dk);
    socket.emit('rooms:list');
  }
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [lbScope]);

  async function connectMetaMask() {
    if (!window.ethereum) return alert('MetaMask not found — using demo wallet');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    setWallet((w) => {
      // MetaMask holds the key itself; the stored wallet keeps only the address.
      const next = { address: accounts[0], name: w.name, source: 'metamask' };
      saveWallet(next);
      return next;
    });
  }

  function clearAuthError() {
    setAuthError(null);
  }

  async function handleRegister(e) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    if (!usernameRe.test(regUsername)) {
      setAuthError('Username must be 3–20 letters, numbers, or underscores.');
      setAuthLoading(false);
      return;
    }
    if (regPassword !== regPasswordConfirm) {
      setAuthError('Passwords do not match.');
      setAuthLoading(false);
      return;
    }
    if (regPassword.length < 8) {
      setAuthError('Password must be at least 8 characters.');
      setAuthLoading(false);
      return;
    }
    socket.emit('player:register', {
      username: regUsername.trim(),
      name: regName.trim() || regUsername.trim(),
      email: regEmail.trim(),
      password: regPassword,
    });
    setTimeout(() => setAuthLoading(false), 120);
  }

  async function handleLogin(e) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    socket.emit('player:loginByCredentials', {
      username: loginUsername.trim(),
      password: loginPassword,
    });
    setTimeout(() => setAuthLoading(false), 120);
  }

  async function handleWalletLogin() {
    // Identify the wallet, then if already registered we land in the lobby.
    setView('login');
    signAndIdentify(wallet);
  }

  function spectate(roomId) {
    spectatingRef.current = true;
    setSpectating(true);
    setRoom({ roomId, game: null, names: {} });
    setChat([]);
    setReceipt(null);
    setView('game');
    socket.emit('spectate', { roomId });
  }

  async function openReplay(matchId) {
    try {
      const r = await fetch(`${API}/api/replay/${matchId}`);
      if (!r.ok) return alert('Replay not available');
      const match = await r.json();
      if (match.gameType !== 'memory') return alert('Replay is only supported for Memory Match.');
      setReplay(match);
      setReceipt(null);
      setView('replay');
    } catch (e) {
      alert('Failed to load replay: ' + e.message);
    }
  }

  const myAddr = wallet.address;
  const gameLabel = room ? GAME_LABELS[room.gameType] || 'Match' : '';
  const watchable = (r) => r.gameType === 'memory';

  return (
    <div className="cl">
      <header className="cl-top">
        <a className="cl-brand" href="#hub">
          <BrandMark />
          <span className="cl-brand-name">Battle Arena</span>
        </a>
        <div className="cl-top-right">
          <a className="cl-btn-pill" href="#hub">
            ← Back to Hub
          </a>
          {profile && (
            <span className="cl-pill stat">
              Lv {profile.level || 1} · {profile.tokens} ARENA · {profile.wins}W/{profile.losses}L
            </span>
          )}
          <button type="button" className="cl-btn-pill" onClick={connectMetaMask}>
            MetaMask
          </button>
          <span className="cl-pill addr" title={wallet.address}>
            {short(wallet.address)}
          </span>
          {view === 'lobby' && !registered && profile && (
            <button
              type="button"
              className="cl-btn-pill"
              onClick={() => {
                setView('login');
                setLoginUsername(profile.username || '');
                clearAuthError();
              }}
            >
              Log in
            </button>
          )}
        </div>
      </header>

      {/* ---- Auth screens ---- */}
      {view === 'register' && (
        <main className="cl-auth">
          <section className="cl-panel glow cl-auth-card">
            <h2 className="cl-title">Create your arena identity</h2>
            <p className="cl-empty">
              Pick a globally unique username. Your wallet address is your real identity underneath.
            </p>
            <form onSubmit={handleRegister}>
              <div className="cl-field">
                <label htmlFor="reg-username">Username</label>
                <input
                  id="reg-username"
                  className="cl-input"
                  type="text"
                  autoComplete="username"
                  value={regUsername}
                  onChange={(e) => {
                    setRegUsername(e.target.value);
                    clearAuthError();
                  }}
                  placeholder="VictoryKing"
                  required
                />
              </div>
              <div className="cl-field">
                <label htmlFor="reg-name">
                  Display name <span className="cl-muted">(optional)</span>
                </label>
                <input
                  id="reg-name"
                  className="cl-input"
                  type="text"
                  value={regName}
                  onChange={(e) => {
                    setRegName(e.target.value);
                    clearAuthError();
                  }}
                  placeholder="What friends call you"
                />
              </div>
              <div className="cl-field">
                <label htmlFor="reg-email">
                  Email <span className="cl-muted">(optional)</span>
                </label>
                <input
                  id="reg-email"
                  className="cl-input"
                  type="email"
                  value={regEmail}
                  onChange={(e) => {
                    setRegEmail(e.target.value);
                    clearAuthError();
                  }}
                  placeholder="you@example.com"
                />
              </div>
              <div className="cl-field">
                <label htmlFor="reg-password">Password</label>
                <div className="cl-pw">
                  <input
                    id="reg-password"
                    className="cl-input"
                    type={regShowPw ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={regPassword}
                    onChange={(e) => {
                      setRegPassword(e.target.value);
                      clearAuthError();
                    }}
                    placeholder="At least 8 characters"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setRegShowPw((v) => !v)}
                    aria-label="Toggle password visibility"
                  >
                    {regShowPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <div className="cl-field">
                <label htmlFor="reg-password-confirm">Confirm password</label>
                <input
                  id="reg-password-confirm"
                  className="cl-input"
                  type={regShowPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={regPasswordConfirm}
                  onChange={(e) => {
                    setRegPasswordConfirm(e.target.value);
                    clearAuthError();
                  }}
                  placeholder="Repeat your password"
                  required
                />
              </div>
              {authError && <div className="cl-error">{authError}</div>}
              <button className="cl-btn primary" type="submit" disabled={authLoading}>
                {authLoading ? 'Creating…' : 'Create account'}
              </button>
            </form>
            <div className="cl-switch">
              Already have an account?{' '}
              <button
                type="button"
                className="cl-link"
                onClick={() => {
                  setView('login');
                  setLoginUsername('');
                  setLoginPassword('');
                  setLoginShowPw(false);
                  clearAuthError();
                }}
              >
                Log in
              </button>
            </div>
          </section>
        </main>
      )}

      {view === 'login' && (
        <main className="cl-auth">
          <section className="cl-panel glow cl-auth-card">
            <h2 className="cl-title">Log in to your arena</h2>
            <p className="cl-empty">
              Enter your username and password. Your wallet address is shown for reference.
            </p>
            <div className="cl-wallet-line">
              <span className="cl-pill addr" title={wallet.address}>
                {short(wallet.address)}
              </span>
              <button
                type="button"
                className="cl-btn sm"
                onClick={() => {
                  setWallet(getOrCreateWallet());
                  setView('login');
                  clearAuthError();
                }}
              >
                New wallet
              </button>
            </div>
            <form onSubmit={handleLogin}>
              <div className="cl-field">
                <label htmlFor="login-username">Username</label>
                <input
                  id="login-username"
                  className="cl-input"
                  type="text"
                  autoComplete="username"
                  value={loginUsername}
                  onChange={(e) => {
                    setLoginUsername(e.target.value);
                    clearAuthError();
                  }}
                  placeholder="Your arena username"
                  required
                />
              </div>
              <div className="cl-field">
                <label htmlFor="login-password">Password</label>
                <div className="cl-pw">
                  <input
                    id="login-password"
                    className="cl-input"
                    type={loginShowPw ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      clearAuthError();
                    }}
                    placeholder="Your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setLoginShowPw((v) => !v)}
                    aria-label="Toggle password visibility"
                  >
                    {loginShowPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              {authError && <div className="cl-error">{authError}</div>}
              <button className="cl-btn primary" type="submit" disabled={authLoading}>
                {authLoading ? 'Logging in…' : 'Log in'}
              </button>
            </form>
            <div className="cl-switch">
              New here?{' '}
              <button
                type="button"
                className="cl-link"
                onClick={() => {
                  setView('register');
                  setRegUsername('');
                  setRegName('');
                  setRegEmail('');
                  setRegPassword('');
                  setRegPasswordConfirm('');
                  setRegShowPw(false);
                  clearAuthError();
                }}
              >
                Create account
              </button>
            </div>
          </section>
        </main>
      )}

      {/* ---- Lobby ---- */}
      {view === 'lobby' && (
        <main className="cl-lobby">
          <div className="cl-col">
            <section className="cl-panel glow cl-play">
              <h2 className="cl-title">Chat &amp; Spectate</h2>

              <div className="cl-games">
                <button
                  type="button"
                  className={`cl-game ${gameType === 'memory' ? 'sel' : ''}`}
                  onClick={() => setGameType('memory')}
                >
                  <span className="ico">🧠</span>Memory Match
                  <small>educational decks</small>
                </button>
                <button
                  type="button"
                  className={`cl-game ${gameType === 'math-arena' ? 'sel' : ''}`}
                  onClick={() => setGameType('math-arena')}
                >
                  <span className="ico">⚡</span>Neon Math Arena
                  <small>real-time math duel</small>
                </button>
              </div>

              {gameType === 'memory' && (
                <div className="cl-decks">
                  {decks.map((d) => (
                    <button
                      type="button"
                      key={d.id}
                      className={`cl-deck ${deckId === d.id ? 'sel' : ''}`}
                      onClick={() => setDeckId(d.id)}
                    >
                      {d.label}
                      {d.daily ? ' 📅' : ''}
                    </button>
                  ))}
                  <div className="cl-hint">📅 = Daily Challenge deck (+15 bonus XP)</div>
                </div>
              )}

              <div className="cl-diff-row">
                <span className="cl-diff-label">🤖 Bot Level:</span>
                <div className="cl-diff" role="radiogroup" aria-label="Bot difficulty">
                  {['easy', 'medium', 'hard'].map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      className={`${lvl} ${botDifficulty === lvl ? 'on' : ''}`}
                      onClick={() => setBotDifficulty(lvl)}
                    >
                      {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cl-actions">
                <button
                  type="button"
                  className="cl-btn primary"
                  disabled={queueing}
                  onClick={() => {
                    spectatingRef.current = false;
                    if (gameType === 'math-arena') navigate('arena?mode=match');
                    else {
                      socket.emit('queue:join', { gameType });
                      setQueueing(true);
                    }
                  }}
                >
                  ⚡ {queueing ? 'Finding opponent…' : 'Quick Match'}
                </button>
                {queueing && (
                  <button
                    type="button"
                    className="cl-btn"
                    onClick={() => {
                      socket.emit('queue:leave');
                      setQueueing(false);
                    }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  className="cl-btn"
                  onClick={() => {
                    spectatingRef.current = false;
                    if (gameType === 'math-arena')
                      navigate(`arena?mode=bot&difficulty=${botDifficulty}`);
                    else
                      socket.emit('match:bot', {
                        gameType,
                        deck: deckId,
                        difficulty: botDifficulty,
                      });
                  }}
                >
                  🤖 Play vs Bot
                </button>
              </div>

              {profile && (
                <div className="cl-profile">
                  <div className="cl-profile-head">
                    <span className="cl-avatar">
                      {(profile.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <input
                      className="cl-input cl-name-input"
                      defaultValue={profile.name}
                      aria-label="Display name"
                      onBlur={(e) => {
                        const next = { ...wallet, name: e.target.value };
                        setWallet(next);
                        signAndIdentify(next);
                      }}
                    />
                  </div>
                  <div className="cl-lvl">
                    <span>Level {profile.level || 1}</span>
                    <span>{(profile.xp || 0) % 100} / 100 XP</span>
                  </div>
                  <div
                    className="cl-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={(profile.xp || 0) % 100}
                  >
                    <span style={{ width: `${(profile.xp || 0) % 100}%` }} />
                  </div>
                  <div className="cl-stats">
                    <div>
                      <b>{profile.matches || 0}</b>
                      <span>Matches</span>
                    </div>
                    <div>
                      <b>{profile.wins || 0}</b>
                      <span>Wins</span>
                    </div>
                    <div>
                      <b>{profile.streak || 0}</b>
                      <span>Streak</span>
                    </div>
                    <div>
                      <b>{profile.tokens || 0}</b>
                      <span>Tokens</span>
                    </div>
                  </div>
                  <div className="cl-badges">
                    {(profile.badges || []).length === 0 && (
                      <span className="cl-empty">No badges yet — win a match!</span>
                    )}
                    {(profile.badges || []).map((b) => (
                      <span key={b.id} className="cl-badge" title={b.desc}>
                        🏅 {b.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="cl-panel">
              <h3 className="cl-side-title">👁 Live Matches</h3>
              {liveRooms.length === 0 ? (
                <p className="cl-empty">
                  No matches in progress. Start one and ask a friend to watch.
                </p>
              ) : (
                <ul className="cl-live-list">
                  {liveRooms.map((r) => (
                    <li key={r.roomId} className="cl-live-row">
                      <div className="cl-live-info">
                        <span className="cl-live-game">
                          {GAME_LABELS[r.gameType] || r.gameType}
                        </span>
                        <span className="cl-live-players">
                          {Object.values(r.players || {}).join(' vs ') || '?'}
                        </span>
                        <span className="cl-live-watchers">{r.spectators || 0} watching</span>
                      </div>
                      {watchable(r) ? (
                        <button
                          type="button"
                          className="cl-watch"
                          onClick={() => spectate(r.roomId)}
                        >
                          Spectate
                        </button>
                      ) : (
                        <span className="cl-live-watchers">Watching soon</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="cl-col">
            <section className="cl-panel">
              <h3 className="cl-side-title">
                🏆 Leaderboard
                <span className="cl-tabs">
                  <button
                    type="button"
                    className={lbScope === 'all' ? 'on' : ''}
                    onClick={() => setLbScope('all')}
                  >
                    All-time
                  </button>
                  <button
                    type="button"
                    className={lbScope === 'weekly' ? 'on' : ''}
                    onClick={() => setLbScope('weekly')}
                  >
                    This week
                  </button>
                </span>
              </h3>
              <div className="cl-lb-head">
                <span>#</span>
                <span>Player</span>
                <span>Lv</span>
                <span>W</span>
                <span>{lbScope === 'weekly' ? 'Pts' : 'Tokens'}</span>
              </div>
              <ol className="cl-lb-list">
                {leaderboard.map((p) => (
                  <li
                    key={p.address}
                    className={`cl-lb-row ${p.address === myAddr ? 'me' : ''} ${p.rank <= 3 ? `top${p.rank}` : ''}`}
                  >
                    <span className="cl-lb-rank">{p.rank}</span>
                    <span className="cl-lb-player">
                      <span className="cl-avatar sm">
                        {(p.name || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <span className="cl-lb-name" title={p.address}>
                        {p.name || short(p.address)}
                      </span>
                    </span>
                    <span>{p.level || 1}</span>
                    <span>{p.wins}</span>
                    <span className="cl-lb-pts">
                      {(lbScope === 'weekly' ? p.points : p.tokens) ?? 0}
                    </span>
                  </li>
                ))}
              </ol>
              {leaderboard.length === 0 && (
                <p className="cl-empty">
                  No ranked players yet. Win a match and the board updates live.
                </p>
              )}
            </section>

            <section className="cl-panel">
              <h3 className="cl-side-title">⛓ On-Chain Results</h3>
              {matches.length === 0 ? (
                <p className="cl-empty">No results recorded yet.</p>
              ) : (
                <div className="cl-chain-list">
                  {matches.slice(0, 8).map((m) => (
                    <div key={m.matchId} className="cl-chain-row">
                      <span className={`cl-dot ${m.gameType || ''}`} />
                      <div className="cl-chain-main">
                        <span>
                          {GAME_LABELS[m.gameType] || 'Match'} · winner{' '}
                          <span className="cl-mono">{short(m.winner)}</span>
                        </span>
                        <span className="cl-mono">tx {short(m.txHash)}</span>
                      </div>
                      <button
                        type="button"
                        className="cl-btn sm"
                        onClick={() => openReplay(m.matchId)}
                      >
                        ▶ Replay
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </main>
      )}

      {/* ---- Replay ---- */}
      {view === 'replay' && replay && (
        <>
          <div className="cl-game-top">
            <button
              type="button"
              className="cl-back"
              onClick={() => {
                setReplay(null);
                setView('lobby');
              }}
            >
              ← Lobby
            </button>
            <h1 className="cl-title">Match Replay</h1>
            <div className="cl-game-tags">
              <span className="cl-pill cl-room-tag cl-mono" title={replay.matchId}>
                {replay.matchId}
              </span>
            </div>
          </div>
          <main className="cl-game-grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
            <section className="cl-panel cl-arena">
              <ReplayView replay={replay} />
            </section>
          </main>
        </>
      )}

      {/* ---- Live game / spectating ---- */}
      {view === 'game' && room && (
        <>
          <div className="cl-game-top">
            <button
              type="button"
              className="cl-back"
              onClick={() => {
                socket.emit('match:leave', { roomId: room.roomId });
                setView('lobby');
              }}
            >
              ← Leave
            </button>
            <h1 className="cl-title">{gameLabel}</h1>
            <div className="cl-game-tags">
              {spectating && <span className="cl-pill live">👁 SPECTATING</span>}
              <span className="cl-pill cl-room-tag cl-mono" title={room.roomId}>
                {room.roomId}
              </span>
            </div>
          </div>

          <main className="cl-game-grid">
            <section className="cl-panel cl-arena">
              {!room.game && (
                <div className="cl-wait">
                  <div className="cl-spinner" aria-hidden="true" />
                  Joining the match… if nothing appears, it has already finished.
                </div>
              )}
              {room.game && room.gameType === 'memory' && (
                <MemoryBoard
                  game={room.game}
                  myAddr={myAddr}
                  spectating={spectating}
                  onFlip={(i) => socket.emit('game:move', { roomId: room.roomId, index: i })}
                  names={room.names}
                />
              )}
              {receipt && (
                <Receipt
                  receipt={receipt}
                  onRematch={
                    spectating
                      ? null
                      : () => {
                          spectatingRef.current = false;
                          socket.emit('match:bot', {
                            gameType: room.gameType,
                            deck: room.deck,
                            difficulty: botDifficulty,
                          });
                        }
                  }
                />
              )}
            </section>

            <aside className="cl-panel cl-chat">
              <h3 className="cl-side-title">
                💬 Kid-Safe Chat{spectating ? ' · spectators welcome' : ''}
              </h3>
              <ChatLog chat={chat} myAddr={myAddr} />
              <PresetChat
                onSend={(t) => socket.emit('chat:send', { roomId: room.roomId, text: t })}
              />
            </aside>
          </main>
        </>
      )}
    </div>
  );
}

const GAME_LABELS = {
  memory: 'Memory Match',
  'math-arena': 'Neon Math Arena',
};

function BrandMark() {
  return (
    <svg className="cl-brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 3h7l4.2 7.4L20.4 3H27l-7.6 12.4L28 29h-7.1l-4.6-8.2L11.4 29H5l8-13.2L5 3Z" />
    </svg>
  );
}

// Two player cards with a status pill between them — same layout as Memory Match.
function ScoreBar({ left, right, status }) {
  const card = (p) => (
    <div className={`cl-score ${p.active ? 'active' : ''}`}>
      <span className="cl-avatar">{(p.name || '?').slice(0, 1).toUpperCase()}</span>
      <div className="cl-who">
        <span className="nm">
          {p.name}
          {p.you && <span className="cl-you">YOU</span>}
        </span>
        <span className="sub">{p.sub}</span>
      </div>
    </div>
  );
  return (
    <div className="cl-scores">
      {card(left)}
      <div className="cl-status">{status}</div>
      {card(right)}
    </div>
  );
}

function MemoryGrid({ cards, cols, onFlip, canFlip }) {
  return (
    <div className="cl-mem-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {cards.map((c, i) => {
        const shown = c.flipped || c.matched;
        return (
          <button
            key={i}
            type="button"
            className={`cl-mem-card ${c.matched ? 'matched' : c.flipped ? 'up' : ''}`}
            disabled={!canFlip || c.matched || c.flipped}
            onClick={() => onFlip && onFlip(i)}
            aria-label={shown ? `Card: ${c.content}` : 'Hidden card'}
          >
            {shown ? (
              <span className={`face ${String(c.content).length > 6 ? 'text' : ''}`}>
                {c.content}
              </span>
            ) : (
              <span className="q" aria-hidden="true">
                ?
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function MemoryBoard({ game, myAddr, spectating, onFlip, names }) {
  const myTurn = game.players[game.turn] === myAddr && !game.winner && !spectating;
  const cols = game.cards.length <= 16 ? 4 : 5;
  const nameOf = (addr) => names?.[addr] || short(addr);
  const status = game.winner
    ? game.winner === 'draw'
      ? 'Draw'
      : `${nameOf(game.players[game.winner])} wins`
    : spectating
      ? `${nameOf(game.players[game.turn])}'s turn`
      : myTurn
        ? 'Your turn'
        : `${nameOf(game.players[game.turn])}'s turn`;
  const side = (sym) => {
    const addr = game.players[sym];
    const s = game.scores?.[addr] ?? 0;
    return {
      name: nameOf(addr),
      sub: `${s} ${s === 1 ? 'pair' : 'pairs'}`,
      active: game.turn === sym && !game.winner,
      you: !spectating && addr === myAddr,
    };
  };

  return (
    <>
      <ScoreBar left={side('X')} right={side('O')} status={status} />
      <MemoryGrid cards={game.cards} cols={cols} onFlip={onFlip} canFlip={myTurn && !game.locked} />
      <div className="cl-foot">
        <span>
          {game.locked
            ? 'Checking the pair…'
            : spectating
              ? 'You are watching this match live.'
              : myTurn
                ? 'Flip two cards — a matching pair scores and keeps your turn.'
                : 'Waiting for your rival to flip…'}
        </span>
        <span>{game.deckLabel}</span>
      </div>
    </>
  );
}

const CHAT_PRESETS = [
  'Good luck!',
  'Well played!',
  'Nice match!',
  'Rematch?',
  '👏',
  '😄',
  '😅',
  '🎉',
];

// ---------- match replay (re-applies recorded moves client-side) ----------

function buildMemoryReplay(replay, step) {
  const cards = replay.layout.map((c) => ({
    pairId: c.pairId,
    content: c.content,
    matched: false,
    flipped: false,
  }));
  let turn = 'X';
  let flipped = [];
  const scores = { [replay.players.X]: 0, [replay.players.O]: 0 };
  for (const mv of replay.moves.slice(0, step)) {
    const i = mv.index;
    cards[i].flipped = true;
    flipped.push(i);
    if (flipped.length === 2) {
      const [a, b] = flipped;
      if (cards[a].pairId === cards[b].pairId) {
        cards[a].matched = cards[b].matched = true;
        scores[replay.players[turn]] += 1;
      } else {
        turn = turn === 'X' ? 'O' : 'X'; // mismatch passes the turn
      }
      flipped = [];
    }
  }
  return {
    cards,
    turn,
    scores,
    faceUp: flipped,
    winner: step >= replay.moves.length ? replay.result : null,
  };
}
function ReplayView({ replay }) {
  const total = replay.moves.length;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, total)), 700);
    return () => clearTimeout(t);
  }, [playing, step, total]);

  const nameOf = (addr) => replay.names?.[addr] || short(addr);
  const state = useMemo(() => buildMemoryReplay(replay, step), [replay, step]);

  const jump = (d) => {
    setPlaying(false);
    setStep((s) => Math.max(0, Math.min(total, s + d)));
  };
  const status = state.winner
    ? state.winner === 'draw'
      ? 'Draw'
      : `${nameOf(replay.players[state.winner] ?? '') || state.winner} wins`
    : `Move ${step}/${total}`;
  const side = (sym) => {
    const addr = replay.players[sym];
    return {
      name: nameOf(addr),
      sub: `${state.scores[addr] ?? 0} pairs`,
      active: state.turn === sym && !state.winner,
    };
  };

  return (
    <>
      <ScoreBar left={side('X')} right={side('O')} status={status} />

      <MemoryGrid cards={state.cards} cols={replay.layout.length <= 16 ? 4 : 5} canFlip={false} />

      <div className="cl-replay-controls">
        <button type="button" className="cl-btn sm" onClick={() => jump(-total)}>
          ⏮
        </button>
        <button type="button" className="cl-btn sm" onClick={() => jump(-1)}>
          ⏪
        </button>
        <button
          type="button"
          className="cl-btn primary sm"
          onClick={() => {
            if (step >= total) setStep(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button type="button" className="cl-btn sm" onClick={() => jump(1)}>
          ⏩
        </button>
        <button type="button" className="cl-btn sm" onClick={() => jump(total)}>
          ⏭
        </button>
        <span>
          {step} / {total} moves
        </span>
      </div>
      <div className="cl-foot">
        <span>🧠 Memory Match{replay.deck ? ` · ${replay.deck}` : ''}</span>
      </div>
    </>
  );
}

function PresetChat({ onSend }) {
  return (
    <div className="cl-presets">
      {CHAT_PRESETS.map((p) => (
        <button type="button" key={p} onClick={() => onSend(p)}>
          {p}
        </button>
      ))}
    </div>
  );
}

function Receipt({ receipt, onRematch }) {
  return (
    <div className="cl-result">
      <h3>✅ Verified result — recorded on-chain</h3>
      <div className="row cl-mono">
        <span>match</span>
        <span>{receipt.matchId}</span>
      </div>
      <div className="row cl-mono">
        <span>winner</span>
        <span>{short(receipt.winner)}</span>
      </div>
      <div className="row cl-mono">
        <span>time</span>
        <span>{new Date(receipt.timestamp).toLocaleString()}</span>
      </div>
      <div className="row cl-mono">
        <span>result hash</span>
        <span>{receipt.resultHash?.slice(0, 24) ?? '—'}…</span>
      </div>
      <div className="row cl-mono">
        <span>tx hash</span>
        <span>{receipt.txHash?.slice(0, 24) ?? '—'}…</span>
      </div>
      <div className="cl-result-actions">
        <a
          className="cl-btn sm"
          href={`${API}/api/verify/${receipt.matchId}`}
          target="_blank"
          rel="noreferrer"
        >
          ⛓ Verify
        </a>
        {onRematch && (
          <button type="button" className="cl-btn primary sm" onClick={onRematch}>
            🔁 Play Again
          </button>
        )}
      </div>
    </div>
  );
}

function ChatLog({ chat, myAddr }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight);
  }, [chat]);
  return (
    <div className="cl-chat-log" ref={ref} aria-live="polite">
      {chat.map((m, i) => (
        <div key={i} className={`cl-msg ${m.address === myAddr ? 'mine' : ''}`}>
          <b>{m.address === myAddr ? 'You' : m.from}</b>
          {m.text}
        </div>
      ))}
      {chat.length === 0 && <div className="cl-empty">No messages yet — say hi.</div>}
    </div>
  );
}

function ChatInput({ onSend }) {
  const [text, setText] = useState('');
  return (
    <form
      className="cl-chat-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) {
          onSend(text);
          setText('');
        }
      }}
    >
      <input
        className="cl-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Say something…"
        maxLength={200}
      />
      <button className="cl-btn primary sm" type="submit">
        Send
      </button>
    </form>
  );
}
