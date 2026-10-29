import { useCallback, useEffect, useRef, useState } from 'react';
import { API, socket } from '../socket.js';
import { navigate, useRoute } from '../lib/router.js';
import { short, useProfile } from '../lib/session.js';
import './memory.css';

export default function MemoryMatch() {
  const route = useRoute();
  const mode = route.params.get('mode') === 'bot' ? 'bot' : 'match';
  const deck = route.params.get('deck') || 'flags';
  const { wallet } = useProfile();

  const [room, setRoom] = useState(null);
  const [game, setGame] = useState(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [deckLabel, setDeckLabel] = useState('Educational decks');

  const roomRef = useRef(null);
  useEffect(() => { roomRef.current = room; }, [room]);

  useEffect(() => {
    function start() {
      socket.emit('identify', wallet);
      if (mode === 'bot') socket.emit('match:bot', { gameType: 'memory', deck });
      else {
        socket.emit('queue:join', { gameType: 'memory' });
        setQueued(true);
      }
    }
    if (socket.connected) start();
    else socket.once('connect', start);
    return () => socket.off('connect', start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, deck]);

  useEffect(() => {
    const onStart = data => {
      const next = { roomId: data.roomId, names: data.names || {} };
      roomRef.current = next;
      setRoom(next);
      setGame(data.game);
      setQueued(false);
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
    const onError = msg => setError(msg);

    socket.on('match:start', onStart);
    socket.on('game:state', onState);
    socket.on('match:end', onEnd);
    socket.on('queue:waiting', onWaiting);
    socket.on('game:error', onError);

    return () => {
      socket.off('match:start', onStart);
      socket.off('game:state', onState);
      socket.off('match:end', onEnd);
      socket.off('queue:waiting', onWaiting);
      socket.off('game:error', onError);
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

  useEffect(() => {
    document.title = 'Memory Match — Battle Arena';
    return () => { document.title = 'Battle Arena'; };
  }, []);

  const mySeat = game ? (game.players.X === wallet.address ? 'X' : game.players.O === wallet.address ? 'O' : null) : null;
  const oppSeat = mySeat === 'X' ? 'O' : 'X';
  const myName = mode === 'bot' ? 'You' : (room?.names?.[wallet.address] || 'You');
  const oppAddr = game ? game.players[oppSeat] : null;
  const oppName = room?.names?.[oppAddr] || (oppAddr ? short(oppAddr) : 'Opponent');
  const myTurn = !!game && !game.winner && game.players[game.turn] === wallet.address;
  // Memory scores are keyed by wallet address, not by seat.
  const myScore = game ? game.scores?.[wallet.address] ?? 0 : 0;
  const oppScore = game && oppAddr ? game.scores?.[oppAddr] ?? 0 : 0;

  const flip = useCallback(index => {
    const r = roomRef.current;
    if (!r?.roomId) return;
    socket.emit('game:move', { roomId: r.roomId, index });
  }, []);

  function playAgain() {
    setGame(null);
    setRoom(null);
    setReceipt(null);
    socket.emit('match:bot', { gameType: 'memory', deck });
  }

  function leave() {
    socket.emit('queue:leave');
    if (room?.roomId) socket.emit('match:leave', { roomId: room.roomId });
    navigate('hub');
  }

  const iWon = receipt && receipt.winner === wallet.address;
  const isDraw = receipt && !receipt.winner;

  return (
    <div className="mem-page">
      <header className="mem-top">
        <a className="mem-back" href="#hub">← Lobby</a>
        <h1 className="mem-title">Memory Match</h1>
        <span className="mem-deck">{deckLabel}</span>
      </header>

      <div className="mem-arena">
        <div className="mem-scores">
          <ScoreCard name={myName} score={myScore} me active={myTurn} you />
          <div className="mem-status">
            {receipt
              ? isDraw ? 'Draw' : iWon ? 'Victory' : 'Defeat'
              : myTurn ? 'Your turn' : `${oppName}'s turn`}
          </div>
          <ScoreCard name={oppName} score={oppScore} active={!!game && !myTurn && !game.winner} />
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
                  disabled={!myTurn || card.matched || card.flipped || game.locked || !!game.winner}
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
                      ? 'Flip two cards — a matching pair scores and keeps your turn.'
                      : 'Waiting for your rival to flip…'}
              </span>
              {game.moveCount !== undefined && (
                <span className="mem-moves">{game.moveCount} flips</span>
              )}
            </div>
          </>
        )}

        {error && <div className="mem-error">{error}</div>}

        {receipt && (
          <div className={`mem-result ${iWon ? 'win' : isDraw ? 'draw' : 'loss'}`}>
            <div className="mem-result-head">
              <span className="mem-result-icon">{iWon ? '🏆' : isDraw ? '🤝' : '⚔️'}</span>
              <div>
                <h2>{isDraw ? 'It’s a draw!' : iWon ? 'You win!' : 'You lose this one'}</h2>
                <p>
                  {myScore} : {oppScore} pairs
                  {receipt.gameType ? ` · ${receipt.gameType}` : ''}
                </p>
              </div>
            </div>
            <div className="mem-result-actions">
              <a
                className="mem-btn ghost"
                href={`${API}/api/verify/${receipt.matchId}`}
                target="_blank"
                rel="noreferrer"
              >
                ⛓ {short(receipt.txHash || receipt.matchId)}
              </a>
              {mode === 'bot' && (
                <button type="button" className="mem-btn" onClick={playAgain}>Play again</button>
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
            <h2>{error ? 'Match error' : mode === 'bot' ? 'Shuffling the deck' : 'Finding an opponent'}</h2>
            <p>
              {error ||
                (mode === 'bot'
                  ? 'The bot is taking its seat across the table…'
                  : 'Waiting for another player to join Memory Match. Open a second window to play against yourself.')}
            </p>
            <button type="button" className="mem-btn" onClick={leave}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard({ name, score, active, me, you }) {
  return (
    <div className={`mem-score ${me ? 'me' : ''} ${active ? 'active' : ''}`}>
      <span className="mem-avatar">{(name || '?').slice(0, 1).toUpperCase()}</span>
      <div className="mem-who">
        <span className="mem-name">{name}{you && <span className="mem-you">YOU</span>}</span>
        <span className="mem-pairs">{score} {score === 1 ? 'pair' : 'pairs'}</span>
      </div>
    </div>
  );
}

