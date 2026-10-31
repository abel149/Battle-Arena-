import { useCallback, useEffect, useRef, useState } from 'react';
import { API, socket, signAndIdentify } from '../socket.js';
import { navigate, useRoute } from '../lib/router.js';
import { short, useProfile } from '../lib/session.js';
import RoomCode from '../components/RoomCode.jsx';
import SkinLockerModal from '../components/SkinLockerModal.jsx';
import ParentApprovalModal from '../components/ParentApprovalModal.jsx';
import './cyberblaster.css';

const ARENA_WIDTH = 800;
const ARENA_HEIGHT = 600;

const DEFAULT_OBSTACLES = [
  { x: 180, y: 140, w: 50, h: 100 },
  { x: 570, y: 140, w: 50, h: 100 },
  { x: 180, y: 360, w: 50, h: 100 },
  { x: 570, y: 360, w: 50, h: 100 },
  { x: 375, y: 260, w: 50, h: 80 },
];

// Skin color palettes for client rendering
const SKIN_PALETTES = {
  'neon-striker': {
    primary: '#00f0ff',
    accent: '#0077ff',
    laser: '#00ffff',
    trail: '#00d4ff',
    type: 'plasma',
  },
  'crimson-phoenix': {
    primary: '#ff2d55',
    accent: '#ff9500',
    laser: '#ff3b30',
    trail: '#ff6b4a',
    type: 'fireball',
  },
  'shadow-phantom': {
    primary: '#af52de',
    accent: '#5856d6',
    laser: '#bf5af2',
    trail: '#9d4edd',
    type: 'shuriken',
  },
  'emerald-titan': {
    primary: '#34c759',
    accent: '#30d158',
    laser: '#32d74b',
    trail: '#00ff88',
    type: 'railgun',
  },
  'solar-sovereign': {
    primary: '#ffd60a',
    accent: '#ff9f0a',
    laser: '#ffe600',
    trail: '#ffea70',
    type: 'solar',
  },
  'cosmic-dragon': {
    primary: '#00f5d4',
    accent: '#7b2cbf',
    laser: '#00f5d4',
    trail: '#70e000',
    type: 'dragon',
  },
};

// Web Audio API Synthesizer
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx && typeof window !== 'undefined') {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playLaserSound(type = 'plasma') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    const freq =
      type === 'fireball' ? 380 : type === 'railgun' ? 900 : type === 'shuriken' ? 650 : 520;
    osc.type = type === 'railgun' ? 'sawtooth' : 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.14);

    osc.start(now);
    osc.stop(now + 0.15);
  } catch {}
}

function playHitSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.18);

    osc.start(now);
    osc.stop(now + 0.19);
  } catch {}
}

function playPowerupSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [440, 554, 659, 880].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.05);
      gain.gain.setValueAtTime(0.15, now + idx * 0.05);
      gain.gain.linearRampToValueAtTime(0.01, now + idx * 0.05 + 0.12);
      osc.start(now + idx * 0.05);
      osc.stop(now + idx * 0.05 + 0.13);
    });
  } catch {}
}

