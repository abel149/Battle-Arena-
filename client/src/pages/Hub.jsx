import { useCallback, useEffect, useState } from 'react';
import { API, socket, signAndIdentify } from '../socket.js';
import { navigate } from '../lib/router.js';
import { saveWallet, short, useProfile, clearWalletSession } from '../lib/session.js';
import ArenaPreview3D from '../components/ArenaPreview3D.jsx';
import AuthModal from '../components/AuthModal.jsx';
import SkinLockerModal from '../components/SkinLockerModal.jsx';
import ParentApprovalModal from '../components/ParentApprovalModal.jsx';
import ReplayModal from '../components/ReplayModal.jsx';
import AccountModal from '../components/AccountModal.jsx';
import './hub.css';

const DEFAULT_DECK = 'flags';
const DIFFICULTIES = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];

export default function Hub() {
  const { wallet, setWallet, profile } = useProfile();
  const [leaderboard, setLeaderboard] = useState([]);
  const [matches, setMatches] = useState([]);
  const [decks, setDecks] = useState([]);
  const [deck, setDeck] = useState(DEFAULT_DECK);
  const [mathDiff, setMathDiff] = useState('medium');
  const [memoryDiff, setMemoryDiff] = useState('medium');
  const [c4Diff, setC4Diff] = useState('medium');
  const [blasterDiff, setBlasterDiff] = useState('medium');
  const [showSkinLocker, setShowSkinLocker] = useState(false);
  const [showParentModal, setShowParentModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [replayMatchId, setReplayMatchId] = useState(null);
  const [celebrationToast, setCelebrationToast] = useState(null);
  const [showEnergyModal, setShowEnergyModal] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [liveRooms, setLiveRooms] = useState([]);  const [registered, setRegistered] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  function tryPlay(path) {
    if ((profile?.energy ?? 5) <= 0) {
      setShowEnergyModal(true);
      return;
    }
    navigate(path);
  }

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
    const onSkinUnlocked = ({ skin, message }) => {
      setCelebrationToast(message || `🎉 You unlocked the '${skin.name}' skin!`);
    };
    socket.on('skin:unlocked', onSkinUnlocked);
    return () => {
      socket.off('match:end', refresh);
      socket.off('skin:unlocked', onSkinUnlocked);
    };
  }, [refresh]);

  async function connectMetaMask() {
    if (!window.ethereum) {
      setLoadError('MetaMask is not installed in this browser.');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts?.[0]) {
        const next = { ...wallet, address: accounts[0], source: 'metamask' };
        setWallet(next);
        saveWallet(next);
        signAndIdentify(next);
      }
    } catch {
      setLoadError('MetaMask connection was cancelled.');
    }
  }

  // The server tells us when this socket is logged in to a registered account.
  useEffect(() => {
    const onRegistered = yes => setRegistered(!!yes);
    const onUser = u => {
      if (!u?.address) return;
      setWallet(cur => {
        const nextName = u.name || cur.name;
        if (cur.address === u.address && cur.name === nextName) return cur;
        const next = { ...cur, address: u.address, name: nextName };
        saveWallet(next);
        return next;
      });
    };
    socket.on('player:registered', onRegistered);
    socket.on('player:registered:user', onUser);
    return () => {
      socket.off('player:registered', onRegistered);
      socket.off('player:registered:user', onUser);
    };
  }, [setWallet]);

  // Logging out just hands this browser a fresh guest wallet.
  function logout() {
    clearWalletSession();
    window.location.reload();
  }

  // Matches in progress. The server pushes this whenever a room starts, ends or gains a viewer.
  useEffect(() => {
    const onList = list => setLiveRooms(Array.isArray(list) ? list : []);
    const ask = () => socket.emit('rooms:list');
    socket.on('rooms:list', onList);
    socket.on('connect', ask);
    if (socket.connected) ask();
    return () => {
      socket.off('rooms:list', onList);
      socket.off('connect', ask);
    };
  }, []);

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
          <a className="stat-pill energy-pill" href="#battlepass" title="⚡ Arena Energy — Earn by doing chores or quiz">
            ⚡ {profile?.energy ?? 5} Energy
          </a>
          {profile && (
            <span className="stat-pill">
              <span className="lvl">Lv {profile.level || 1}</span>
              <span className="dot-sep" aria-hidden="true">·</span>
              {profile.tokens || 0} ARENA
            </span>
          )}
          <a className="mm-btn bp-nav-btn" href="#battlepass" title="Proof-of-Chore Battle Pass & Allowance">
            🏆 Battle Pass
          </a>
          <button
            type="button"
            className="mm-btn skin-nav-btn"
            onClick={() => setShowSkinLocker(true)}
            title="Open Armory to equip skins or submit chore proofs"
          >
            🎨 Skins
          </button>
          <button
            type="button"
            className="mm-btn parent-nav-btn"
            onClick={() => setShowParentModal(true)}
            title="Open Parent Portal (PIN) to approve chores"
          >
            🛡️ Parents
          </button>
          <a className="mm-btn ghost" href="#classic" title="Classic lobby with live chat and spectator mode">
            💬 Chat & Spectate
          </a>
          {registered ? (
            <button type="button" className="mm-btn" onClick={logout}>Log out</button>
          ) : (
            <button type="button" className="mm-btn" onClick={() => setShowAuth(true)}>Log in</button>
          )}
          <button type="button" className="mm-btn" onClick={connectMetaMask}>MetaMask</button>
          <button type="button" className="mm-btn key-vault-btn" onClick={() => setShowAccountModal(true)} title="Backup, view keys, or restore account">
            🔑 Keys & Vault
          </button>
          <span className="addr-pill" title={wallet.address}>{short(wallet.address)}</span>
        </div>
      </header>

      {celebrationToast && (
        <div className="hub-celebration-toast">
          <span>{celebrationToast}</span>
          <button type="button" onClick={() => setCelebrationToast(null)}>✕</button>
        </div>
      )}

      {loadError && <div className="hub-alert">{loadError}</div>}

      {/* ---------------- Proof-of-Chore Battle Pass Banner ---------------- */}
      <section className="hub-bp-hero">
        <div className="bp-hero-badge">⚡ Proof-of-Chore Battle Pass</div>
        <div className="bp-hero-body">
          <div className="bp-hero-text">
            <h2>"The only video game that gets your kids to clean their room first."</h2>
            <p>
              Arena Energy cannot be bought with money — it must be earned! Clean your room, finish homework, or pass the Brain Quiz to earn Energy, unlock Battle Pass tiers, and win real allowance rewards.
            </p>
          </div>
          <div className="bp-hero-action">
            <div className="bp-hero-pills">
              <span className="bp-hero-tier">Tier {profile?.battlePassTier ?? 1}</span>
              <span className="bp-hero-allowance">${(profile?.allowanceBalance ?? 0).toFixed(2)} Allowance</span>
              <span className="bp-hero-energy">⚡ {profile?.energy ?? 5} Energy</span>
            </div>
            <a className="btn-hero-bp" href="#battlepass">
              Open Battle Pass & Chores →
            </a>
          </div>
        </div>
      </section>

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

          <div className="card-meta bot-diff-meta">
            <span className="diff-label">🤖 Bot Level:</span>
            <div className="diff-selector" role="radiogroup" aria-label="Math Arena Bot Difficulty">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={`diff-chip ${mathDiff === d.id ? 'active' : ''} diff-${d.id}`}
                  onClick={() => setMathDiff(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card-actions">
            <button type="button" className="btn-quick" onClick={() => tryPlay('arena?mode=match')}>
              <BoltIcon /> Quick Match
            </button>
            <button type="button" className="btn-bot" onClick={() => tryPlay(`arena?mode=bot&difficulty=${mathDiff}`)}>
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

          <div className="card-meta bot-diff-meta">
            <span className="diff-label">🤖 Bot Level:</span>
            <div className="diff-selector" role="radiogroup" aria-label="Memory Match Bot Difficulty">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={`diff-chip ${memoryDiff === d.id ? 'active' : ''} diff-${d.id}`}
                  onClick={() => setMemoryDiff(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card-actions">
            <button type="button" className="btn-quick" onClick={() => tryPlay(`memory?mode=match&deck=${deck}`)}>
              <BoltIcon /> Quick Match
            </button>
            <button type="button" className="btn-bot" onClick={() => tryPlay(`memory?mode=bot&deck=${deck}&difficulty=${memoryDiff}`)}>
              <GamepadIcon /> Play vs Bot
            </button>
          </div>
        </section>

        {/* ---------------- Connect Four Arena ---------------- */}
        <section className="game-card c4-card">
          <h2 className="card-title c4-card-title">Connect Four Arena</h2>

          <div className="card-art c4-art">
            <ConnectFourArt />
            <div className="art-fade" aria-hidden="true" />
          </div>

          <div className="card-meta">
            <span className="meta-check" aria-hidden="true">✓</span>
            Classic 7×6 Drop Grid
            <span className="meta-bonus">+25 Battle Pass XP</span>
          </div>

          <div className="card-meta bot-diff-meta">
            <span className="diff-label">🤖 Bot Level:</span>
            <div className="diff-selector" role="radiogroup" aria-label="Connect Four Bot Difficulty">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={`diff-chip ${c4Diff === d.id ? 'active' : ''} diff-${d.id}`}
                  onClick={() => setC4Diff(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card-actions">
            <button type="button" className="btn-quick" onClick={() => tryPlay('connectfour?mode=match')}>
              <BoltIcon /> Quick Match
            </button>
            <button type="button" className="btn-bot" onClick={() => tryPlay(`connectfour?mode=bot&difficulty=${c4Diff}`)}>
              <GamepadIcon /> Play vs Bot
            </button>
          </div>
        </section>

        {/* ---------------- Cyber Blaster Arena ---------------- */}
        <section className="game-card blaster-card">
          <h2 className="card-title blaster-card-title">Cyber Blaster Arena</h2>

          <div className="card-art blaster-art">
            <BlasterArt />
            <div className="art-fade" aria-hidden="true" />
          </div>

          <div className="card-meta">
            <span className="meta-check" aria-hidden="true">✓</span>
            2D Neon Laser Duel
            <span className="meta-bonus">+50 Battle Pass XP</span>
          </div>

          <div className="card-meta blaster-skin-meta">
            <span className="skin-current-label">🚀 Skin:</span>
            <span className="skin-current-name">{profile?.equippedSkin || 'neon-striker'}</span>
            <button
              type="button"
              className="btn-change-skin-chip"
              onClick={() => setShowSkinLocker(true)}
            >
              Change Skin 🎨
            </button>
          </div>

          <div className="card-meta bot-diff-meta">
            <span className="diff-label">🤖 Bot Level:</span>
            <div className="diff-selector" role="radiogroup" aria-label="Cyber Blaster Bot Difficulty">
              {DIFFICULTIES.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={`diff-chip ${blasterDiff === d.id ? 'active' : ''} diff-${d.id}`}
                  onClick={() => setBlasterDiff(d.id)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div className="card-actions">
            <button type="button" className="btn-quick" onClick={() => tryPlay('blaster?mode=match')}>
              <BoltIcon /> Quick Match
            </button>
            <button type="button" className="btn-bot" onClick={() => tryPlay(`blaster?mode=bot&difficulty=${blasterDiff}`)}>
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

          <LiveMatches rooms={liveRooms} />

          <section className="side-panel onchain">
            <h3 className="side-title"><ChainIcon /> On-Chain Results</h3>
            <div className="onchain-art" aria-hidden="true" />
            <div className="onchain-body">
              {matches.length === 0 && <p className="side-empty">No results recorded yet.</p>}
              {latest.map(m => (
                <div key={m.matchId} className="chain-row-container">
                  <a
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
                  <button
                    type="button"
                    className="btn-replay-pill"
                    onClick={() => setReplayMatchId(m.matchId)}
                    title="Watch match replay"
                  >
                    ▶ Replay
                  </button>
                </div>
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

      {showEnergyModal && (
        <div className="hub-energy-overlay" onClick={() => setShowEnergyModal(false)}>
          <div className="hub-energy-modal" onClick={e => e.stopPropagation()}>
            <div className="energy-modal-icon">⚡</div>
            <h2>Out of Arena Energy!</h2>
            <p>
              Arena Energy cannot be bought with money — it must be earned! Clean your room, finish homework, or pass the Brain Quiz to earn Energy and enter matches.
            </p>
            <div className="energy-modal-actions">
              <button type="button" className="btn-modal-bp" onClick={() => navigate('battlepass')}>
                Go to Battle Pass & Chores →
              </button>
              <button type="button" className="btn-modal-close" onClick={() => setShowEnergyModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {showSkinLocker && (
        <SkinLockerModal
          kidAddress={wallet?.address}
          parentAddress={profile?.parentAddress}
          onClose={() => setShowSkinLocker(false)}
          onSkinEquipped={() => refresh()}
        />
      )}

      {showParentModal && (
        <ParentApprovalModal
          parentAddress={profile?.parentAddress}
          onClose={() => setShowParentModal(false)}
          onChoreApproved={() => refresh()}
        />
      )}

      {showAccountModal && (
        <AccountModal
          wallet={wallet}
          setWallet={setWallet}
          profile={profile}
          onClose={() => setShowAccountModal(false)}
        />
      )}

      {replayMatchId && (
        <ReplayModal
          matchId={replayMatchId}
          onClose={() => setReplayMatchId(null)}
        />
      )}
    </div>
  );
}
const BOT_ADDRESS = '0xB07000000000000000000000000000000000000B'; // same constant as the server
const GAME_LABELS = {
  memory: 'Memory Match',
  'math-arena': 'Neon Math Arena',
  'connect-four': 'Connect Four',
  'cyber-blaster': 'Cyber Blaster Arena',
  'tic-tac-toe': 'Tic Tac Toe',
};

function LiveMatches({ rooms }) {
  // The server lists every room, bot games included. Only show games between two people.
  const live = rooms
    .map(r => ({
      ...r,
      humans: Object.entries(r.players || {}).filter(
        ([addr]) => addr.toLowerCase() !== BOT_ADDRESS.toLowerCase()
      ),
    }))
    .filter(r => r.humans.length >= 2);

  return (
    <section className="side-panel">
      <h3 className="side-title">Live Matches</h3>
      {live.length === 0 ? (
        <p className="side-empty">No player matches right now. Start one and ask a friend to watch.</p>
      ) : (
        <ul className="live-list">
          {live.map(r => (
            <li key={r.roomId} className="live-row">
              <div className="live-info">
                <span className="live-game">{GAME_LABELS[r.gameType] || r.gameType}</span>
                <span className="live-players">
                  {r.humans.map(([addr, name]) => name || short(addr)).join(' vs ')}
                </span>
                <span className="live-watchers">{r.spectators} watching</span>
              </div>
              {r.gameType === 'memory' ? (
                <button
                  type="button"
                  className="live-watch"
                  onClick={() => navigate(`memory?mode=watch&room=${r.roomId}`)}
                >
                  Watch
                </button>
              ) : r.gameType === 'connect-four' ? (
                <button
                  type="button"
                  className="live-watch"
                  onClick={() => navigate(`connectfour?mode=watch&room=${r.roomId}`)}
                >
                  Watch
                </button>
              ) : r.gameType === 'math-arena' ? (
                <button
                  type="button"
                  className="live-watch"
                  onClick={() => navigate(`arena?mode=watch&room=${r.roomId}`)}
                >
                  Watch
                </button>
              ) : (
                <span className="live-soon">Duel in progress</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
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

function ConnectFourArt() {
  const preview = [
    [0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 2, 0, 0, 0],
    [0, 0, 1, 1, 0, 0, 0],
    [0, 2, 1, 2, 1, 0, 0],
    [0, 1, 2, 1, 2, 0, 0],
    [1, 2, 1, 2, 1, 2, 1],
  ];
  return (
    <div className="c4-art-frame" aria-hidden="true">
      {preview.map((row, r) => (
        <div key={r} className="c4-art-row">
          {row.map((val, c) => (
            <span
              key={c}
              className={`c4-art-cell ${val === 1 ? 'cell-x' : val === 2 ? 'cell-o' : 'cell-empty'}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function BlasterArt() {
  return (
    <svg className="blaster-art-svg" viewBox="0 0 320 180" width="100%" height="100%" aria-hidden="true">
      <defs>
        <linearGradient id="blasterGlow" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f0ff" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0077ff" stopOpacity="0.2" />
        </linearGradient>
        <filter id="laserBlur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      {/* Grid background */}
      <path d="M0 45h320M0 90h320M0 135h320M80 0v180M160 0v180M240 0v180" stroke="#00f0ff" strokeOpacity="0.08" strokeWidth="1" />
      {/* Obstacle pillar preview */}
      <rect x="145" y="60" width="30" height="60" rx="4" fill="#0f172a" stroke="#00f0ff" strokeWidth="1.5" strokeOpacity="0.6" />
      {/* Laser beams */}
      <line x1="85" y1="90" x2="145" y2="90" stroke="#00ffff" strokeWidth="3" filter="url(#laserBlur)" strokeLinecap="round" />
      <line x1="235" y1="85" x2="175" y2="85" stroke="#ff2d55" strokeWidth="3" filter="url(#laserBlur)" strokeLinecap="round" />
      {/* Ship P1 */}
      <g transform="translate(65, 90)">
        <polygon points="18,0 -12,-12 -6,0 -12,12" fill="#00f0ff" stroke="#0077ff" strokeWidth="2" />
        <polygon points="6,0 -4,-4 -4,4" fill="#ffffff" />
      </g>
      {/* Ship P2 */}
      <g transform="translate(255, 90) rotate(180)">
        <polygon points="18,0 -12,-12 -6,0 -12,12" fill="#ff2d55" stroke="#ff9500" strokeWidth="2" />
        <polygon points="6,0 -4,-4 -4,4" fill="#ffffff" />
      </g>
    </svg>
  );
}
