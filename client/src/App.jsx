import { useEffect, useRef, useState } from 'react';
import { socket, API } from './socket.js';

// ---------- wallet identity ----------
function getOrCreateWallet() {
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

const short = a => (a && a.length > 12 ? a.slice(0, 6) + '…' + a.slice(-4) : a);

const usernameRe = /^[a-zA-Z0-9_]{3,20}$/;

export default function App() {
  const [wallet, setWallet] = useState(getOrCreateWallet());
  const [profile, setProfile] = useState(null);
  const [registered, setRegistered] = useState(false); // has a logged-in registered identity?
  const [view, setView] = useState('lobby'); // register | login | lobby | game
  const [queueing, setQueueing] = useState(false);
  const [room, setRoom] = useState(null);    // { roomId, game, names }
  const [chat, setChat] = useState([]);
  const [receipt, setReceipt] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [matches, setMatches] = useState([]);
  const [liveRooms, setLiveRooms] = useState([]);
  const [spectating, setSpectating] = useState(false);
  const [decks, setDecks] = useState([]);
  const [gameType, setGameType] = useState('memory');
  const [deckId, setDeckId] = useState('flags');

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
    const identify = () => socket.emit('identify', walletRef.current);
    socket.on('connect', identify);
    if (socket.connected) identify();
    socket.on('player:update', setProfile);
    socket.on('player:registered', (yes) => {
      setRegistered(yes);
      setView(current => yes
        ? (current === 'login' || current === 'register' ? 'lobby' : current)
        : (current === 'lobby' ? 'register' : current));
    });
    socket.on('player:registered:user', (u) => {
      setProfile(p => p ? { ...p, username: u.username, name: u.name } : p);
      if (u.address) {
        setWallet(current => {
          const next = { ...current, address: u.address, name: u.name || current.name };
          localStorage.setItem('arena_wallet', JSON.stringify(next));
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
    socket.on('game:state', (data) => setRoom(r => ({ ...(r || {}), ...data })));
    socket.on('match:end', (data) => { setReceipt(data.receipt); refresh(); });
    socket.on('chat:message', (m) => setChat(c => [...c, m]));
    socket.on('rooms:list', setLiveRooms);
    return () => socket.removeAllListeners();
  }, []);

  useEffect(() => {
    walletRef.current = wallet;
    if (socket.connected) socket.emit('identify', wallet);
  }, [wallet]);

  async function refresh() {
    const [lb, ms, dk] = await Promise.all([
      fetch(`${API}/api/leaderboard`).then(r => r.json()),
      fetch(`${API}/api/matches`).then(r => r.json()),
      fetch(`${API}/api/decks`).then(r => r.json()),
    ]);
    setLeaderboard(lb);
    setMatches(ms);
    setDecks(dk);
    socket.emit('rooms:list');
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, []);

  async function connectMetaMask() {
    if (!window.ethereum) return alert('MetaMask not found — using demo wallet');
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    setWallet(w => ({ ...w, address: accounts[0] }));
  }

  function clearAuthError() { setAuthError(null); }

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
    socket.emit('identify', wallet);
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

  const myAddr = wallet.address;
  const mySymbol = room?.game && (room.game.players.X === myAddr ? 'X' : room.game.players.O === myAddr ? 'O' : null);

  return (
    <div className="app">
      <header className="topbar">
        <h1>⚔️ Battle Arena</h1>
        <div className="wallet">
          {profile && (
            <span className="chip">{profile.tokens} ARENA · {profile.wins}W/{profile.losses}L</span>
          )}
          <button className="btn ghost" onClick={connectMetaMask}>MetaMask</button>
          <span className="chip addr" title={wallet.address}>{short(wallet.address)}</span>
          {view === 'lobby' && !registered && profile && (
            <button className="btn ghost sm" onClick={() => { setView('login'); setLoginUsername(profile.username || ''); clearAuthError(); }}>
              Log in
            </button>
          )}
        </div>
      </header>

      {/* ---- Auth screens ---- */}
      {view === 'register' && (
        <main className="auth">
          <section className="panel auth-panel">
            <h2>Create your arena identity</h2>
            <p className="muted small">Pick a globally unique username. Your wallet address is your real identity underneath.</p>
            <form onSubmit={handleRegister}>
              <div className="field">
                <label htmlFor="reg-username">Username</label>
                <input id="reg-username" type="text" autoComplete="username"
                  value={regUsername} onChange={e => { setRegUsername(e.target.value); clearAuthError(); }}
                  placeholder="VictoryKing" required />
              </div>
              <div className="field">
                <label htmlFor="reg-name">Display name <span className="muted">(optional)</span></label>
                <input id="reg-name" type="text"
                  value={regName} onChange={e => { setRegName(e.target.value); clearAuthError(); }}
                  placeholder="What friends call you" />
              </div>
              <div className="field">
                <label htmlFor="reg-email">Email <span className="muted">(optional)</span></label>
                <input id="reg-email" type="email"
                  value={regEmail} onChange={e => { setRegEmail(e.target.value); clearAuthError(); }}
                  placeholder="you@example.com" />
              </div>
              <div className="field">
                <label htmlFor="reg-password">Password</label>
                <div className="pw-field">
                  <input id="reg-password" type={regShowPw ? 'text' : 'password'} autoComplete="new-password"
                    value={regPassword} onChange={e => { setRegPassword(e.target.value); clearAuthError(); }}
                    placeholder="At least 8 characters" required />
                  <button type="button" className="pw-toggle" onClick={() => setRegShowPw(v => !v)} aria-label="Toggle password visibility">
                    {regShowPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="reg-password-confirm">Confirm password</label>
                <div className="pw-field">
                  <input id="reg-password-confirm" type={regShowPw ? 'text' : 'password'} autoComplete="new-password"
                    value={regPasswordConfirm} onChange={e => { setRegPasswordConfirm(e.target.value); clearAuthError(); }}
                    placeholder="Repeat your password" required />
                </div>
              </div>
              {authError && <div className="auth-error">{authError}</div>}
              <button className="btn primary" type="submit" disabled={authLoading}>
                {authLoading ? 'Creating…' : 'Create account'}
              </button>
            </form>
            <div className="auth-switch">
              Already have an account? <button className="link-btn" onClick={() => { setView('login'); setLoginUsername(''); setLoginPassword(''); setLoginShowPw(false); clearAuthError(); }}>Log in</button>
            </div>
          </section>
        </main>
      )}

      {view === 'login' && (
        <main className="auth">
          <section className="panel auth-panel">
            <h2>Log in to your arena identity</h2>
            <p className="muted small">Enter your username and password. Your wallet address is shown for reference.</p>
            <div className="wallet-line">
              <span className="chip addr" title={wallet.address}>{short(wallet.address)}</span>
              <button className="btn ghost sm" onClick={() => { setWallet(getOrCreateWallet()); setView('login'); clearAuthError(); }}>New wallet</button>
            </div>
            <form onSubmit={handleLogin}>
              <div className="field">
                <label htmlFor="login-username">Username</label>
                <input id="login-username" type="text" autoComplete="username"
                  value={loginUsername} onChange={e => { setLoginUsername(e.target.value); clearAuthError(); }}
                  placeholder="Your arena username" required />
              </div>
              <div className="field">
                <label htmlFor="login-password">Password</label>
                <div className="pw-field">
                  <input id="login-password" type={loginShowPw ? 'text' : 'password'} autoComplete="current-password"
                    value={loginPassword} onChange={e => { setLoginPassword(e.target.value); clearAuthError(); }}
                    placeholder="Your password" required />
                  <button type="button" className="pw-toggle" onClick={() => setLoginShowPw(v => !v)} aria-label="Toggle password visibility">
                    {loginShowPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              {authError && <div className="auth-error">{authError}</div>}
              <button className="btn primary" type="submit" disabled={authLoading}>
                {authLoading ? 'Logging in…' : 'Log in'}
              </button>
            </form>
            <div className="auth-switch">
              New here? <button className="link-btn" onClick={() => { setView('register'); setRegUsername(''); setRegName(''); setRegEmail(''); setRegPassword(''); setRegPasswordConfirm(''); setRegShowPw(false); clearAuthError(); }}>Create account</button>
            </div>
          </section>
        </main>
      )}

      {view === 'lobby' && (
        <main className="lobby">
          <section className="panel">
            <h2>Play</h2>
            <div className="game-picker">
              <button className={`game-card ${gameType === 'memory' ? 'sel' : ''}`}
                onClick={() => setGameType('memory')}>
                <span className="gicon">🧠</span>Memory Match
                <span className="muted">educational decks</span>
              </button>
              <button className={`game-card ${gameType === 'tic-tac-toe' ? 'sel' : ''}`}
                onClick={() => setGameType('tic-tac-toe')}>
                <span className="gicon">⭕</span>Tic Tac Toe
                <span className="muted">classic duel</span>
              </button>
            </div>

            {gameType === 'memory' && (
              <div className="deck-picker">
                {decks.map(d => (
                  <button key={d.id} className={`deck-chip ${deckId === d.id ? 'sel' : ''}`}
                    onClick={() => setDeckId(d.id)}>
                    {d.label}{d.daily ? ' 📅' : ''}
                  </button>
                ))}
                <div className="muted small">📅 = Daily Challenge deck (+15 bonus XP)</div>
              </div>
            )}

            <div className="actions">
              <button className="btn primary" disabled={queueing}
                onClick={() => { spectatingRef.current = false; socket.emit('queue:join', { gameType }); setQueueing(true); }}>
                {queueing ? 'Finding opponent…' : '⚡ Quick Match'}
              </button>
              {queueing && <button className="btn" onClick={() => { socket.emit('queue:leave'); setQueueing(false); }}>Cancel</button>}
              <button className="btn" onClick={() => { spectatingRef.current = false; socket.emit('match:bot', { gameType, deck: deckId }); }}>🤖 Play vs Bot</button>
            </div>

            {profile && (
              <div className="profile">
                <input className="name-input" defaultValue={profile.name}
                  onBlur={e => { setWallet(w => ({ ...w, name: e.target.value }));
                                 socket.emit('identify', { ...wallet, name: e.target.value }); }} />
                <div className="stats">
                  <span>⭐ Lv {profile.level || 1} ({profile.xp || 0} XP)</span>
                  <span>{profile.matches} matches</span>
                  <span>{profile.wins} wins · streak {profile.streak || 0}</span>
                  <span>{profile.tokens} tokens</span>
                </div>
                <div className="badges">
                  {profile.badges.length === 0 && <span className="muted">No badges yet — win a match!</span>}
                  {profile.badges.map(b => <span key={b.id} className="badge" title={b.desc}>🏅 {b.label}</span>)}
                </div>
              </div>
            )}

            {liveRooms.length > 0 && (
              <div className="live">
                <h3>Live matches</h3>
                {liveRooms.map(r => (
                  <div key={r.roomId} className="live-row">
                    <span>{r.gameType === 'memory' ? '🧠' : '⭕'} {r.players.X || '?'} vs {r.players.O || '?'}</span>
                    <button className="btn sm" onClick={() => spectate(r.roomId)}>👁 Spectate</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="panel">
            <h2>🏆 Leaderboard</h2>
            <table>
              <thead><tr><th>#</th><th>Player</th><th>Lv</th><th>W</th><th>Tokens</th></tr></thead>
              <tbody>
                {leaderboard.map(p => (
                  <tr key={p.address} className={p.address === myAddr ? 'me' : ''}>
                    <td>{p.rank}</td>
                    <td>{p.name} <span className="muted">{short(p.address)}</span></td>
                    <td>{p.level || 1}</td>
                    <td>{p.wins}</td>
                    <td>{p.tokens}</td>
                  </tr>
                ))}
                {leaderboard.length === 0 && <tr><td colSpan="5" className="muted">No players yet</td></tr>}
              </tbody>
            </table>

            <h2 style={{ marginTop: '1.5rem' }}>⛓ On-Chain Results</h2>
            <div className="matches">
              {matches.slice(0, 8).map(m => (
                <div key={m.matchId} className="match-row">
                  <div className="mono">{m.matchId.slice(0, 16)}…</div>
                  <div className="muted">
                    winner <span className="mono">{short(m.winner)}</span> · tx <span className="mono">{short(m.txHash)}</span>
                  </div>
                </div>
              ))}
              {matches.length === 0 && <div className="muted">No recorded matches yet</div>}
            </div>
          </aside>
        </main>
      )}

      {view === 'game' && room && (
        <main className="game">
          <section className="panel board-panel">
            <div className="game-head">
              <button className="btn sm" onClick={() => { socket.emit('match:leave', { roomId: room.roomId }); setView('lobby'); }}>← Leave</button>
              <span className="mono muted">{room.roomId}</span>
              {spectating && <span className="chip">SPECTATING</span>}
            </div>
            {room.game && (room.gameType === 'memory' ? (
              <MemoryBoard game={room.game} myAddr={myAddr} spectating={spectating}
                onFlip={i => socket.emit('game:move', { roomId: room.roomId, index: i })}
                names={room.names} />
            ) : (
              <Board game={room.game} mySymbol={mySymbol} spectating={spectating}
                onMove={i => socket.emit('game:move', { roomId: room.roomId, index: i })}
                names={room.names} />
            ))}
            {receipt && <Receipt receipt={receipt}
              onRematch={() => { spectatingRef.current = false;
                socket.emit('match:bot', { gameType: room.gameType, deck: room.deck }); }} />}
          </section>

          <aside className="panel chat-panel">
            <h3>Chat</h3>
            <ChatLog chat={chat} myAddr={myAddr} />
            <PresetChat onSend={t => socket.emit('chat:send', { roomId: room.roomId, text: t })} />
            <ChatInput onSend={t => socket.emit('chat:send', { roomId: room.roomId, text: t })} />
          </aside>
        </main>
      )}
    </div>
  );
}

function Board({ game, mySymbol, spectating, onMove, names }) {
  const myTurn = game.turn === mySymbol && !game.winner && !spectating;
  const status = game.winner
    ? game.winner === 'draw' ? "It's a draw!"
      : `${names?.[game.players[game.winner]] || game.winner} wins!`
    : `${names?.[game.players[game.turn]] || game.players[game.turn]}'s turn (${game.turn})`;

  return (
    <>
      <div className="turn-bar">
        <span>{status}</span>
        {mySymbol && <span className="chip">You are {mySymbol}</span>}
      </div>
      <div className="board">
        {game.board.map((cell, i) => (
          <button key={i}
            className={`cell ${cell?.toLowerCase() || ''} ${game.winLine?.includes(i) ? 'win' : ''}`}
            disabled={!!cell || !myTurn || !!game.winner}
            onClick={() => onMove(i)}>
            {cell}
          </button>
        ))}
      </div>
    </>
  );
}

function MemoryBoard({ game, myAddr, spectating, onFlip, names }) {
  const myTurn = game.players[game.turn] === myAddr && !game.winner && !spectating;
  const cols = game.cards.length <= 16 ? 4 : 5;
  const nameOf = addr => names?.[addr] || short(addr);
  const status = game.winner
    ? game.winner === 'draw' ? "It's a draw!"
      : `${nameOf(game.players[game.winner])} wins!`
    : `${nameOf(game.players[game.turn])}'s turn`;

  return (
    <>
      <div className="turn-bar">
        <span>{status}</span>
        <span className="chip">{game.deckLabel}</span>
      </div>
      <div className="scorebar">
        {Object.entries(game.scores).map(([addr, s]) => (
          <span key={addr} className={`chip ${game.players[game.turn] === addr ? 'active' : ''}`}>
            {nameOf(addr)}: {s}
          </span>
        ))}
      </div>
      <div className="memory-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {game.cards.map((c, i) => (
          <button key={i}
            className={`mcard ${c.matched ? 'matched' : c.flipped ? 'up' : ''}`}
            disabled={!myTurn || c.matched || c.flipped || game.locked}
            onClick={() => onFlip(i)}>
            {c.flipped || c.matched ? c.content : '?'}
          </button>
        ))}
      </div>
    </>
  );
}

const CHAT_PRESETS = ['Good luck!', 'Well played!', 'Nice match!', 'Rematch?', '👏', '😄', '😅', '🎉'];

function PresetChat({ onSend }) {
  return (
    <div className="preset-chat">
      {CHAT_PRESETS.map(p => (
        <button key={p} className="btn sm ghost" onClick={() => onSend(p)}>{p}</button>
      ))}
    </div>
  );
}

function Receipt({ receipt, onRematch }) {
  return (
    <div className="receipt">
      <h3>✅ Verified Result — Recorded On-Chain</h3>
      <div className="mono">matchId&nbsp;&nbsp;: {receipt.matchId}</div>
      <div className="mono">winner&nbsp;&nbsp;&nbsp;: {short(receipt.winner)}</div>
      <div className="mono">time&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;: {new Date(receipt.timestamp).toLocaleString()}</div>
      <div className="mono">resultHash: {receipt.resultHash?.slice(0, 24) ?? '—'}…</div>
      <div className="mono">txHash&nbsp;&nbsp;&nbsp;: {receipt.txHash?.slice(0, 24) ?? '—'}…</div>
      <div className="receipt-actions">
        <a className="btn sm" href={`${API}/api/verify/${receipt.matchId}`} target="_blank" rel="noreferrer">⛓ Verify</a>
        {onRematch && <button className="btn primary sm" onClick={onRematch}>🔁 Play Again</button>}
      </div>
    </div>
  );
}

function ChatLog({ chat, myAddr }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [chat]);
  return (
    <div className="chat-log" ref={ref}>
      {chat.map((m, i) => (
        <div key={i} className={`msg ${m.address === myAddr ? 'mine' : ''}`}>
          <b>{m.from}</b> {m.text}
        </div>
      ))}
      {chat.length === 0 && <div className="muted">No messages yet</div>}
    </div>
  );
}

function ChatInput({ onSend }) {
  const [text, setText] = useState('');
  return (
    <form className="chat-input" onSubmit={e => { e.preventDefault(); if (text.trim()) { onSend(text); setText(''); } }}>
      <input value={text} onChange={e => setText(e.target.value)} placeholder="Say something…" />
      <button className="btn sm" type="submit">Send</button>
    </form>
  );
}
