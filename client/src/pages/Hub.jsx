import { useCallback, useEffect, useRef, useState } from 'react';
import { API, socket, logout } from '../socket.js';
import { navigate } from '../lib/router.js';
import { saveWallet, short, useProfile, clearWalletSession } from '../lib/session.js';
import ArenaPreview3D from '../components/ArenaPreview3D.jsx';
import AuthModal from '../components/AuthModal.jsx';
import SkinLockerModal from '../components/SkinLockerModal.jsx';
import ParentApprovalModal from '../components/ParentApprovalModal.jsx';
import ReplayModal from '../components/ReplayModal.jsx';
import AccountModal from '../components/AccountModal.jsx';
import JoinRoomModal from '../components/JoinRoomModal.jsx';
import ChainBadge from '../components/ChainBadge.jsx';
import VerifyPanel from '../components/VerifyPanel.jsx';
import { useChainStatus, useChainBalance, formatArena } from '../lib/chain.js';
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
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [joinGame, setJoinGame] = useState(null); // 'arena' | 'memory' | null
  const [liveRooms, setLiveRooms] = useState([]);
  const chain = useChainStatus();
  const chainBal = useChainBalance(wallet.address);
  const [verifyId, setVerifyId] = useState(null);

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

  // The server tells us which account this socket is logged in to.
  useEffect(() => {
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
    socket.on('player:registered:user', onUser);
    return () => socket.off('player:registered:user', onUser);
  }, [setWallet]);

  function handleLogout() {
    clearWalletSession();
    logout();
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
        <div className="hub-top-brand-group">
          <a className="brand" href="#hub">
            <BrandMark />
            <span className="brand-name">Battle Arena</span>
          </a>
          <nav className="hub-nav">
            <a className="hub-nav-item" href="#battlepass">Quests & Pass</a>
            <button type="button" className="hub-nav-item" onClick={() => setShowSkinLocker(true)}>Skins</button>
            <button type="button" className="hub-nav-item" onClick={() => setShowParentModal(true)}>Parents</button>
            <button
              type="button"
              className="hub-nav-item ghost"
              onClick={() => {
                const el = document.getElementById('chat-and-watch');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                  el.classList.add('cw-highlight');
                  setTimeout(() => el.classList.remove('cw-highlight'), 1200);
                }
              }}
            >
              <ChatIcon /> Chat &amp; Watch
            </button>
          </nav>
        </div>

        <div className="hub-top-actions">
          {/* Tactile Energy Fuel Meter */}
          <a className="energy-fuel-meter" href="#battlepass" title="Arena Energy — Refill by completing chores or quizzes">
            <span className="energy-meter-title">ENERGY</span>
            <div className="energy-meter-cells" aria-label={`${profile?.energy ?? 5} of 5 energy`}>
              {[1, 2, 3, 4, 5].map(i => (
                <span key={i} className={`energy-cell ${i <= (profile?.energy ?? 5) ? 'active' : ''}`} />
              ))}
            </div>
            <span className="energy-meter-val">{profile?.energy ?? 5}/5</span>
          </a>

          {/* Chain Connection Badge */}
          <ChainBadge status={chain} />

          {/* Player Badge */}
          {profile && (
            <div
              className="player-badge-pill"
              title={chainBal?.onchain ? 'Balance verified on ARENA token contract' : 'Balance from game database'}
            >
              <span className="player-badge-lvl">Lv {profile.level || 1}</span>
              <span className="dot-sep" aria-hidden="true">·</span>
              <span className="player-badge-tokens">
                {chainBal?.onchain ? `⛓ ${formatArena(chainBal.balance)}` : profile.tokens || 0} ARENA
              </span>
            </div>
          )}

          {/* Account Dropdown */}
          <div className="account-dropdown-wrap">
            <button
              type="button"
              className="account-btn"
              onClick={() => setShowAccountMenu(prev => !prev)}
              title="Account settings & keys"
            >
              <span className="account-avatar">{(profile?.username || wallet.name || 'P')[0].toUpperCase()}</span>
              <span className="account-username">@{profile?.username || short(wallet.address)}</span>
              <span className="account-chevron">{showAccountMenu ? '▲' : '▼'}</span>
            </button>
            {showAccountMenu && (
              <div className="account-menu-popover">
                <div className="account-menu-header">
                  <span className="account-menu-label">Verified Profile</span>
                  <span className="account-menu-addr mono">{short(wallet.address)}</span>
                </div>
                <button
                  type="button"
                  className="account-menu-item"
                  onClick={() => { setShowAccountMenu(false); setShowAccountModal(true); }}
                >
                  🔑 Keys & Backup Vault
                </button>
                <button
                  type="button"
                  className="account-menu-item logout-item"
                  onClick={() => { setShowAccountMenu(false); handleLogout(); }}
                >
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {celebrationToast && (
        <div className="hub-celebration-toast">
          <span>{celebrationToast}</span>
          <button type="button" onClick={() => setCelebrationToast(null)}>✕</button>
        </div>
      )}

      {loadError && <div className="hub-alert">{loadError}</div>}

      {/* ---------------- Main Hub Layout: Games on Left, Leaderboard pinned Top-Right ---------------- */}
      <div className="hub-layout">
        {/* Left Column: Games and Daily Quests */}
        <div className="hub-games-column">
          {/* Daily Quest Board */}
          <section className="hub-bp-hero">
            <div className="bp-hero-badge">Daily Quest Board</div>
            <div className="bp-hero-body">
              <div className="bp-hero-text">
                <h2>Earn Energy & Unlock Rewards</h2>
                <p>
                  Clean your room, finish homework, or pass the Daily Brain Quiz to refill your energy meter, level up your Battle Pass, and win real allowance rewards.
                </p>
              </div>
              <div className="bp-hero-action">
                <div className="bp-hero-pills">
                  <span className="bp-hero-tier">Tier {profile?.battlePassTier ?? 1}</span>
                  <span className="bp-hero-allowance">${(profile?.allowanceBalance ?? 0).toFixed(2)} Allowance</span>
                </div>
                <a className="btn-hero-bp" href="#battlepass">
                  Open Quests & Rewards →
                </a>
              </div>
            </div>
          </section>

          {/* Games Shelf */}
          <div className="hub-games-shelf">
            {/* 1. Neon Math Arena (Featured Wide Duel Box) */}
            <section className="game-card math-card featured-game">
              <div className="card-header-bar">
                <span className="game-badge-tag">Flagship 3D Duel</span>
                <h2 className="card-title math">Neon Math Arena</h2>
              </div>

              <div className="card-art">
                <ArenaPreview3D className="card-canvas" />
                <div className="art-question">What is 12 × 8?</div>
                <div className="art-timer"><span>7</span></div>
                <div className="art-tag p1">P1</div>
                <div className="art-tag p2">P2</div>
              </div>

              <div className="card-meta">
                <span className="meta-check" aria-hidden="true">✓</span>
                <span>Daily Challenge Deck</span>
                <span className="meta-bonus">+15 Bonus XP</span>
              </div>

              <div className="card-meta bot-diff-meta">
                <span className="diff-label">Bot Level:</span>
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
                <button type="button" className="btn-action-primary" onClick={() => tryPlay('arena?mode=match')}>
                  <BoltIcon /> Quick Match
                </button>
                <button type="button" className="btn-action-secondary" onClick={() => tryPlay(`arena?mode=bot&difficulty=${mathDiff}`)}>
                  <GamepadIcon /> Practice vs Bot
                </button>
                <button type="button" className="btn-action-outline" onClick={() => navigate('arena?mode=create')}>
                  <PlusIcon /> Create Room
                </button>
                <button type="button" className="btn-action-outline" onClick={() => setJoinGame('arena')}>
                  <KeyIcon /> Join Room
                </button>
              </div>
            </section>

            {/* 2. Memory Match (Card Caddy) */}
            <section className="game-card memory-card">
              <div className="card-header-bar">
                <span className="game-badge-tag teal">Card Deck</span>
                <h2 className="card-title memory">Memory Match</h2>
              </div>

              <div className="card-art memory-art">
                <BrainArt />
              </div>

              <div className="card-meta memory-deck">
                <label htmlFor="deck-select">Deck:</label>
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
                <span className="diff-label">Bot Level:</span>
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
                <button type="button" className="btn-action-primary" onClick={() => tryPlay(`memory?mode=match&deck=${deck}`)}>
                  <BoltIcon /> Quick Match
                </button>
                <button type="button" className="btn-action-secondary" onClick={() => tryPlay(`memory?mode=bot&deck=${deck}&difficulty=${memoryDiff}`)}>
                  <GamepadIcon /> Practice vs Bot
                </button>
                <button type="button" className="btn-action-outline" onClick={() => navigate(`memory?mode=create&deck=${deck}`)}>
                  <PlusIcon /> Create Room
                </button>
                <button type="button" className="btn-action-outline" onClick={() => setJoinGame('memory')}>
                  <KeyIcon /> Join Room
                </button>
              </div>
            </section>

            {/* 3. Connect Four Arena (Drop Rack) */}
            <section className="game-card c4-card">
              <div className="card-header-bar">
                <span className="game-badge-tag yellow">Drop Rack</span>
                <h2 className="card-title c4-card-title">Connect Four</h2>
              </div>

              <div className="card-art c4-art">
                <ConnectFourArt />
              </div>

              <div className="card-meta">
                <span className="meta-check" aria-hidden="true">✓</span>
                <span>Classic 7×6 Drop Grid</span>
                <span className="meta-bonus">+25 Battle Pass XP</span>
              </div>

              <div className="card-meta bot-diff-meta">
                <span className="diff-label">Bot Level:</span>
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
                <button type="button" className="btn-action-primary" onClick={() => tryPlay('connectfour?mode=match')}>
                  <BoltIcon /> Quick Match
                </button>
                <button type="button" className="btn-action-secondary" onClick={() => tryPlay(`connectfour?mode=bot&difficulty=${c4Diff}`)}>
                  <GamepadIcon /> Practice vs Bot
                </button>
                <button type="button" className="btn-action-outline" onClick={() => navigate('connectfour?mode=create')}>
                  <PlusIcon /> Create Room
                </button>
                <button type="button" className="btn-action-outline" onClick={() => setJoinGame('connectfour')}>
                  <KeyIcon /> Join Room
                </button>
              </div>
            </section>

            {/* 4. Cyber Blaster Arena (Cartridge Slot) */}
            <section className="game-card blaster-card">
              <div className="card-header-bar">
                <span className="game-badge-tag blue">Laser Duel</span>
                <h2 className="card-title blaster-card-title">Cyber Blaster</h2>
              </div>

              <div className="card-art blaster-art">
                <BlasterArt />
              </div>

              <div className="card-meta blaster-skin-meta">
                <span className="skin-current-label">Skin:</span>
                <span className="skin-current-name">{profile?.equippedSkin || 'neon-striker'}</span>
                <button
                  type="button"
                  className="btn-change-skin-chip"
                  onClick={() => setShowSkinLocker(true)}
                >
                  Change Skin
                </button>
              </div>

              <div className="card-meta bot-diff-meta">
                <span className="diff-label">Bot Level:</span>
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
                <button type="button" className="btn-action-primary" onClick={() => tryPlay('blaster?mode=match')}>
                  <BoltIcon /> Quick Match
                </button>
                <button type="button" className="btn-action-secondary" onClick={() => tryPlay(`blaster?mode=bot&difficulty=${blasterDiff}`)}>
                  <GamepadIcon /> Practice vs Bot
                </button>
                <button type="button" className="btn-action-outline" onClick={() => navigate('blaster?mode=create')}>
                  <PlusIcon /> Create Room
                </button>
                <button type="button" className="btn-action-outline" onClick={() => setJoinGame('blaster')}>
                  <KeyIcon /> Join Room
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* Right Column: Pinned Top-Right Leaderboard */}
        <aside className="hub-side pinned-topright">
          {/* 1. Leaderboard (Hall of Fame) PINNED AT TOP */}
          <section className="side-panel leaderboard-panel">
            <h3 className="side-title"><TrophyIcon /> Hall of Fame</h3>
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
                No ranked players yet. Win a match to enter the Hall of Fame.
              </p>
            )}
          </section>

          {/* 2. Player Desk right below */}
          {profile && <ProfileCard profile={profile} />}

          {/* 3. Live Matches & Chat */}
          <ChatAndWatchSection rooms={liveRooms} wallet={wallet} profile={profile} />

          {/* 4. Verified Match Records */}
          <section className="side-panel onchain">
            <h3 className="side-title"><ChainIcon /> Verified Match Records</h3>
            <div className="onchain-body">
              {matches.length === 0 && <p className="side-empty">No results recorded yet. Play a match to log the first record.</p>}
              {latest.map(m => (
                <div key={m.matchId} className="chain-row-container">
                  <button
                    type="button"
                    className="chain-row"
                    onClick={() => setVerifyId(m.matchId)}
                    title={`Verify ${m.matchId} on-chain`}
                  >
                    <span className={`chain-dot ${m.gameType || ''}`} />
                    <span className="chain-game">{gameLabel(m.gameType)}</span>
                    <span className="chain-hash">{short(m.txHash || m.matchId)}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-replay-pill"
                    onClick={() => setReplayMatchId(m.matchId)}
                    title="Watch match replay"
                  >
                    Watch Replay
                  </button>
                </div>
              ))}
              {matches.length > 0 && (
                <div className="chain-count">
                  {matches.length} {chain?.onchain && !chain.error ? 'verified' : 'simulated'} match{matches.length === 1 ? '' : 'es'}
                </div>
              )}
            </div>
          </section>

          {dailyDeck && (
            <p className="daily-note">
              <span className="daily-dot" />
              <span>Today's deck: <b>{dailyDeck.label}</b> · +15 bonus XP</span>
            </p>
          )}
        </aside>
      </div>

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

      {verifyId && (
        <VerifyPanel
          matchId={verifyId}
          status={chain}
          onClose={() => setVerifyId(null)}
        />
      )}

      {joinGame && (
        <JoinRoomModal
          gameLabel={
            joinGame === 'arena'
              ? 'Neon Math Arena'
              : joinGame === 'memory'
              ? 'Memory Match'
              : joinGame === 'connectfour'
              ? 'Connect Four'
              : 'Cyber Blaster Arena'
          }
          onClose={() => setJoinGame(null)}
          onJoin={code => {
            const target = joinGame;
            setJoinGame(null);
            if (target === 'arena') {
              navigate(`arena?mode=join&code=${code}`);
            } else if (target === 'memory') {
              navigate(`memory?mode=join&code=${code}&deck=${deck}`);
            } else if (target === 'connectfour') {
              navigate(`connectfour?mode=join&code=${code}`);
            } else if (target === 'blaster') {
              navigate(`blaster?mode=join&code=${code}`);
            }
          }}
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

function ChatAndWatchSection({ rooms, wallet, profile }) {
  const [tab, setTab] = useState('watch'); // 'watch' | 'chat'
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const logRef = useRef(null);

  const live = rooms
    .map(r => ({
      ...r,
      humans: Object.entries(r.players || {}).filter(
        ([addr]) => addr.toLowerCase() !== BOT_ADDRESS.toLowerCase()
      ),
    }))
    .filter(r => r.humans.length >= 2);

  useEffect(() => {
    const onHist = (list) => {
      if (Array.isArray(list)) setMessages(list);
    };
    const onMsg = (m) => {
      setMessages(prev => [...prev, m]);
    };

    socket.on('lobby:chat:history', onHist);
    socket.on('lobby:chat:message', onMsg);
    socket.emit('lobby:chat:history');

    return () => {
      socket.off('lobby:chat:history', onHist);
      socket.off('lobby:chat:message', onMsg);
    };
  }, []);

  useEffect(() => {
    if (tab === 'chat') {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages, tab]);

  function handleSend(content) {
    const clean = String(content || '').trim();
    if (!clean) return;
    socket.emit('lobby:chat:send', { text: clean });
    setText('');
  }

  const PRESETS = [
    '👋 Hello!',
    '🎮 Duel anyone?',
    '👍 Good luck!',
    '⚡ GG!',
    '🏆 Great match!',
    '🔥 Rematch?',
  ];

  function watchRoom(r) {
    if (r.gameType === 'memory') navigate(`memory?mode=watch&room=${r.roomId}`);
    else if (r.gameType === 'connect-four') navigate(`connectfour?mode=watch&room=${r.roomId}`);
    else if (r.gameType === 'math-arena') navigate(`arena?mode=watch&room=${r.roomId}`);
    else if (r.gameType === 'cyber-blaster') navigate(`blaster?mode=watch&room=${r.roomId}`);
  }

  return (
    <section id="chat-and-watch" className="side-panel chat-watch-panel">
      <div className="chat-watch-header">
        <h3 className="side-title">
          <ChatIcon /> Chat &amp; Watch
        </h3>
        <div className="cw-tabs" role="tablist" aria-label="Chat and Spectate Views">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'watch'}
            className={`cw-tab ${tab === 'watch' ? 'active' : ''}`}
            onClick={() => setTab('watch')}
          >
            <EyeIcon /> Watch ({live.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'chat'}
            className={`cw-tab ${tab === 'chat' ? 'active' : ''}`}
            onClick={() => setTab('chat')}
          >
            💬 Chat
          </button>
        </div>
      </div>

      {tab === 'watch' ? (
        <div className="cw-watch-content">
          {live.length === 0 ? (
            <div className="cw-empty-state">
              <span className="cw-empty-icon" aria-hidden="true">🎯</span>
              <p className="side-empty">
                No player duels in progress right now. Start a match on the shelf or invite a friend to play!
              </p>
            </div>
          ) : (
            <ul className="live-list">
              {live.map(r => (
                <li key={r.roomId} className="live-row">
                  <div className="live-info">
                    <span className="live-game">{GAME_LABELS[r.gameType] || r.gameType}</span>
                    <span className="live-players">
                      {r.humans.map(([addr, name]) => name || short(addr)).join(' vs ')}
                    </span>
                    <span className="live-watchers">{r.spectators || 0} watching</span>
                  </div>
                  <button
                    type="button"
                    className="live-watch"
                    onClick={() => watchRoom(r)}
                  >
                    Watch
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="cw-chat-content">
          <div className="lobby-chat-log" ref={logRef} aria-live="polite">
            {messages.length === 0 ? (
              <p className="side-empty">No chatter yet — say hi to everyone in the Arena!</p>
            ) : (
              messages.map((m, idx) => {
                const isMe = m.address?.toLowerCase() === wallet?.address?.toLowerCase();
                const timeStr = m.t || m.time
                  ? new Date(m.t || m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '';
                return (
                  <div key={idx} className={`lobby-msg ${isMe ? 'mine' : ''}`}>
                    <div className="lobby-msg-head">
                      <span className="lobby-msg-avatar">{(m.from || '?').slice(0, 1).toUpperCase()}</span>
                      <span className="lobby-msg-sender">{isMe ? 'You' : m.from}</span>
                      {timeStr && <span className="lobby-msg-time">{timeStr}</span>}
                    </div>
                    <div className="lobby-msg-bubble">{m.text}</div>
                  </div>
                );
              })
            )}
          </div>

          <div className="lobby-chat-presets">
            {PRESETS.map(preset => (
              <button
                key={preset}
                type="button"
                className="preset-chip"
                onClick={() => handleSend(preset)}
              >
                {preset}
              </button>
            ))}
          </div>

          <form
            className="lobby-chat-form"
            onSubmit={e => {
              e.preventDefault();
              handleSend(text);
            }}
          >
            <input
              type="text"
              className="lobby-chat-input"
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Friendly message…"
              maxLength={200}
            />
            <button type="submit" className="lobby-chat-send-btn" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </div>
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.5 3a6.5 6.5 0 0 0-6.2 8.4L3 16.7V21h4.3v-2.2H9.5v-2.2h2.2l1-1A6.5 6.5 0 1 0 14.5 3Zm2 3.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z" />
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

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
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
