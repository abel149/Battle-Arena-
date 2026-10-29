import { useCallback, useEffect, useRef, useState } from 'react';
import { API, socket, signAndIdentify } from '../socket.js';
import { navigate, useRoute } from '../lib/router.js';
import { short, useProfile } from '../lib/session.js';
import RoomCode from '../components/RoomCode.jsx';
import MatchChat from '../components/MatchChat.jsx';
import './memory.css';

const WAITING_COPY = {
  bot: ['Shuffling the deck', 'The bot is taking its seat across the table…'],
  create: ['Room ready', 'Share this code with a friend — the match starts as soon as they join.'],
  join: ['Joining room', 'Connecting you to your friend’s room…'],
  watch: ['Joining the match', 'Joining the match. If nothing appears, it has already finished.'],
  match: ['Finding an opponent', 'Waiting for another player to join Memory Match. Open a second window to play against yourself.'],
};

export default function MemoryMatch() {
  const route = useRoute();
  const modeParam = route.params.get('mode');
  const mode = ['bot', 'create', 'join', 'watch'].includes(modeParam) ? modeParam : 'match';
  const joinCode = (route.params.get('code') || '').toUpperCase();
  const watching = mode === 'watch';
  const watchRoom = route.params.get('room');
  const deck = route.params.get('deck') || 'flags';
  const rawDiff = route.params.get('difficulty');
  const initialDiff = ['easy', 'medium', 'hard'].includes(rawDiff) ? rawDiff : 'medium';
  const [difficulty, setDifficulty] = useState(initialDiff);
  const { wallet } = useProfile();

  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [queued, setQueued] = useState(false);
  const [roomCode, setRoomCode] = useState(null);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [deckLabel, setDeckLabel] = useState('Educational decks');

  const roomRef = useRef(null);
  useEffect(() => { roomRef.current = room; }, [room]);

  useEffect(() => {
    async function start() {
      // Await the signed identify — queue:join must arrive after the server
      // has verified our wallet signature, or it is silently dropped.
      await signAndIdentify(wallet);
      if (mode === 'watch') socket.emit('spectate', { roomId: watchRoom });
      else if (mode === 'bot') socket.emit('match:bot', { gameType: 'memory', deck, difficulty });
      else if (mode === 'create') socket.emit('room:create', { gameType: 'memory', deck });
      else if (mode === 'join') socket.emit('room:join', { code: joinCode });
      else {
        socket.emit('queue:join', { gameType: 'memory', deck });
        setQueued(true);
      }
    }
    if (socket.connected) start();
    else socket.once('connect', start);
    return () => socket.off('connect', start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deck, joinCode, watchRoom]);

  useEffect(() => {
    const onStart = data => {
      const next = { roomId: data.roomId, names: data.names || {} };
      roomRef.current = next;
      setRoom(next);
      setGame(data.game);
      setQueued(false);
      setRoomCode(null);
      setReceipt(null);
      setError(null);
      if (data.game?.deckLabel) setDeckLabel(data.game.deckLabel);
    };
    const mine = roomId => !!roomId && roomId === roomRef.current?.roomId;
    const onState = data => { if (mine(data.roomId)) setGame(data.game); };
    const onEnd = data => {
      if (!mine(data.roomId)) return;
      setReceipt({ ...(data.receipt || {}), winner: data.winner, result: data.result });
    };
    const onWaiting = () => setQueued(true);
    const onRoomWaiting = ({ code }) => setRoomCode(code);
    const onRoomExpired = () => { setRoomCode(null); setError('This room expired. Go back and create a new one.'); };
    const onError = msg => setError(typeof msg === 'string' ? msg : msg?.error || 'Something went wrong');

    socket.on('match:start', onStart);
    socket.on('game:state', onState);
    socket.on('match:end', onEnd);
    socket.on('queue:waiting', onWaiting);
    socket.on('room:waiting', onRoomWaiting);
    socket.on('room:expired', onRoomExpired);
    socket.on('game:error', onError);
    socket.on('player:error', onError);

    return () => {
      socket.off('match:start', onStart);
      socket.off('game:state', onState);
      socket.off('match:end', onEnd);
      socket.off('queue:waiting', onWaiting);
      socket.off('room:waiting', onRoomWaiting);
      socket.off('room:expired', onRoomExpired);
      socket.off('game:error', onError);
      socket.off('player:error', onError);
      const r = roomRef.current;
      socket.emit('queue:leave');
      if (r?.roomId) socket.emit('match:leave', { roomId: r.roomId });
    };
  }, []);

  useEffect(() => {
    fetch(`${API}/api/decks`)
      .then(r => r.json())
      .then(list => {
        const found = Array.isArray(list) && list.find(d => d.id === deck);
        if (found) setDeckLabel(found.label);
      })
      .catch(() => {});
  }, [deck]);

  // Bot, create and join answer within moments. Silence means the server is down
  // or still running old code — say so instead of spinning forever.
  useEffect(() => {
    if (mode === 'match' || mode === 'watch' || game || roomCode || error) return;
    const id = setTimeout(() => setError(
      'The arena server did not respond. Restart it ("npm start" in the server folder) so it runs the latest code.'
    ), 6000);
    return () => clearTimeout(id);
  }, [mode, game, roomCode, error]);

  useEffect(() => {
    document.title = 'Memory Match — Battle Arena';
    return () => { document.title = 'Battle Arena'; };
  }, []);

  // When watching, the left card follows the first player (seat X).
  const meAddr = watching && game ? game.players.X : wallet.address;
  const mySeat = game ? (game.players.X === meAddr ? 'X' : game.players.O === meAddr ? 'O' : null) : null;
  const oppSeat = mySeat === 'X' ? 'O' : 'X';
  const myName = mode === 'bot'
    ? 'You'
    : (room?.names?.[meAddr] || (watching && meAddr ? short(meAddr) : 'You'));
  const oppAddr = game ? game.players[oppSeat] : null;
  const oppName = room?.names?.[oppAddr] || (oppAddr ? short(oppAddr) : 'Opponent');
  const myTurn = !!game && !game.winner && game.players[game.turn] === meAddr;
  // Memory scores are keyed by wallet address, not by seat.
  const myScore = game ? game.scores?.[meAddr] ?? 0 : 0;
  const oppScore = game && oppAddr ? game.scores?.[oppAddr] ?? 0 : 0;

  const flip = useCallback(index => {
    const r = roomRef.current;
    if (!r?.roomId) return;
    socket.emit('game:move', { roomId: r.roomId, index });
  }, []);

  function playAgain(diffOverride) {
    const nextDiff = diffOverride || difficulty;
    if (diffOverride && diffOverride !== difficulty) setDifficulty(diffOverride);
    setGame(null);
    setRoom(null);
    setReceipt(null);
    socket.emit('match:bot', { gameType: 'memory', deck, difficulty: nextDiff });
  }

  function leave() {
    socket.emit('queue:leave');
    if (room?.roomId) socket.emit('match:leave', { roomId: room.roomId });
    navigate('hub');
  }

  const iWon = receipt && receipt.winner === wallet.address;
  const isDraw = receipt && !receipt.winner;
  const winnerName = receipt?.winner ? (room?.names?.[receipt.winner] || short(receipt.winner)) : '';

  return (
    <div className="mem-page">
      <header className="mem-top">
        <a className="mem-back" href="#hub">← Lobby</a>
        <h1 className="mem-title">Memory Match</h1>
        <span className="mem-deck">{deckLabel}{watching ? ' · Watching' : ''}</span>
      </header>

      <div className="mem-arena">
        <div className="mem-scores">
       <ScoreCard name={myName} score={myScore} me active={myTurn} you={!watching} />
          <div className="mem-status">
            {receipt
              ? isDraw ? 'Draw' : watching ? `${winnerName} wins` : iWon ? 'Victory' : 'Defeat'
              : watching
                ? `${myTurn ? myName : oppName}'s turn`
                : myTurn ? 'Your turn' : `${oppName}'s turn`}
          </div>
          <ScoreCard
            name={oppName}
            score={oppScore}
            active={!!game && !myTurn && !game.winner}
            difficulty={mode === 'bot' ? difficulty : null}
          />
        </div>

        {game && (
          <>
            <div className={`mem-grid ${game.locked ? 'locked' : ''}`}>
              {game.cards.map((card, i) => (
                <button
                  key={i}
                  type="button"
                  className={[
                    'mem-card',
                    card.matched ? 'matched' : card.flipped ? 'flipped' : '',
                    card.matched && card.content ? 'learned' : '',
                  ].filter(Boolean).join(' ')}
                  disabled={watching || !myTurn || card.matched || card.flipped || game.locked || !!game.winner}
                  onClick={() => flip(i)}
                  aria-label={card.flipped || card.matched ? `Card: ${card.content}` : 'Hidden card'}
                >
                  <span className="mem-card-inner">
                    {card.flipped || card.matched ? (
                      <span className={`mem-face ${String(card.content).length > 6 ? 'text' : ''}`}>
                        {card.content}
                      </span>
                    ) : (
                      <span className="mem-q" aria-hidden="true">?</span>
                    )}
                  </span>
                </button>
              ))}
            </div>

            <div className="mem-foot">
              <span className={`mem-hint ${myTurn ? 'on' : ''}`}>
                {game.winner
                  ? game.winner === 'draw'
                    ? 'Match drawn — every pair found.'
                    : `${room?.names?.[game.players[game.winner]] || 'Winner'} takes the match.`
                  : game.locked
                    ? 'Checking the pair…'
                    : myTurn
                      ? (watching ? `${myName} is flipping…` : 'Flip two cards — a matching pair scores and keeps your turn.')
                      : (watching ? `${oppName} is flipping…` : 'Waiting for your rival to flip…')}
              </span>
              {game.moveCount !== undefined && (
                <span className="mem-moves">{game.moveCount} flips</span>
              )}
            </div>
          </>
        )}

        {mode !== 'bot' && !watching && room?.roomId && (
          <MatchChat roomId={room.roomId} myAddress={wallet.address} />
        )}

        {error && <div className="mem-error">{error}</div>}

        {(game?.winner || receipt) && (
          <div className={`mem-result ${iWon ? 'win' : isDraw ? 'draw' : 'loss'}`}>
            <div className="mem-result-head">
              <span className="mem-result-icon">{iWon ? '🏆' : isDraw ? '🤝' : '⚔️'}</span>
              <div>
                <h2>{isDraw ? 'It’s a draw!' : watching ? `${winnerName} wins!` : iWon ? 'You win!' : 'You lose this one'}</h2>
                <p>
                  {myScore} : {oppScore} pairs
                  {receipt?.gameType ? ` · ${receipt.gameType}` : ''}
                </p>
              </div>
            </div>
            {mode === 'bot' && (
              <div className="rematch-difficulty">
                <span className="diff-title">🤖 Bot Level:</span>
                <div className="diff-selector" role="radiogroup" aria-label="Bot Difficulty">
                  {['easy', 'medium', 'hard'].map(lvl => (
                    <button
                      key={lvl}
                      type="button"
                      className={`diff-chip ${difficulty === lvl ? 'active' : ''} diff-${lvl}`}
                      onClick={() => setDifficulty(lvl)}
                    >
                      {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mem-result-actions">
              {receipt ? (
                <a
                  className="mem-btn ghost"
                  href={`${API}/api/verify/${receipt.matchId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  ⛓ {short(receipt.txHash || receipt.matchId)}
                </a>
              ) : (
                <span className="mem-btn ghost" style={{ opacity: 0.7 }}>
                  ⛓ Confirming on blockchain…
                </span>
              )}
              {mode === 'bot' && (
                <button type="button" className="mem-btn" onClick={() => playAgain(difficulty)}>Play again</button>
              )}
              <button type="button" className="mem-btn ghost" onClick={leave}>Back to hub</button>
            </div>
          </div>
        )}
      </div>

      {!game && (
        <div className="mem-waiting">
          <div className="mem-waiting-card">
            <div className="mem-spinner" aria-hidden="true" />
            <h2>{error ? 'Match error' : WAITING_COPY[mode][0]}</h2>
            <p>{error || WAITING_COPY[mode][1]}</p>
            {!error && mode === 'create' && roomCode && <RoomCode code={roomCode} />}
            <button type="button" className="mem-btn" onClick={leave}>{error ? 'Back to hub' : 'Cancel'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard({ name, score, active, me, you, difficulty }) {
  return (
    <div className={`mem-score ${me ? 'me' : ''} ${active ? 'active' : ''}`}>
      <span className="mem-avatar">{(name || '?').slice(0, 1).toUpperCase()}</span>
      <div className="mem-who">
        <span className="mem-name">
          {name}
          {you && <span className="mem-you">YOU</span>}
          {difficulty && <span className={`diff-tag diff-${difficulty}`}>{difficulty.toUpperCase()}</span>}
        </span>
        <span className="mem-pairs">{score} {score === 1 ? 'pair' : 'pairs'}</span>
      </div>
    </div>
  );
}

