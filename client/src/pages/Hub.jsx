import { useCallback, useEffect, useRef, useState } from 'react';
import { API, socket, logout, ENERGY_CONFIG } from '../socket.js';
import { navigate } from '../lib/router.js';
import { saveWallet, short, useProfile, clearWalletSession } from '../lib/session.js';
import ArenaPreview3D from '../components/ArenaPreview3D.jsx';
import SkinLockerModal from '../components/SkinLockerModal.jsx';
import ParentApprovalModal from '../components/ParentApprovalModal.jsx';
import ReplayModal from '../components/ReplayModal.jsx';
import AccountModal from '../components/AccountModal.jsx';
import JoinRoomModal from '../components/JoinRoomModal.jsx';
import ChainBadge from '../components/ChainBadge.jsx';
import VerifyPanel from '../components/VerifyPanel.jsx';
import ChatAndWatchSection from '../components/ChatAndWatchSection.jsx';
import { LeaderRow } from '../components/LeaderRow.jsx';
import { BrainArt, ConnectFourArt, BlasterArt } from '../components/GameArt.jsx';
import {
  BrandMark,
  BoltIcon,
  GamepadIcon,
  PlusIcon,
  KeyIcon,
  TrophyIcon,
  ChainIcon,
  EyeIcon,
  ChatIcon,
  HistoryIcon,
} from '../components/Icons.jsx';
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
    if ((profile?.energy ?? ENERGY_CONFIG.DEFAULT_MAX_ENERGY) <= 0) {
      setShowEnergyModal(true);
      return;
    }
    navigate(path);
  }

  const refresh = useCallback(async () => {
    try {
      const [lb, ms, dk] = await Promise.all([
        fetch(`${API}/api/leaderboard`).then((r) => r.json()),
        fetch(`${API}/api/matches`).then((r) => r.json()),
        fetch(`${API}/api/decks`).then((r) => r.json()),
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
    const onUser = (u) => {
      if (!u?.address) return;
      setWallet((cur) => {
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
    const onList = (list) => setLiveRooms(Array.isArray(list) ? list : []);
    const ask = () => socket.emit('rooms:list');
    socket.on('rooms:list', onList);
    socket.on('connect', ask);
    if (socket.connected) ask();
    return () => {
      socket.off('rooms:list', onList);
      socket.off('connect', ask);
    };
  }, []);

  const dailyDeck = decks.find((d) => d.daily);
  const myRank = leaderboard.find((p) => p.address === wallet.address);
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
        </div>

        <nav className="hub-nav">
          <a className="hub-nav-item" href="#battlepass">
            Quests &amp; Pass
          </a>
          <button type="button" className="hub-nav-item" onClick={() => setShowSkinLocker(true)}>
            Skins
          </button>
          <button type="button" className="hub-nav-item" onClick={() => setShowParentModal(true)}>
            Parents
          </button>
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

        <div className="hub-top-actions">
          {/* Tactile Energy Fuel Meter */}
          <a
            className="energy-fuel-meter"
            href="#battlepass"
            title="Arena Energy — Refill by completing chores or quizzes"
          >
            <span className="energy-meter-title">ENERGY</span>
            <div
              className="energy-meter-cells"
              aria-label={`${profile?.energy ?? ENERGY_CONFIG.DEFAULT_MAX_ENERGY} of ${ENERGY_CONFIG.DEFAULT_MAX_ENERGY} energy`}
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  className={`energy-cell ${i <= (profile?.energy ?? ENERGY_CONFIG.DEFAULT_MAX_ENERGY) ? 'active' : ''}`}
                />
              ))}
            </div>
            <span className="energy-meter-val">
              {profile?.energy ?? ENERGY_CONFIG.DEFAULT_MAX_ENERGY}/
              {ENERGY_CONFIG.DEFAULT_MAX_ENERGY}
            </span>
          </a>

          {/* Chain Connection Badge */}
          <ChainBadge status={chain} />

          {/* Player Badge */}
          {profile && (
            <div
              className="player-badge-pill"
              title={
                chainBal?.onchain
                  ? 'Balance verified on ARENA token contract'
                  : 'Balance from game database'
              }
            >
              <span className="player-badge-lvl">Lv {profile.level || 1}</span>
              <span className="dot-sep" aria-hidden="true">
                ·
              </span>
              <span className="player-badge-tokens">
                {chainBal?.onchain ? `⛓ ${formatArena(chainBal.balance)}` : profile.tokens || 0}{' '}
                ARENA
              </span>
            </div>
          )}

          {/* Account Dropdown */}
          <div className="account-dropdown-wrap">
            <button
              type="button"
              className="account-btn"
              onClick={() => setShowAccountMenu((prev) => !prev)}
              title="Account settings & keys"
            >
              <span className="account-avatar">
                {(profile?.username || wallet.name || 'P')[0].toUpperCase()}
              </span>
              <span className="account-username">
                @{profile?.username || short(wallet.address)}
              </span>
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
                  onClick={() => {
                    setShowAccountMenu(false);
                    setShowAccountModal(true);
                  }}
                >
                  🔑 Keys & Backup Vault
                </button>
                <button
                  type="button"
                  className="account-menu-item logout-item"
                  onClick={() => {
                    setShowAccountMenu(false);
                    handleLogout();
                  }}
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
          <button type="button" onClick={() => setCelebrationToast(null)}>
            ✕
          </button>
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
                  Clean your room, finish homework, or pass the Daily Brain Quiz to refill your
                  energy meter, level up your Battle Pass, and win real allowance rewards.
                </p>
              </div>
              <div className="bp-hero-action">
                <div className="bp-hero-pills">
                  <span className="bp-hero-tier">Tier {profile?.battlePassTier ?? 1}</span>
                  <span className="bp-hero-allowance">
                    ${(profile?.allowanceBalance ?? 0).toFixed(2)} Allowance
                  </span>
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
                <div className="art-timer">
                  <span>7</span>
                </div>
                <div className="art-tag p1">P1</div>
                <div className="art-tag p2">P2</div>
              </div>

              <div className="card-meta">
                <span className="meta-check" aria-hidden="true">
                  ✓
                </span>
                <span>Daily Challenge Deck</span>
                <span className="meta-bonus">+15 Bonus XP</span>
              </div>

              <div className="card-meta bot-diff-meta">
                <span className="diff-label">Bot Level:</span>
                <div
                  className="diff-selector"
                  role="radiogroup"
                  aria-label="Math Arena Bot Difficulty"
                >
                  {DIFFICULTIES.map((d) => (
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
                <button
                  type="button"
                  className="btn-action-primary"
                  onClick={() => tryPlay('arena?mode=match')}
                >
                  <BoltIcon /> Quick Match
                </button>
                <button
                  type="button"
                  className="btn-action-secondary"
                  onClick={() => tryPlay(`arena?mode=bot&difficulty=${mathDiff}`)}
                >
                  <GamepadIcon /> Practice vs Bot
                </button>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => navigate('arena?mode=create')}
                >
                  <PlusIcon /> Create Room
                </button>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => setJoinGame('arena')}
                >
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
                <select id="deck-select" value={deck} onChange={(e) => setDeck(e.target.value)}>
                  {decks.length === 0 && <option value={DEFAULT_DECK}>Loading decks…</option>}
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                      {d.daily ? ' · daily +15 XP' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="card-meta bot-diff-meta">
                <span className="diff-label">Bot Level:</span>
                <div
                  className="diff-selector"
                  role="radiogroup"
                  aria-label="Memory Match Bot Difficulty"
                >
                  {DIFFICULTIES.map((d) => (
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
                <button
                  type="button"
                  className="btn-action-primary"
                  onClick={() => tryPlay(`memory?mode=match&deck=${deck}`)}
                >
                  <BoltIcon /> Quick Match
                </button>
                <button
                  type="button"
                  className="btn-action-secondary"
                  onClick={() => tryPlay(`memory?mode=bot&deck=${deck}&difficulty=${memoryDiff}`)}
                >
                  <GamepadIcon /> Practice vs Bot
                </button>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => navigate(`memory?mode=create&deck=${deck}`)}
                >
                  <PlusIcon /> Create Room
                </button>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => setJoinGame('memory')}
                >
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
                <span className="meta-check" aria-hidden="true">
                  ✓
                </span>
                <span>Classic 7×6 Drop Grid</span>
                <span className="meta-bonus">+25 Battle Pass XP</span>
              </div>

              <div className="card-meta bot-diff-meta">
                <span className="diff-label">Bot Level:</span>
                <div
                  className="diff-selector"
                  role="radiogroup"
                  aria-label="Connect Four Bot Difficulty"
                >
                  {DIFFICULTIES.map((d) => (
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
                <button
                  type="button"
                  className="btn-action-primary"
                  onClick={() => tryPlay('connectfour?mode=match')}
                >
                  <BoltIcon /> Quick Match
                </button>
                <button
                  type="button"
                  className="btn-action-secondary"
                  onClick={() => tryPlay(`connectfour?mode=bot&difficulty=${c4Diff}`)}
                >
                  <GamepadIcon /> Practice vs Bot
                </button>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => navigate('connectfour?mode=create')}
                >
                  <PlusIcon /> Create Room
                </button>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => setJoinGame('connectfour')}
                >
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
                <div
                  className="diff-selector"
                  role="radiogroup"
                  aria-label="Cyber Blaster Bot Difficulty"
                >
                  {DIFFICULTIES.map((d) => (
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
                <button
                  type="button"
                  className="btn-action-primary"
                  onClick={() => tryPlay('blaster?mode=match')}
                >
                  <BoltIcon /> Quick Match
                </button>
                <button
                  type="button"
                  className="btn-action-secondary"
                  onClick={() => tryPlay(`blaster?mode=bot&difficulty=${blasterDiff}`)}
                >
                  <GamepadIcon /> Practice vs Bot
                </button>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => navigate('blaster?mode=create')}
                >
                  <PlusIcon /> Create Room
                </button>
                <button
                  type="button"
                  className="btn-action-outline"
                  onClick={() => setJoinGame('blaster')}
                >
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
            <h3 className="side-title">
              <TrophyIcon /> Hall of Fame
            </h3>
            <div className="lb-head">
              <span>#</span>
              <span>Player</span>
              <span>Lv</span>
              <span>W</span>
              <span>Pts</span>
            </div>
            <ol className="lb-list">
              {topRows.map((p) => (
                <LeaderRow key={p.address} player={p} me={p.address === wallet.address} />
              ))}
              {myRow && (
                <>
                  <li className="lb-gap" aria-hidden="true">
                    ⋯
                  </li>
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
            <h3 className="side-title">
              <ChainIcon /> Verified Match Records
            </h3>
            <div className="onchain-body">
              {matches.length === 0 && (
                <p className="side-empty">
                  No results recorded yet. Play a match to log the first record.
                </p>
              )}
              {latest.map((m) => (
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
                  {matches.length} {chain?.onchain && !chain.error ? 'verified' : 'simulated'} match
                  {matches.length === 1 ? '' : 'es'}
                </div>
              )}
            </div>
          </section>

          {dailyDeck && (
            <p className="daily-note">
              <span className="daily-dot" />
              <span>
                Today's deck: <b>{dailyDeck.label}</b> · +15 bonus XP
              </span>
            </p>
          )}
        </aside>
      </div>

      {showEnergyModal && (
        <div className="hub-energy-overlay" onClick={() => setShowEnergyModal(false)}>
          <div className="hub-energy-modal" onClick={(e) => e.stopPropagation()}>
            <div className="energy-modal-icon">⚡</div>
            <h2>Out of Arena Energy!</h2>
            <p>
              Arena Energy cannot be bought with money — it must be earned! Clean your room, finish
              homework, or pass the Brain Quiz to earn Energy and enter matches.
            </p>
            <div className="energy-modal-actions">
              <button type="button" className="btn-modal-bp" onClick={() => navigate('battlepass')}>
                Go to Battle Pass & Chores →
              </button>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setShowEnergyModal(false)}
              >
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
        <ReplayModal matchId={replayMatchId} onClose={() => setReplayMatchId(null)} />
      )}

      {verifyId && (
        <VerifyPanel matchId={verifyId} status={chain} onClose={() => setVerifyId(null)} />
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
          onJoin={(code) => {
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
        <div>
          <b>{profile.wins || 0}</b>
          <span>Wins</span>
        </div>
        <div>
          <b>{profile.losses || 0}</b>
          <span>Losses</span>
        </div>
        <div>
          <b>{profile.streak || 0}</b>
          <span>Streak</span>
        </div>
        <div>
          <b>{profile.bestStreak || 0}</b>
          <span>Best</span>
        </div>
      </div>

      <div className="pc-badges-title">Badges ({badges.length})</div>
      {badges.length === 0 ? (
        <p className="side-empty">Win a match to earn your first badge.</p>
      ) : (
        <div className="pc-badges">
          {badges.map((b) => (
            <span key={b.id} className="pc-badge" title={b.desc}>
              {b.label}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
const gameLabel = (type) =>
  ({
    'math-arena': 'Math Arena',
    memory: 'Memory Match',
    'connect-four': 'Connect Four',
    'cyber-blaster': 'Cyber Blaster Arena',
  })[type] ||
  type ||
  'Arena';
