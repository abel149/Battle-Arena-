import { useCallback, useEffect, useState } from 'react';
import { API, socket } from '../socket.js';
import { navigate } from '../lib/router.js';
import { saveWallet, short, useProfile } from '../lib/session.js';
import ArenaPreview3D from '../components/ArenaPreview3D.jsx';
import './hub.css';

const DEFAULT_DECK = 'flags';

export default function Hub() {
  const { wallet, setWallet, profile } = useProfile();
  const [leaderboard, setLeaderboard] = useState([]);
  const [matches, setMatches] = useState([]);
  const [decks, setDecks] = useState([]);
  const [deck, setDeck] = useState(DEFAULT_DECK);
  const [loadError, setLoadError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const [lb, ms, dk] = await Promise.all([
        fetch(`${API}/api/leaderboard`).then(r => r.json()),
        fetch(`${API}/api/matches`).then(r => r.json()),
        fetch(`${API}/api/decks`).then(r => r.json()),
      ]);
      setLeaderboard(Array.isArray(lb) ? lb : []);
      setMatches(Array.isArray(ms) ? ms : []);
      setDecks(Array.isArray(dk) ? dk : []);
      setLoadError(null);
    } catch {
      setLoadError('Arena server offline — start it with "cd server && npm start".');
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  // Live leaderboard: refresh as soon as any match on this socket finishes.
  useEffect(() => {
    socket.on('match:end', refresh);
    return () => socket.off('match:end', refresh);
  }, [refresh]);

  async function connectMetaMask() {
    if (!window.ethereum) {
      setLoadError('MetaMask is not installed in this browser.');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts?.[0]) {
        const next = { ...wallet, address: accounts[0] };
        setWallet(next);
        saveWallet(next);
        socket.emit('identify', next);
      }
    } catch {
      setLoadError('MetaMask connection was cancelled.');
    }
  }

  const dailyDeck = decks.find(d => d.daily);
  const myRank = leaderboard.find(p => p.address === wallet.address);
  const topRows = leaderboard.slice(0, 5);
  const myRow = myRank && myRank.rank > 5 ? myRank : null;
  const latest = matches.slice(0, 3);

  return (
    <div className="hub">
      <div className="hub-glow" aria-hidden="true" />

      <header className="hub-top">
        <a className="brand" href="#hub">
          <BrandMark />
          <span className="brand-name">Battle Arena</span>
        </a>
        <div className="hub-wallet">
          {profile && (
            <span className="stat-pill">
              <span className="lvl">Lv {profile.level || 1}</span>
              <span className="dot-sep" aria-hidden="true">·</span>
              {profile.tokens || 0} ARENA
            </span>
          )}
          <button type="button" className="mm-btn" onClick={connectMetaMask}>MetaMask</button>
          <span className="addr-pill" title={wallet.address}>{short(wallet.address)}</span>
        </div>
      </header>

      {loadError && <div className="hub-alert">{loadError}</div>}

      <main className="hub-grid">
        {/* ---------------- Neon Math Arena ---------------- */}
        <section className="game-card math-card">
          <h2 className="card-title math">Neon Math Arena</h2>

          <div className="card-art">
            <ArenaPreview3D className="card-canvas" />
            <div className="art-question">What is 12 × 8?</div>
            <div className="art-timer"><span>7</span></div>
            <div className="art-tag p1">P1</div>
            <div className="art-tag p2">P2</div>
            <div className="art-fade" aria-hidden="true" />
          </div>

          <div className="card-meta">
            <span className="meta-check" aria-hidden="true">✓</span>
            Daily Challenge deck
            <span className="meta-bonus">+15 bonus XP</span>
          </div>

          <div className="card-actions">
            <button type="button" className="btn-quick" onClick={() => navigate('arena?mode=match')}>
              <BoltIcon /> Quick Match
            </button>
            <button type="button" className="btn-bot" onClick={() => navigate('arena?mode=bot')}>
              <GamepadIcon /> Play vs Bot
            </button>
          </div>
        </section>

        {/* ---------------- Memory Match ---------------- */}
        <section className="game-card memory-card">
          <h2 className="card-title memory">Memory Match</h2>

          <div className="card-art memory-art">
            <BrainArt />
            <div className="art-fade" aria-hidden="true" />
          </div>

          <div className="card-meta memory-deck">
            <label htmlFor="deck-select">Deck</label>
            <select
              id="deck-select"
              value={deck}
              onChange={e => setDeck(e.target.value)}
            >
              {decks.length === 0 && <option value={DEFAULT_DECK}>Loading decks…</option>}
              {decks.map(d => (
                <option key={d.id} value={d.id}>
                  {d.label}{d.daily ? ' · daily +15 XP' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="card-actions">
            <button type="button" className="btn-quick" onClick={() => navigate(`memory?mode=match&deck=${deck}`)}>
              <BoltIcon /> Quick Match
            </button>
            <button type="button" className="btn-bot" onClick={() => navigate(`memory?mode=bot&deck=${deck}`)}>
              <GamepadIcon /> Play vs Bot
            </button>
          </div>
        </section>

        {/* ---------------- Right rail ---------------- */}
          <aside className="hub-side">
          {profile && <ProfileCard profile={profile} />}
          <section className="side-panel">
            <h3 className="side-title"><TrophyIcon /> Leaderboard</h3>
            <div className="lb-head">
              <span>#</span><span>Player</span><span>Lv</span><span>W</span><span>Pts</span>
            </div>
            <ol className="lb-list">
              {topRows.map(p => (
                <LeaderRow key={p.address} player={p} me={p.address === wallet.address} />
              ))}
              {myRow && (
                <>
                  <li className="lb-gap" aria-hidden="true">⋯</li>
                  <LeaderRow player={myRow} me />
                </>
              )}
            </ol>
            {leaderboard.length === 0 && (
              <p className="side-empty">
                No ranked players yet. Win a match and the board updates live.
              </p>
            )}
          </section>

          <section className="side-panel onchain">
            <h3 className="side-title"><ChainIcon /> On-Chain Results</h3>
            <div className="onchain-art" aria-hidden="true" />
            <div className="onchain-body">
              {matches.length === 0 && <p className="side-empty">No results recorded yet.</p>}
              {latest.map(m => (
                <a
                  key={m.matchId}
                  className="chain-row"
                  href={`${API}/api/verify/${m.matchId}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Verify ${m.matchId}`}
                >
                  <span className={`chain-dot ${m.gameType || ''}`} />
                  <span className="chain-game">{gameLabel(m.gameType)}</span>
                  <span className="chain-hash">{short(m.txHash || m.matchId)}</span>
                </a>
              ))}
              {matches.length > 0 && (
                <div className="chain-count">{matches.length} verified match{matches.length === 1 ? '' : 'es'}</div>
              )}
              <div className="chain-wallet">
                <span className="chain-label">Wallet</span>
                <span className="mono">{short(wallet.address)}</span>
              </div>
            </div>
          </section>

          {dailyDeck && (
            <p className="daily-note">
              <span className="daily-dot" />
              <span>Today's deck: <b>{dailyDeck.label}</b> · bonus XP on Memory Match</span>
            </p>
          )}
        </aside>
      </main>
    </div>
  );
}
function ProfileCard({ profile }) {
  const xp = profile.xp || 0;
  const level = profile.level || 1;
  const into = xp % 100; // the server levels up every 100 XP (levelFor in store.js)
  const badges = profile.badges || [];
  const name = profile.name || short(profile.address);

  return (
    <section className="side-panel profile-card">
      <h3 className="side-title">
        <span className="pc-avatar">{name.slice(0, 1).toUpperCase()}</span>
        <span className="pc-name">{name}</span>
      </h3>

      <div className="pc-level">
        <span>Level {level}</span>
        <span>{into} / 100 XP</span>
      </div>
      <div
        className="pc-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={into}
      >
        <span style={{ width: `${into}%` }} />
      </div>

      <div className="pc-stats">
        <div><b>{profile.wins || 0}</b><span>Wins</span></div>
        <div><b>{profile.losses || 0}</b><span>Losses</span></div>
        <div><b>{profile.streak || 0}</b><span>Streak</span></div>
        <div><b>{profile.bestStreak || 0}</b><span>Best</span></div>
      </div>

      <div className="pc-badges-title">Badges ({badges.length})</div>
      {badges.length === 0 ? (
        <p className="side-empty">Win a match to earn your first badge.</p>
      ) : (
        <div className="pc-badges">
          {badges.map(b => (
            <span key={b.id} className="pc-badge" title={b.desc}>{b.label}</span>
          ))}
        </div>
      )}
    </section>
  );
}
function LeaderRow({ player, me }) {
  return (
    <li className={`lb-row ${me ? 'me' : ''} ${player.rank <= 3 ? `top${player.rank}` : ''}`}>
      <span className="lb-rank">{player.rank}</span>
      <span className="lb-player">
        <span className="lb-avatar">{(player.name || '?').slice(0, 1).toUpperCase()}</span>
        <span className="lb-name" title={player.address}>
          {player.name || short(player.address)}
        </span>
      </span>
      <span className="lb-lv">{player.level || 1}</span>
      <span className="lb-w">{player.wins || 0}</span>
      <span className="lb-pts">{(player.tokens || 0).toLocaleString()}</span>
    </li>
  );
}

const gameLabel = type => ({
  'math-arena': 'Math Arena',
  memory: 'Memory Match',
  'tic-tac-toe': 'Tic Tac Toe',
}[type] || type || 'Arena');

/* --------------------------------- icons --------------------------------- */

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 3h7l4.2 7.4L20.4 3H27l-7.6 12.4L28 29h-7.1l-4.6-8.2L11.4 29H5l8-13.2L5 3Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

function GamepadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.5 7h9A4.5 4.5 0 0 1 21 11.5v3a3.5 3.5 0 0 1-6.3 2.1l-.7-.9h-4l-.7.9A3.5 3.5 0 0 1 3 14.5v-3A4.5 4.5 0 0 1 7.5 7Zm.5 3v1.6H6.4v1.8H8V15h1.8v-1.6h1.6v-1.8H9.8V10H8Zm7.4.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm2.6 2.9a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10v3h3v3c0 3-2.2 5.4-5 5.8V18h3v3H6v-3h3v-3.2C6.2 14.4 4 12 4 9V6h3V3Zm0 5H6v1c0 1.8.9 3.3 2.4 4.1L8 8H7Zm10 0h-1l-.4 5.1C17.1 12.3 18 10.8 18 9V8h-1Z" />
    </svg>
  );
}

function ChainIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9.6 14.4a1 1 0 0 1 0-1.4l3.4-3.4a1 1 0 0 1 1.4 1.4L11 14.4a1 1 0 0 1-1.4 0Zm-2.5.3a4 4 0 0 1 0-5.7l2.4-2.4a4 4 0 0 1 5.7 0 1 1 0 0 1-1.4 1.5 2 2 0 0 0-2.9 0L8.5 10.5a2 2 0 0 0 0 2.9 1 1 0 1 1-1.4 1.4Zm9.8-5.4a1 1 0 0 1 1.4 0 4 4 0 0 1 0 5.7l-2.4 2.4a4 4 0 0 1-5.7 0 1 1 0 0 1 1.4-1.5 2 2 0 0 0 2.9 0l2.4-2.4a2 2 0 0 0 0-2.9 1 1 0 0 1 0-1.3Z" />
    </svg>
  );
}

