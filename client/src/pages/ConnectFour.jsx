import { useCallback, useEffect, useRef, useState } from 'react';
import { API, socket, signAndIdentify } from '../socket.js';
import { navigate, useRoute } from '../lib/router.js';
import { short, useProfile } from '../lib/session.js';
import RoomCode from '../components/RoomCode.jsx';
import MatchChat from '../components/MatchChat.jsx';
import './connectfour.css';

const COLS = 7;
const ROWS = 6;

export default function ConnectFour() {
  const route = useRoute();
  const modeParam = route.params.get('mode');
  const mode = ['bot', 'watch', 'create', 'join'].includes(modeParam) ? modeParam : 'match';
  const watching = mode === 'watch';
  const watchRoom = route.params.get('room');
  const inviteCode = route.params.get('invite');
  const joinCode = (route.params.get('code') || route.params.get('invite') || '').toUpperCase();
  const rawDiff = route.params.get('difficulty');
  const initialDiff = ['easy', 'medium', 'hard'].includes(rawDiff) ? rawDiff : 'medium';
  const [difficulty, setDifficulty] = useState(initialDiff);
  const { wallet, profile } = useProfile();

  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [queued, setQueued] = useState(false);
  const [roomCode, setRoomCode] = useState(null);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [hoverCol, setHoverCol] = useState(null);
  const [outOfEnergy, setOutOfEnergy] = useState(false);

  const roomRef = useRef(null);
  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    async function start() {
      await signAndIdentify(wallet);
      if (mode === 'watch') {
        socket.emit('spectate', { roomId: watchRoom });
      } else if (mode === 'bot') {
        socket.emit('match:bot', { gameType: 'connect-four', difficulty });
      } else if (mode === 'create') {
        socket.emit('room:create', { gameType: 'connect-four' });
      } else if (mode === 'join') {
        socket.emit('room:join', { code: joinCode });
      } else {
        socket.emit('queue:join', { gameType: 'connect-four', inviteCode });
        setQueued(true);
      }
    }
    if (socket.connected) start();
    else socket.once('connect', start);
    return () => socket.off('connect', start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, inviteCode, joinCode, watchRoom, difficulty]);

  useEffect(() => {
    const onStart = (data) => {
      const next = { roomId: data.roomId, names: data.names || {}, gameType: data.gameType };
      roomRef.current = next;
      setRoom(next);
      setGame(data.game);
      setQueued(false);
      setRoomCode(null);
      setReceipt(null);
      setError(null);
      setOutOfEnergy(false);
    };

    const mine = (roomId) => !!roomId && roomId === roomRef.current?.roomId;
    const onState = (data) => {
      if (mine(data.roomId)) setGame(data.game);
    };

    const onEnd = (data) => {
      if (!mine(data.roomId)) return;
      setReceipt({ ...(data.receipt || {}), winner: data.winner, result: data.result });
    };

    const onWaiting = () => setQueued(true);
    const onRoomWaiting = ({ code }) => {
      setRoomCode(code);
      setQueued(false);
    };
    const onRoomExpired = () => {
      setRoomCode(null);
      setError('This room expired. Go back and create a new one.');
    };
    const onError = (msg) => {
      setError(typeof msg === 'string' ? msg : msg?.error || 'Something went wrong');
      setQueued(false);
    };
    const onMatchError = (data) => {
      if (data?.needsEnergy) {
        setOutOfEnergy(true);
        setQueued(false);
      } else {
        setError(data?.error || 'Match error');
        setQueued(false);
      }
    };

    socket.on('match:start', onStart);
    socket.on('game:state', onState);
    socket.on('match:end', onEnd);
    socket.on('queue:waiting', onWaiting);
    socket.on('room:waiting', onRoomWaiting);
    socket.on('room:expired', onRoomExpired);
    socket.on('game:error', onError);
    socket.on('player:error', onError);
    socket.on('match:error', onMatchError);

    return () => {
      socket.off('match:start', onStart);
      socket.off('game:state', onState);
      socket.off('match:end', onEnd);
      socket.off('queue:waiting', onWaiting);
      socket.off('room:waiting', onRoomWaiting);
      socket.off('room:expired', onRoomExpired);
      socket.off('game:error', onError);
      socket.off('player:error', onError);
      socket.off('match:error', onMatchError);
      const r = roomRef.current;
      socket.emit('queue:leave');
      if (r?.roomId) socket.emit('match:leave', { roomId: r.roomId });
    };
  }, []);

  // Server silence safeguard
  useEffect(() => {
    if (mode === 'match' || game || roomCode || error) return;
    const id = setTimeout(
      () =>
        setError(
          'The arena server did not respond. Restart it ("npm start" in the server folder) so it runs the latest code.'
        ),
      6000
    );
    return () => clearTimeout(id);
  }, [mode, game, roomCode, error]);

  const leave = useCallback(() => {
    socket.emit('queue:leave');
    if (roomRef.current?.roomId) socket.emit('match:leave', { roomId: roomRef.current.roomId });
    navigate('hub');
  }, []);

  function handleDrop(col) {
    if (!room || !game || game.winner || watching) return;
    const mySymbol =
      game.players.X === wallet.address ? 'X' : game.players.O === wallet.address ? 'O' : null;
    if (game.turn !== mySymbol) return;
    socket.emit('game:move', { roomId: room.roomId, col });
  }

  function handleRematch() {
    setReceipt(null);
    setGame(null);
    setRoomCode(null);
    if (mode === 'bot') {
      socket.emit('match:bot', { gameType: 'connect-four', difficulty });
    } else if (mode === 'create') {
      socket.emit('room:create', { gameType: 'connect-four' });
    } else {
      socket.emit('queue:join', { gameType: 'connect-four' });
      setQueued(true);
    }
  }

  const mySymbol =
    game?.players.X === wallet.address ? 'X' : game?.players.O === wallet.address ? 'O' : null;
  const isMyTurn = !watching && mySymbol && game?.turn === mySymbol && !game?.winner;
  const nameOf = (addr) => room?.names?.[addr] || short(addr) || 'Player';

  const isWinCell = (r, c) => {
    if (!game?.winCells) return false;
    return game.winCells.some(([wr, wc]) => wr === r && wc === c);
  };

  return (
    <div className="c4-page">
      <div className="c4-glow" aria-hidden="true" />

      {/* Header */}
      <header className="c4-topbar">
        <button type="button" className="c4-back-btn" onClick={() => navigate('hub')}>
          ← Hub
        </button>
        <div className="c4-title-group">
          <h1 className="c4-title">Connect Four Arena</h1>
          <span className="c4-sub">Drop 4 glowing discs in a row to win</span>
        </div>
        <div className="c4-energy-chip" onClick={() => navigate('battlepass')}>
          ⚡ {profile?.energy ?? 5} Energy
        </div>
      </header>

      {/* Out of Energy Dialog */}
      {outOfEnergy && (
        <div className="c4-overlay">
          <div className="c4-modal">
            <div className="modal-icon">⚡</div>
            <h2>Out of Arena Energy!</h2>
            <p>
              Arena Energy cannot be bought with money — it must be earned! Clean your room, finish
              your homework, or pass the Brain Quiz to earn Energy and play again.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-go-battlepass"
                onClick={() => navigate('battlepass')}
              >
                Go to Battle Pass & Chores →
              </button>
              <button type="button" className="btn-cancel" onClick={() => navigate('hub')}>
                Back to Hub
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Private Room Waiting & Joining Modal */}
      {!game && (mode === 'create' || mode === 'join' || (error && mode !== 'match')) && (
        <div className="c4-overlay">
          <div className="c4-modal">
            <div className="modal-icon">{error ? '⚠️' : mode === 'create' ? '🏷️' : '🔑'}</div>
            <h2>{error ? 'Match error' : mode === 'create' ? 'Room Ready' : 'Joining Room'}</h2>
            <p>
              {error ||
                (mode === 'create'
                  ? 'Share this 5-character code with a friend — the match begins as soon as they enter it.'
                  : 'Connecting to your friend’s Connect Four room…')}
            </p>
            {!error && mode === 'create' && roomCode && <RoomCode code={roomCode} />}
            <div className="modal-actions">
              <button type="button" className="btn-cancel" onClick={leave}>
                {error ? 'Back to Hub' : 'Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Queueing State */}
      {queued && (
        <div className="c4-queue-banner">
          <div className="spinner" />
          <span>Searching for an online challenger… (-1 ⚡ on match start)</span>
          <button type="button" className="btn-cancel-q" onClick={leave}>
            Cancel
          </button>
        </div>
      )}

      {error && !['create', 'join'].includes(mode) && <div className="c4-alert">{error}</div>}

      {/* Main Game Arena */}
      <main className="c4-arena-body">
        <div className="c4-board-panel">
          {/* Status Bar */}
          {game && (
            <div className="c4-status-bar">
              <div className="player-badge seat-x">
                <span className="disc-dot disc-x" />
                <span className="p-name">{nameOf(game.players.X)} (X)</span>
                {game.players.X === wallet.address && <span className="you-pill">You</span>}
              </div>

              <div className="c4-turn-pill">
                {game.winner
                  ? game.winner === 'draw'
                    ? 'Game Drawn!'
                    : `${nameOf(game.players[game.winner])} Wins!`
                  : isMyTurn
                    ? '👉 Your Turn to Drop'
                    : `Waiting for ${nameOf(game.players[game.turn])}…`}
              </div>

              <div className="player-badge seat-o">
                <span className="disc-dot disc-o" />
                <span className="p-name">{nameOf(game.players.O)} (O)</span>
                {game.players.O === wallet.address && <span className="you-pill">You</span>}
              </div>
            </div>
          )}

          {/* Connect Four Grid */}
          <div className="c4-grid-container">
            {/* Top Drop Arrows */}
            <div className="c4-drop-row">
              {Array.from({ length: COLS }).map((_, c) => (
                <button
                  key={c}
                  type="button"
                  className={`c4-drop-btn ${isMyTurn ? 'clickable' : 'disabled'} ${hoverCol === c ? 'hovered' : ''}`}
                  onClick={() => handleDrop(c)}
                  onMouseEnter={() => setHoverCol(c)}
                  onMouseLeave={() => setHoverCol(null)}
                  disabled={!isMyTurn || !!game?.winner}
                  title={`Drop disc in column ${c + 1}`}
                >
                  ↓
                </button>
              ))}
            </div>

            {/* Board Frame & Slots */}
            <div className="c4-board-frame">
              {(game?.grid || Array.from({ length: ROWS }, () => Array(COLS).fill(null))).map(
                (row, r) => (
                  <div key={r} className="c4-row">
                    {row.map((cell, c) => {
                      const isWin = isWinCell(r, c);
                      return (
                        <div
                          key={c}
                          className={`c4-slot ${cell ? `filled cell-${cell.toLowerCase()}` : 'empty'} ${isWin ? 'win-slot' : ''}`}
                          onClick={() => handleDrop(c)}
                          onMouseEnter={() => setHoverCol(c)}
                          onMouseLeave={() => setHoverCol(null)}
                        >
                          <div className="c4-slot-inner">
                            {cell && (
                              <div
                                className={`c4-disc disc-${cell.toLowerCase()} ${isWin ? 'disc-win' : ''}`}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>

          {/* Post-match Receipt */}
          {receipt && (
            <div className="c4-receipt-box">
              <div className="receipt-head">
                <h3>
                  {receipt.winner === wallet.address
                    ? '🏆 Victory!'
                    : receipt.winner === 'draw'
                      ? '🤝 Draw!'
                      : 'Match Finished'}
                </h3>
                <span className="receipt-xp">+25 Battle Pass XP earned!</span>
              </div>
              <p className="receipt-sub">
                Result recorded: <code>{receipt.matchId}</code>
              </p>
              <div className="receipt-actions">
                <button type="button" className="btn-rematch" onClick={handleRematch}>
                  Play Again (-1 ⚡)
                </button>
                <button type="button" className="btn-hub" onClick={() => navigate('hub')}>
                  Return to Hub
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Chat Panel */}
        {room && (
          <aside className="c4-chat-sidebar">
            <MatchChat roomId={room.roomId} />
          </aside>
        )}
      </main>
    </div>
  );
}