export default function CyberBlaster() {
  const route = useRoute();
  const modeParam = route.params.get('mode');
  const mode = ['bot', 'match', 'create', 'join', 'watch'].includes(modeParam) ? modeParam : 'bot';
  const watchRoom = route.params.get('room');
  const watching = mode === 'watch';
  const joinCode = (route.params.get('code') || route.params.get('invite') || '').toUpperCase();
  const inviteCode = route.params.get('invite');
  const rawDiff = route.params.get('difficulty');
  const initialDiff = ['easy', 'medium', 'hard'].includes(rawDiff) ? rawDiff : 'medium';
  const [difficulty, setDifficulty] = useState(initialDiff);
  const { wallet, profile } = useProfile();

  const [room, setRoom] = useState(null);
  const [gameState, setGameState] = useState(null);
  const [queued, setQueued] = useState(false);
  const [roomCode, setRoomCode] = useState(null);
  const [error, setError] = useState(null);
  const [matchEnd, setMatchEnd] = useState(null);
  const [showSkinLocker, setShowSkinLocker] = useState(false);
  const [showParentPortal, setShowParentPortal] = useState(false);

  const canvasRef = useRef(null);
  const keysRef = useRef({ w: false, a: false, s: false, d: false, space: false, shift: false });
  const mouseRef = useRef({ x: 400, y: 300, isDown: false });
  const roomRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  // Start match
  const startMatch = useCallback(async () => {
    setError(null);
    setMatchEnd(null);
    setGameState(null);
    setRoomCode(null);

    await signAndIdentify(wallet);

    if (mode === 'watch' && watchRoom) {
      socket.emit('spectate', { roomId: watchRoom });
    } else if (mode === 'bot') {
      socket.emit('match:bot', { gameType: 'cyber-blaster', difficulty });
    } else if (mode === 'create') {
      socket.emit('room:create', { gameType: 'cyber-blaster' });
    } else if (mode === 'join') {
      socket.emit('room:join', { code: joinCode });
    } else {
      setQueued(true);
      socket.emit('queue:join', { gameType: 'cyber-blaster', inviteCode });
    }
  }, [mode, difficulty, joinCode, inviteCode, watchRoom, wallet]);

  useEffect(() => {
    if (socket.connected) startMatch();
    else socket.once('connect', startMatch);

    const handleMatchStart = (r) => {
      if (r.gameType !== 'cyber-blaster') return;
      setRoom(r);
      setGameState(r.game);
      setQueued(false);
      setRoomCode(null);
      setError(null);
    };

    const handleBlasterTick = (state) => {
      setGameState((prev) => ({ ...prev, ...state }));
      // Sound triggers from events
      if (state.events && state.events.length > 0) {
        state.events.forEach((e) => {
          if (e.type === 'shoot')
            playLaserSound(e.skinId ? SKIN_PALETTES[e.skinId]?.type : 'plasma');
          if (e.type === 'player_hit') playHitSound();
          if (e.type === 'powerup_collect') playPowerupSound();
        });
      }
    };

    const handleMatchEnd = (endData) => {
      setMatchEnd(endData);
    };

    const handleGameError = (err) => {
      setError(typeof err === 'string' ? err : err?.error || 'Something went wrong');
      setQueued(false);
    };

    const handleRoomWaiting = ({ code }) => {
      setRoomCode(code);
      setQueued(false);
    };

    const handleRoomExpired = () => {
      setRoomCode(null);
      setError('This room expired. Go back and create a new one.');
    };

    const handleMatchError = (data) => {
      setError(data?.error || 'Match error');
      setQueued(false);
    };

    socket.on('match:start', handleMatchStart);
    socket.on('blaster:tick', handleBlasterTick);
    socket.on('match:end', handleMatchEnd);
    socket.on('game:error', handleGameError);
    socket.on('player:error', handleGameError);
    socket.on('room:waiting', handleRoomWaiting);
    socket.on('room:expired', handleRoomExpired);
    socket.on('match:error', handleMatchError);

    return () => {
      socket.off('connect', startMatch);
      socket.off('match:start', handleMatchStart);
      socket.off('blaster:tick', handleBlasterTick);
      socket.off('match:end', handleMatchEnd);
      socket.off('game:error', handleGameError);
      socket.off('player:error', handleGameError);
      socket.off('room:waiting', handleRoomWaiting);
      socket.off('room:expired', handleRoomExpired);
      socket.off('match:error', handleMatchError);
      socket.emit('queue:leave');
      if (roomRef.current?.roomId) {
        socket.emit('match:leave', { roomId: roomRef.current.roomId });
      }
    };
  }, [startMatch]);

  // Server silence safeguard
  useEffect(() => {
    if (mode === 'match' || gameState || roomCode || error) return;
    const id = setTimeout(
      () =>
        setError(
          'The arena server did not respond. Restart it ("npm start" in the server folder) so it runs the latest code.'
        ),
      6000
    );
    return () => clearTimeout(id);
  }, [mode, gameState, roomCode, error]);

  // Input listeners
  useEffect(() => {
    const handleKeyDown = (e) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') keysRef.current.w = true;
      if (code === 'KeyA' || code === 'ArrowLeft') keysRef.current.a = true;
      if (code === 'KeyS' || code === 'ArrowDown') keysRef.current.s = true;
      if (code === 'KeyD' || code === 'ArrowRight') keysRef.current.d = true;
      if (code === 'Space') {
        keysRef.current.space = true;
        e.preventDefault();
      }
      if (code === 'ShiftLeft' || code === 'ShiftRight') keysRef.current.shift = true;
    };

    const handleKeyUp = (e) => {
      const code = e.code;
      if (code === 'KeyW' || code === 'ArrowUp') keysRef.current.w = false;
      if (code === 'KeyA' || code === 'ArrowLeft') keysRef.current.a = false;
      if (code === 'KeyS' || code === 'ArrowDown') keysRef.current.s = false;
      if (code === 'KeyD' || code === 'ArrowRight') keysRef.current.d = false;
      if (code === 'Space') keysRef.current.space = false;
      if (code === 'ShiftLeft' || code === 'ShiftRight') keysRef.current.shift = false;
    };

    const handleMouseMove = (e) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = ARENA_WIDTH / rect.width;
      const scaleY = ARENA_HEIGHT / rect.height;
      mouseRef.current.x = (e.clientX - rect.left) * scaleX;
      mouseRef.current.y = (e.clientY - rect.top) * scaleY;
    };

    const handleMouseDown = (e) => {
      if (e.button === 0) mouseRef.current.isDown = true;
      if (e.button === 2) {
        keysRef.current.shift = true;
        e.preventDefault();
      }
    };

    const handleMouseUp = (e) => {
      if (e.button === 0) mouseRef.current.isDown = false;
      if (e.button === 2) keysRef.current.shift = false;
    };

    const canvas = canvasRef.current;
    const preventContextMenu = (e) => e.preventDefault();
    if (canvas) canvas.addEventListener('contextmenu', preventContextMenu);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      if (canvas) canvas.removeEventListener('contextmenu', preventContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Send input tick to server every 40ms
  useEffect(() => {
    if (!room?.roomId || matchEnd || watching) return;

    const interval = setInterval(() => {
      let vx = 0;
      let vy = 0;
      if (keysRef.current.w) vy -= 1;
      if (keysRef.current.s) vy += 1;
      if (keysRef.current.a) vx -= 1;
      if (keysRef.current.d) vx += 1;

      const mySeat = room.game?.players?.X === wallet?.address ? 'X' : 'O';
      const myPos = gameState?.pState?.[mySeat] || { x: 100, y: 300 };
      const angle = Math.atan2(mouseRef.current.y - myPos.y, mouseRef.current.x - myPos.x);

      socket.emit('blaster:input', {
        roomId: room.roomId,
        vx,
        vy,
        angle,
        shoot: keysRef.current.space || mouseRef.current.isDown,
        dash: keysRef.current.shift,
      });

      // Clear dash trigger after send
      keysRef.current.shift = false;
    }, 40);

    return () => clearInterval(interval);
  }, [room, gameState, wallet, matchEnd]);

  // Canvas render loop (60 FPS)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animId;

    const render = () => {
      // 1. Clear background
      ctx.fillStyle = '#060a14';
      ctx.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

      // Cyber grid lines
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < ARENA_WIDTH; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ARENA_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y < ARENA_HEIGHT; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(ARENA_WIDTH, y);
        ctx.stroke();
      }

      // Arena boundary glow
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, ARENA_WIDTH - 4, ARENA_HEIGHT - 4);

      if (gameState) {
        // 2. Obstacles
        const obstacles = gameState.obstacles || DEFAULT_OBSTACLES;
        obstacles.forEach((obs) => {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
          ctx.strokeStyle = '#00f0ff';
          ctx.lineWidth = 2;
          ctx.strokeRect(obs.x, obs.y, obs.w, obs.h);

          // Glow core
          ctx.fillStyle = 'rgba(0, 240, 255, 0.15)';
          ctx.fillRect(obs.x + 4, obs.y + 4, obs.w - 8, obs.h - 8);
        });

        // 3. Powerups
        if (gameState.powerups) {
          gameState.powerups.forEach((pow) => {
            const time = Date.now() / 400;
            const floatOffset = Math.sin(time) * 4;
            ctx.beginPath();
            ctx.arc(pow.x, pow.y + floatOffset, 14, 0, Math.PI * 2);
            ctx.fillStyle =
              pow.type === 'shield'
                ? '#00f0ff'
                : pow.type === 'overcharge'
                  ? '#ffd60a'
                  : pow.type === 'speed'
                    ? '#af52de'
                    : '#34c759';
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();

            ctx.font = '14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const icon =
              pow.type === 'shield'
                ? '🛡️'
                : pow.type === 'overcharge'
                  ? '⚡'
                  : pow.type === 'speed'
                    ? '💨'
                    : '❤️';
            ctx.fillText(icon, pow.x, pow.y + floatOffset);
          });
        }

        // 4. Bullets
        if (gameState.bullets) {
          gameState.bullets.forEach((b) => {
            const pal = SKIN_PALETTES[b.skinId] || SKIN_PALETTES['neon-striker'];
            ctx.save();
            ctx.beginPath();
            ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = pal.laser;
            ctx.shadowColor = pal.laser;
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.restore();
          });
        }

        // 5. Players
        ['X', 'O'].forEach((seat) => {
          const p = gameState.pState?.[seat];
          if (!p) return;
          const skinId = gameState.skins?.[seat] || 'neon-striker';
          const pal = SKIN_PALETTES[skinId] || SKIN_PALETTES['neon-striker'];

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);

          // Thruster particles
          ctx.beginPath();
          ctx.moveTo(-16, -6);
          ctx.lineTo(-26 - Math.random() * 8, 0);
          ctx.lineTo(-16, 6);
          ctx.fillStyle = pal.trail;
          ctx.shadowColor = pal.trail;
          ctx.shadowBlur = 10;
          ctx.fill();

          // Ship body (Delta hover-fighter)
          ctx.beginPath();
          ctx.moveTo(18, 0);
          ctx.lineTo(-14, -14);
          ctx.lineTo(-8, 0);
          ctx.lineTo(-14, 14);
          ctx.closePath();
          ctx.fillStyle = pal.primary;
          ctx.fill();
          ctx.strokeStyle = pal.accent;
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Cockpit canopy
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(-4, -4);
          ctx.lineTo(-4, 4);
          ctx.closePath();
          ctx.fillStyle = '#ffffff';
          ctx.fill();

          // Shield bubble
          if (p.shield > 0) {
            ctx.beginPath();
            ctx.arc(0, 0, 24, 0, Math.PI * 2);
            ctx.strokeStyle = '#00f0ff';
            ctx.lineWidth = 2.5;
            ctx.shadowColor = '#00f0ff';
            ctx.shadowBlur = 14;
            ctx.stroke();
          }

          ctx.restore();

          // Health bar above ship
          const barW = 44;
          const barH = 5;
          const barX = p.x - barW / 2;
          const barY = p.y - 28;
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(barX, barY, barW, barH);
          const hpW = Math.max(0, (p.hp / 100) * barW);
          ctx.fillStyle = p.hp > 50 ? '#10b981' : p.hp > 25 ? '#f59e0b' : '#ef4444';
          ctx.fillRect(barX, barY, hpW, barH);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, barW, barH);
        });
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [gameState]);

  const mySeat = room?.game?.players?.X === wallet?.address ? 'X' : 'O';
  const oppSeat = mySeat === 'X' ? 'O' : 'X';
  const myPlayer = gameState?.pState?.[mySeat];
  const oppPlayer = gameState?.pState?.[oppSeat];
  const mySkin = SKIN_PALETTES[gameState?.skins?.[mySeat] || 'neon-striker'];
  const oppSkin = SKIN_PALETTES[gameState?.skins?.[oppSeat] || 'neon-striker'];

  return (
    <div className="blaster-page">
      {/* Top Navigation */}
      <header className="blaster-header">
        <div className="header-left">
          <a
            className="btn-back"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate('');
            }}
          >
            ← Hub
          </a>
          <span className="blaster-title">⚔️ Cyber Blaster Arena</span>
          <span className="blaster-mode-badge">
            {mode === 'bot' ? `Bot (${difficulty})` : 'Online 1v1'}
          </span>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="btn-header-armory"
            onClick={() => setShowSkinLocker(true)}
          >
            🎨 Skin Locker & Chores
          </button>
          <button
            type="button"
            className="btn-header-parent"
            onClick={() => setShowParentPortal(true)}
          >
            🛡️ Parent Portal
          </button>
        </div>
      </header>

      {/* Main Game Stage */}
      <main className="blaster-arena-container">
        {!gameState &&
        (queued || mode === 'create' || mode === 'join' || mode === 'watch' || error) ? (
          <div className="blaster-queue-card">
            <div className="queue-spinner" aria-hidden="true" />
            <h2>
              {error
                ? 'Match error'
                : mode === 'watch'
                  ? 'Spectator Mode'
                  : mode === 'create'
                    ? 'Room Ready'
                    : mode === 'join'
                      ? 'Joining Room'
                      : 'Searching for Opponent...'}
            </h2>
            <p>
              {error ||
                (mode === 'watch'
                  ? 'Connecting to live arena match as spectator…'
                  : mode === 'create'
                    ? 'Share this code with a friend — your duel begins as soon as they join.'
                    : mode === 'join'
                      ? 'Connecting to your friend’s arena room…'
                      : 'Matching you with a pilot across the arena network.')}
            </p>
            {!error && mode === 'create' && roomCode && <RoomCode code={roomCode} />}
            <button
              type="button"
              className="btn-cancel-queue"
              onClick={() => {
                socket.emit('queue:leave');
                if (roomRef.current?.roomId)
                  socket.emit('match:leave', { roomId: roomRef.current.roomId });
                navigate('');
              }}
            >
              {error ? 'Back to Hub' : 'Cancel'}
            </button>
          </div>
        ) : (
          <>
            {/* Top Score HUD */}
            <div className="blaster-hud">
              {/* Player Left */}
              <div className="hud-player left">
                <div className="hud-name">
                  <span className="seat-badge seat-x">P1</span>
                  <strong>{room?.names?.[room?.game?.players?.X] || 'Player 1'}</strong>
                </div>
                <div className="hud-hp-bar">
                  <div
                    className="hud-hp-fill fill-x"
                    style={{ width: `${gameState?.pState?.X?.hp ?? 100}%` }}
                  />
                  <span className="hud-hp-text">{gameState?.pState?.X?.hp ?? 100} HP</span>
                </div>
              </div>

              {/* Center Match Score */}
              <div className="hud-center">
                <div className="hud-score">
                  <span className="score-val">{gameState?.score?.X ?? 0}</span>
                  <span className="score-divider">:</span>
                  <span className="score-val">{gameState?.score?.O ?? 0}</span>
                </div>
                <div className="hud-round">Round {gameState?.round ?? 1} / Best of 3</div>
              </div>

              {/* Player Right */}
              <div className="hud-player right">
                <div className="hud-name">
                  <strong>{room?.names?.[room?.game?.players?.O] || 'ArenaBot'}</strong>
                  <span className="seat-badge seat-o">P2</span>
                </div>
                <div className="hud-hp-bar">
                  <div
                    className="hud-hp-fill fill-o"
                    style={{ width: `${gameState?.pState?.O?.hp ?? 100}%` }}
                  />
                  <span className="hud-hp-text">{gameState?.pState?.O?.hp ?? 100} HP</span>
                </div>
              </div>
            </div>

            {/* 60 FPS HTML5 Canvas */}
            <div className="canvas-wrapper">
              <canvas
                ref={canvasRef}
                width={ARENA_WIDTH}
                height={ARENA_HEIGHT}
                className="blaster-canvas"
              />
            </div>

            {/* Bottom Controls Info */}
            <div className="blaster-controls-bar">
              <div className="control-item">
                <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> Move
              </div>
              <div className="control-item">
                <kbd>MOUSE</kbd> Aim Direction
              </div>
              <div className="control-item">
                <kbd>CLICK</kbd> or <kbd>SPACE</kbd> Fire Laser
              </div>
              <div className="control-item">
                <kbd>SHIFT</kbd> or <kbd>R-CLICK</kbd> Thruster Dash
              </div>
            </div>
          </>
        )}
      </main>

      {/* Match Over Modal */}
      {matchEnd && (
        <div className="match-end-overlay">
          <div className="match-end-dialog">
            <div className="end-trophy">{matchEnd.winner === mySeat ? '🏆' : '💀'}</div>
            <h2>{matchEnd.winner === mySeat ? 'VICTORY!' : 'DEFEAT'}</h2>
            <p>
              {matchEnd.winner === mySeat
                ? 'Outstanding piloting! You won the Cyber Blaster duel.'
                : 'Defeated in the arena. Practice your maneuvers and try again!'}
            </p>

            <div className="match-end-rewards">
              <div className="reward-pill">+50 XP</div>
              <div className="reward-pill">+10 ARENA Tokens</div>
              <div className="reward-pill">⚡ -1 Energy</div>
            </div>

            <div className="end-actions">
              <button type="button" className="btn-end-play" onClick={startMatch}>
                Play Again 🔄
              </button>
              <button
                type="button"
                className="btn-end-armory"
                onClick={() => setShowSkinLocker(true)}
              >
                🎨 Change Skin
              </button>
              <button type="button" className="btn-end-hub" onClick={() => navigate('')}>
                Back to Hub
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showSkinLocker && (
        <SkinLockerModal
          kidAddress={wallet?.address}
          parentAddress={profile?.parentAddress}
          onClose={() => setShowSkinLocker(false)}
        />
      )}

      {showParentPortal && (
        <ParentApprovalModal
          parentAddress={profile?.parentAddress}
          onClose={() => setShowParentPortal(false)}
        />
      )}
    </div>
  );
}