function BrainArt() {
  return (
    <svg className="brain-art" viewBox="0 0 320 260" aria-hidden="true">
      <defs>
        <linearGradient id="brainStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#63f0ff" />
          <stop offset="55%" stopColor="#38a6ff" />
          <stop offset="100%" stopColor="#2f6bff" />
        </linearGradient>
        <radialGradient id="brainFill" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#0f3555" />
          <stop offset="100%" stopColor="#061426" />
        </radialGradient>
        <filter id="brainGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g filter="url(#brainGlow)" strokeLinejoin="round">
        <path
          d="M160 40C142 28 116 34 112 52 92 54 78 74 88 90 74 102 80 126 98 132 96 152 116 166 134 158 142 176 166 178 176 162 196 166 212 150 208 132 224 124 228 100 212 90 220 72 202 54 182 54 176 38 166 34 160 40Z"
          fill="url(#brainFill)"
          stroke="url(#brainStroke)"
          strokeWidth="3"
        />
        <path d="M160 40v120" stroke="url(#brainStroke)" strokeOpacity=".4" strokeWidth="2" />
        <g fill="none" stroke="url(#brainStroke)" strokeWidth="2.4" strokeOpacity=".9" strokeLinecap="round">
          <path d="M118 72c14 4 18 18 8 26" />
          <path d="M104 106c14-2 24 8 22 20" />
          <path d="M122 140c10-8 24-2 26 10" />
          <path d="M186 66c-12 6-12 22 2 28" />
          <path d="M196 104c-12 2-16 16-6 24" />
          <path d="M182 140c-10-4-20 4-18 14" />
          <path d="M140 54c8 6 10 16 4 24" />
          <path d="M172 150c-8 6-8 14-2 18" />
        </g>
        <path d="M152 156c-4 12 2 22 12 24" fill="none" stroke="url(#brainStroke)" strokeWidth="3" strokeLinecap="round" strokeOpacity=".75" />
      </g>
    </svg>
  );
}
