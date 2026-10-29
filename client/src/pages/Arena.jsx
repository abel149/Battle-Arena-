import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { API, socket, signAndIdentify } from '../socket.js';
import { navigate, useRoute } from '../lib/router.js';
import { short, useProfile } from '../lib/session.js';
import RoomCode from '../components/RoomCode.jsx';
import MatchChat from '../components/MatchChat.jsx';
import './arena.css';

const ROUND_SECONDS = 10;

const TILES = [
  { key: 'A', cls: 'tile-a' },
  { key: 'B', cls: 'tile-b' },
  { key: 'C', cls: 'tile-c' },
  { key: 'D', cls: 'tile-d' },
];

const seatOf = (game, address) =>
  !game ? null : game.players.X === address ? 'X' : game.players.O === address ? 'O' : null;

const otherSeat = seat => (seat === 'X' ? 'O' : 'X');

export default function Arena() {
  const route = useRoute();
  const modeParam = route.params.get('mode');
  const mode = ['bot', 'create', 'join'].includes(modeParam) ? modeParam : 'match';
  const joinCode = (route.params.get('code') || '').toUpperCase();
  const rawDiff = route.params.get('difficulty');
  const initialDiff = ['easy', 'medium', 'hard'].includes(rawDiff) ? rawDiff : 'medium';
  const [difficulty, setDifficulty] = useState(initialDiff);
  const { wallet } = useProfile();

  const [room, setRoom] = useState(null);          // { roomId, names, gameType }
  const [game, setGame] = useState(null);
  const [queued, setQueued] = useState(false);
  const [roomCode, setRoomCode] = useState(null);  // private room code while waiting for a friend
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [tile, setTile] = useState(2);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [reveal, setReveal] = useState(null);      // previous round result
  const [tileRects, setTileRects] = useState([]);
  const [oppTile, setOppTile] = useState(3);      // where the rival last landed

  const sentRound = useRef(-1);
  const revealRound = useRef(-1);
  const tileRef = useRef(2);
  const tilesRef = useRef(null);
  const gameRef = useRef(null);
  const roomRef = useRef(null);
  const questionsByRound = useRef({});
  const wasRevealing = useRef(false);

  useEffect(() => { tileRef.current = tile; }, [tile]);
  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { roomRef.current = room; }, [room]);
  useEffect(() => {
    if (game?.question) questionsByRound.current[game.round] = game.question;
  }, [game?.round, game?.question]);

  const mySeat = seatOf(game, wallet.address);
  const oppSeat = mySeat ? otherSeat(mySeat) : null;
  const myName = room?.names?.[wallet.address] || 'You';
  const oppAddr = oppSeat && game ? game.players[oppSeat] : null;
  const oppName = oppAddr ? (room?.names?.[oppAddr] || short(oppAddr)) : 'Opponent';

  /* ------------------------------ connection ------------------------------ */
  useEffect(() => {
    async function start() {
      // Await the signed identify — queue:join must arrive after the server
      // has verified our wallet signature, or it is silently dropped.
      await signAndIdentify(wallet);
      if (mode === 'bot') socket.emit('match:bot', { gameType: 'math-arena', difficulty });
      else if (mode === 'create') socket.emit('room:create', { gameType: 'math-arena' });
      else if (mode === 'join') socket.emit('room:join', { code: joinCode });
      else {
        socket.emit('queue:join', { gameType: 'math-arena' });
        setQueued(true);
      }
    }
    if (socket.connected) start();
    else socket.once('connect', start);
    return () => socket.off('connect', start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, joinCode]);

  useEffect(() => {
    const onStart = data => {
      // Set the ref first: state updates are async, and game:state can arrive
      // before the render that would refresh roomRef.
      const next = { roomId: data.roomId, names: data.names || {}, gameType: data.gameType };
      roomRef.current = next;
      setRoom(next);
      setGame(data.game);
      setQueued(false);
      setRoomCode(null);
      setReceipt(null);
      setError(null);
      setOppTile(3);
      setTile(2);
      sentRound.current = -1;
      revealRound.current = -1;
      questionsByRound.current = {};
    };
    // Ignore traffic from any other room still open on this socket.
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

  // Bot, create and join answer within moments. Silence means the server is down
  // or still running old code — say so instead of spinning forever.
  useEffect(() => {
    if (mode === 'match' || game || roomCode || error) return;
    const id = setTimeout(() => setError(
      'The arena server did not respond. Restart it ("npm start" in the server folder) so it runs the latest code.'
    ), 6000);
    return () => clearTimeout(id);
  }, [mode, game, roomCode, error]);

  useEffect(() => {
    document.title = 'Neon Math Arena — Battle Arena';
    return () => { document.title = 'Battle Arena'; };
  }, []);

  /* -------------------------- layout measurements ------------------------- */
  useLayoutEffect(() => {
    const tilesEl = tilesRef.current;
    const host = tilesEl?.closest('.floor-pos');
    if (!tilesEl || !host) return;

    const measure = () => {
      const hostRect = host.getBoundingClientRect();
      const rects = [...tilesEl.querySelectorAll('.tile')].map(el => {
        const r = el.getBoundingClientRect();
        return {
          x: r.left - hostRect.left + r.width / 2,
          y: r.top - hostRect.top + r.height * 0.76,
          w: r.width,
        };
      });
      setTileRects(rects);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [game?.question]);

  /* -------------------------------- rounds -------------------------------- */
  // Reset position + clock for every new question.
  useEffect(() => {
    if (!game?.question) return;
    setTimeLeft(ROUND_SECONDS);
  }, [game?.round, game?.question]);

  // When the round result closes, both players return to their start tiles.
  useEffect(() => {
    if (reveal) { wasRevealing.current = true; return; }
    if (!wasRevealing.current) return;
    wasRevealing.current = false;
    setTile(2);
    tileRef.current = 2;
    setOppTile(3);
  }, [reveal]);

  // Show the previous round result for a moment before playing on.
  useEffect(() => {
    const last = game?.lastResult;
    if (!last || last.round === revealRound.current) return;
    revealRound.current = last.round;
    setReveal(last);
    const id = setTimeout(() => setReveal(null), 1900);
    return () => clearTimeout(id);
  }, [game?.lastResult]);

  // The server clears picks as soon as a round resolves, so the rival's tile is
  // read from the round result — otherwise P2 would never leave its start tile.
  useEffect(() => {
    const last = game?.lastResult;
    if (!last || !oppSeat) return;
    const pick = last.picks?.[oppSeat];
    if (Number.isInteger(pick)) setOppTile(pick);
  }, [game?.lastResult, oppSeat]);

  const locked = !!(game && mySeat && game.answered?.[mySeat]);

  const answer = useCallback(index => {
    const g = gameRef.current;
    const r = roomRef.current;
    const seat = seatOf(g, wallet.address);
    if (!g || !r || !seat || g.winner || g.answered?.[seat]) return;
    if (sentRound.current === g.round) return;
    sentRound.current = g.round;
    socket.emit('game:move', { roomId: r.roomId, index });
  }, [wallet.address]);

  // Countdown. When it reaches zero, the tile you stand on is locked in.
  // The clock lives in the interval itself, so a new round can never inherit a
  // leftover "0" and submit an instant timeout.
  const answerRef = useRef(answer);
  useEffect(() => { answerRef.current = answer; }, [answer]);

  useEffect(() => {
    if (!game?.question || game.winner || reveal) return;
    setTimeLeft(ROUND_SECONDS);
    let left = ROUND_SECONDS;
    const id = setInterval(() => {
      left -= 1;
      setTimeLeft(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        answerRef.current(tileRef.current);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [game?.round, game?.question, game?.winner, reveal]);

  function movePlayer(dir) {
    if (locked || !game?.question || game.winner || reveal) return;
    setTile(current => {
      const row = Math.floor(current / 2);
      const col = current % 2;
      let next = current;
      if (dir === 'up' && row > 0) next = current - 2;
      if (dir === 'down' && row < 1) next = current + 2;
      if (dir === 'left' && col > 0) next = current - 1;
      if (dir === 'right' && col < 1) next = current + 1;
      tileRef.current = next;
      return next;
    });
  }

  const lockPlayer = useCallback(() => {
    if (locked) return;
    answer(tile);
  }, [locked, answer, tile]);

  useEffect(() => {
    function onKey(event) {
      if (!game?.question || game.winner) return;
      const key = event.key.toLowerCase();
      const dirs = {
        w: 'up', arrowup: 'up',
        s: 'down', arrowdown: 'down',
        a: 'left', arrowleft: 'left',
        d: 'right', arrowright: 'right',
      };
      if (dirs[key]) {
        event.preventDefault();
        movePlayer(dirs[key]);
      } else if (key === ' ' || key === 'enter') {
        event.preventDefault();
        lockPlayer();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game?.question, game?.winner, lockPlayer]);

  function playAgain(diffOverride) {
    const nextDiff = diffOverride || difficulty;
    if (diffOverride && diffOverride !== difficulty) setDifficulty(diffOverride);
    sentRound.current = -1;
    revealRound.current = -1;
    setReceipt(null);
    setGame(null);
    setReveal(null);
    setRoom(null);
    roomRef.current = null;
    setOppTile(3);
    socket.emit('match:bot', { gameType: 'math-arena', difficulty: nextDiff });
  }

  function leave() {
    socket.emit('queue:leave');
    if (room?.roomId) socket.emit('match:leave', { roomId: room.roomId });
    navigate('hub');
  }

  const actorStyle = (tileIndex, side) => {
    const rect = tileRects[tileIndex];
    if (!rect) return { display: 'none' };
    const offset = rect.w * 0.16 * (side === 'p1' ? -1 : 1);
    return { left: `${rect.x + offset}px`, top: `${rect.y}px` };
  };

  const q = game?.question;
  // While the round result is showing, the server has already moved on to the
  // next question, so show the question that was actually just answered.
  const shownQ = (reveal && questionsByRound.current[reveal.round]) || q;
  const myScore = game && mySeat ? game.scores[mySeat] : 0;
  const oppScore = game && oppSeat ? game.scores[oppSeat] : 0;
  const myLives = game && mySeat ? game.lives[mySeat] : 3;
  const oppLives = game && oppSeat ? game.lives[oppSeat] : 3;
  // Show the rival on the tile it just locked (live in PvP, from the round
  // result against the bot) instead of leaving it parked on its start tile.
  const oppPickNow = game && oppSeat ? game.picks?.[oppSeat] : null;
  const oppTileShown = Number.isInteger(oppPickNow) ? oppPickNow : oppTile;

  return (
    <div className="arena-page">
      <div className="arena-shell">
        <div className="hud">
          <PlayerCard
            side="p1"
            name={myName}
            you
            score={myScore}
            lives={myLives}
            maxLives={game?.maxLives || 3}
          />
          <div className="timer-column">
            <TimerRing seconds={timeLeft} urgent={timeLeft <= 3 && !locked} />
            <div className="round-label">
              ROUND {(game?.round ?? 0) + 1} / {game?.totalRounds ?? 8}
            </div>
          </div>
          <PlayerCard
            side="p2"
            name={oppName}
            score={oppScore}
            lives={oppLives}
            maxLives={game?.maxLives || 3}
            difficulty={mode === 'bot' ? difficulty : null}
          />
        </div>

        <div className="question-wrap">
          <div className="question-inner">
            <span className={`question-side ${locked ? 'locked' : ''}`}>
              {locked ? 'LOCKED IN' : 'YOUR MOVE'}
            </span>
            <h1 className="question-text">{shownQ ? shownQ.text : 'Neon Math Arena'}</h1>
            <div className="round-dots" aria-hidden="true">
              {Array.from({ length: game?.totalRounds ?? 8 }).map((_, i) => (
                <span
                  key={i}
                  className={
                    i < (game?.round ?? 0) ? 'done' : i === (game?.round ?? 0) ? 'now' : ''
                  }
                />
              ))}
            </div>
          </div>
        </div>

        <div className="stage">
          <button
            type="button"
            className="quit-btn"
            onClick={leave}
            title="Leave this match and return to the hub"
          >
            ✕ Quit match
          </button>
          <div className="stage-banner left"><TrophyIcon /><span /></div>
          <div className="stage-banner right"><TrophyIcon /><span /></div>
          <div className="brazier left" />
          <div className="brazier right" />

          <div className="floor-pos">
            <div className="floor">
              <div className="floor-frame">
                <div className="tiles" ref={tilesRef}>
                  {TILES.map((t, i) => {
                    const isPick = tile === i;
                    const isCorrect = reveal ? i === reveal.correct : false;
                    const isMyMiss = reveal ? i === reveal.picks?.[mySeat] && i !== reveal.correct : false;
                    return (
                      <button
                        key={t.key}
                        type="button"
                        className={[
                          'tile', t.cls,
                          isPick && !locked ? 'selected' : '',
                          locked && isPick ? 'committed' : '',
                          isCorrect ? 'is-correct' : '',
                          isMyMiss ? 'is-miss' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => { if (!locked && !reveal) setTile(i); }}
                        aria-label={`Tile ${t.key}${shownQ ? `, answer ${shownQ.options[i]}` : ''}`}
                      >
                        <span className="tile-letter">{t.key}</span>
                        {shownQ && <span className="tile-value">{shownQ.options[i]}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            
            <div className="actor-layer">
              <div className="actor p1" style={actorStyle(tile, 'p1')}>
                <div className="actor-tag p1">P1</div>
                <Fighter side="p1" />
                <div className="actor-foot p1" />
              </div>
              <div className="actor p2" style={actorStyle(oppTileShown, 'p2')}>
                <div className="actor-tag p2">P2</div>
                <Fighter side="p2" />
                <div className="actor-foot p2" />
              </div>
            </div>
          </div>

          <div className="stage-hint">
            <span className={`hint-pill ${locked ? 'on' : ''}`}>
              {game?.winner
                ? 'Match complete'
                : locked
                  ? 'Answer locked — waiting for your rival'
                  : 'Move with WASD, then lock in the tile you stand on'}
            </span>
          </div>

          {error && <div className="arena-toast">{error}</div>}

          {reveal && q && (
            <RoundResult
              result={reveal}
              question={shownQ}
              mySeat={mySeat}
              myName={myName}
              oppName={oppName}
            />
          )}

          {receipt && game && (
            <MatchResult
              game={game}
              mySeat={mySeat}
              myName={myName}
              oppName={oppName}
              receipt={receipt}
              onPlayAgain={() => playAgain(difficulty)}
              canRematch={mode === 'bot'}
              difficulty={difficulty}
              onSelectDifficulty={setDifficulty}
              onLeave={leave}
            />
          )}
        </div>

        {mode !== 'bot' && room?.roomId && (
          <MatchChat roomId={room.roomId} myAddress={wallet.address} />
        )}

        <div className="control-bar">
          <div className="control-group">
            <div className="key-cluster">
              <span className="keycap">W</span>
              <div>
                <span className="keycap">A</span>
                <span className="keycap">S</span>
                <span className="keycap">D</span>
              </div>
            </div>
            <span className="control-text">WASD to move</span>
          </div>
          <div className="control-divider" />
          <div className="control-group">
            <div className="key-cluster arrows">
              <span className="keycap">↑</span>
              <div>
                <span className="keycap">←</span>
                <span className="keycap">↓</span>
                <span className="keycap">→</span>
              </div>
            </div>
            <span className="control-text">or arrow keys</span>
          </div>
          <div className="control-divider" />
          <button
            type="button"
            className="lock-btn"
            onClick={lockPlayer}
            disabled={!q || locked || !!game?.winner}
            title="Locks the tile you are standing on as your answer for this round"
          >
            {locked ? 'Locked in' : 'Lock answer'} <span className="keycap wide">Space</span>
          </button>
        </div>
      </div>

      {!game && (
        <Waiting
          mode={mode}
          code={roomCode}
          error={error}
          onCancel={leave}
        />
      )}
    </div>
  );
}

/* ------------------------------- components ------------------------------ */

const WAITING_COPY = {
  bot: ['Warming up the bot', 'Your rival is stepping onto the arena floor…'],
  create: ['Room ready', 'Share this code with a friend — the match starts as soon as they join.'],
  join: ['Joining room', 'Connecting you to your friend’s room…'],
  match: ['Finding an opponent', 'Waiting for another player to join Neon Math Arena. Open the arena in a second window to test.'],
};

function Waiting({ mode, code, error, onCancel }) {
  const [title, text] = WAITING_COPY[mode] || WAITING_COPY.match;
  return (
    <div className="waiting-overlay">
      <div className="waiting-card">
        <div className="waiting-spinner" aria-hidden="true" />
        <h2>{error ? 'Match error' : title}</h2>
        <p>{error || text}</p>
        {!error && mode === 'create' && code && <RoomCode code={code} />}
        <button type="button" className="lock-btn" onClick={onCancel}>{error ? 'Back to hub' : 'Cancel'}</button>
      </div>
    </div>
  );
}

function PlayerCard({ side, name, score, lives, maxLives, you, difficulty }) {
  return (
    <div className={`player-card ${side}`}>
      <div className="player-avatar">
        <Fighter side={side} />
      </div>
      <div className="player-info">
        <div className="p-name">
          {name}
          {you && <span className="you-tag">YOU</span>}
          {difficulty && <span className={`diff-tag diff-${difficulty}`}>{difficulty.toUpperCase()}</span>}
        </div>
        <div className="p-score">
          <span className="star">★</span> {score}
        </div>
        <div className="hearts" aria-label={`${lives} lives left`}>
          {Array.from({ length: maxLives }).map((_, i) => (
            <span key={i} className={`heart ${i >= lives ? 'lost' : ''}`}>
              <HeartIcon />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function TimerRing({ seconds, urgent }) {
  const progress = Math.max(0, Math.min(1, seconds / ROUND_SECONDS));
  return (
    <div
      className={`timer ${urgent ? 'urgent' : ''}`}
      style={{ '--progress': progress }}
      role="timer"
      aria-live="off"
    >
      <div className="timer-inner">
        <span className="timer-label">Time Left</span>
        <span className="timer-value">{seconds}</span>
      </div>
    </div>
  );
}

function RoundResult({ result, question, mySeat, myName, oppName }) {
  const mine = result.picks?.[mySeat];
  const theirs = result.picks?.[mySeat === 'X' ? 'O' : 'X'];
  const mineOk = mine === result.correct;
  const theirsOk = theirs === result.correct;
  return (
    <div className="round-overlay">
      <div className={`round-card ${mineOk ? 'ok' : 'bad'}`}>
        <div className="round-check">{mineOk ? '✓' : '✕'}</div>
        <h2 className="round-title">{mineOk ? 'Correct!' : 'Not quite!'}</h2>
        <div className="round-players">
          <div className={`res-pill p1 ${mineOk ? 'good' : 'bad'}`}>
            <span className="res-name">{myName}{question && mine !== null ? ` · chose ${question.options[mine]}` : ''}</span>
            <span className="res-value">{mineOk ? '+20 Points' : mine === null ? 'No answer' : '−1 Life'}</span>
          </div>
          <div className={`res-pill p2 ${theirsOk ? 'good' : 'bad'}`}>
            <span className="res-name">{oppName}{question && theirs !== null ? ` · chose ${question.options[theirs]}` : ''}</span>            <span className="res-value">{theirsOk ? '+20 Points' : theirs === null ? 'No answer' : '−1 Life'}</span>
          </div>
        </div>
        {question && (
          <div className="round-next">Correct answer: {question.options[result.correct]}</div>
        )}
        <div className="round-next">Next question coming up…</div>
      </div>
    </div>
  );
}

function MatchResult({ game, mySeat, myName, oppName, receipt, onPlayAgain, canRematch, onLeave, difficulty, onSelectDifficulty }) {
  const winner = game.winner;
  const iWon = winner === mySeat;
  const draw = winner === 'draw';
  const myScore = game.scores?.[mySeat] ?? 0;
  const oppScore = game.scores?.[mySeat === 'X' ? 'O' : 'X'] ?? 0;

  return (
    <div className="match-overlay">
      <div className={`final-card ${iWon ? 'p1' : draw ? 'draw' : 'p2'}`}>
        <div className="final-trophy"><TrophyIcon /></div>
        <div className="final-eyebrow">Match over</div>
        <h2>{draw ? 'It’s a draw!' : iWon ? `${myName} wins!` : `${oppName} wins!`}</h2>
        <div className="final-score">
          <span className="p1">{myScore}</span>
          <span className="vs">FINAL</span>
          <span className="p2">{oppScore}</span>
        </div>
        {receipt && (
          <a
            className="receipt-link"
            href={`${API}/api/verify/${receipt.matchId}`}
            target="_blank"
            rel="noreferrer"
            title={`Verify ${receipt.matchId}`}
          >
            ⛓ On-chain: {short(receipt.txHash || receipt.matchId)}
          </a>
        )}
        {canRematch && onSelectDifficulty && (
          <div className="rematch-difficulty">
            <span className="diff-title">🤖 Bot Level:</span>
            <div className="diff-selector" role="radiogroup" aria-label="Bot Difficulty">
              {['easy', 'medium', 'hard'].map(lvl => (
                <button
                  key={lvl}
                  type="button"
                  className={`diff-chip ${difficulty === lvl ? 'active' : ''} diff-${lvl}`}
                  onClick={() => onSelectDifficulty(lvl)}
                >
                  {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="final-actions">
          {canRematch && (
            <button type="button" className="lock-btn" onClick={onPlayAgain}>Play again</button>
          )}
          <button type="button" className="lock-btn ghost" onClick={onLeave}>Back to hub</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------- art ---------------------------------- */

function Fighter({ side }) {
  const blue = side === 'p1';
  const skin = blue ? '#f6c7a2' : '#f2bb95';
  const hair = blue ? '#1b2436' : '#2a1622';
  const jersey = blue ? '#2f6fe8' : '#d92a4c';
  const jerseyDark = blue ? '#1b4bb0' : '#a11534';
  return (
    <svg className="fighter-svg" viewBox="0 0 120 144" role="presentation" aria-hidden="true">
      <ellipse cx="60" cy="137" rx="27" ry="5.5" fill="rgba(0,0,0,.55)" />
      <path d="M47 100 L42 129 L55 129 L58 102 Z" fill="#101a2e" />
      <path d="M63 100 L66 129 L79 129 L73 101 Z" fill="#0b1426" />
      <ellipse cx="48" cy="130" rx="11" ry="5.5" fill={blue ? '#dbe9ff' : '#ffe0e6'} />
      <ellipse cx="72" cy="130" rx="11" ry="5.5" fill={blue ? '#c8dcf8' : '#ffccd6'} />
      <path d="M35 70 Q24 78 28 96 L38 96 L44 78 Z" fill={jerseyDark} stroke="#0a1224" strokeWidth="3" strokeLinejoin="round" />
      <path d="M85 70 Q96 78 92 96 L82 96 L76 78 Z" fill={jerseyDark} stroke="#0a1224" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="33" cy="99" r="6.5" fill={skin} stroke="#0a1224" strokeWidth="2.5" />
      <circle cx="87" cy="99" r="6.5" fill={skin} stroke="#0a1224" strokeWidth="2.5" />
      <path
        d="M35 72 Q35 53 60 51 Q85 53 85 72 L88 106 Q60 117 32 106 Z"
        fill={jersey}
        stroke="#0a1224"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M60 53 L60 108" stroke="rgba(255,255,255,.35)" strokeWidth="2" />
      <path d="M43 82 Q50 88 50 101" stroke="rgba(255,255,255,.28)" strokeWidth="2" fill="none" />
      <path d="M50 53 Q60 63 70 53" stroke="#0a1224" strokeWidth="3" fill="none" />
      <circle cx="60" cy="36" r="23" fill={skin} stroke="#0a1224" strokeWidth="3" />
      <circle cx="37" cy="38" r="4.5" fill={skin} stroke="#0a1224" strokeWidth="2.5" />
      <circle cx="83" cy="38" r="4.5" fill={skin} stroke="#0a1224" strokeWidth="2.5" />
      {blue ? (
        <path
          d="M37 35 Q35 10 60 9 Q85 10 83 35 Q79 24 67 22 Q50 19 42 30 Z"
          fill={hair}
          stroke="#0a1224"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <path
            d="M37 36 Q34 9 60 9 Q86 9 83 36 Q80 23 64 21 Q48 20 41 33 Z"
            fill={hair}
            stroke="#0a1224"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M82 27 Q101 33 96 55 Q92 62 88 51 Q87 40 79 36 Z"
            fill={hair}
            stroke="#0a1224"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="84" cy="27" r="6" fill="#ff4d6d" stroke="#0a1224" strokeWidth="2" />
        </>
      )}
      <circle cx="51" cy="38" r="3.6" fill="#101827" />
      <circle cx="69" cy="38" r="3.6" fill="#101827" />
      <circle cx="52.2" cy="36.8" r="1.2" fill="#fff" />
      <circle cx="70.2" cy="36.8" r="1.2" fill="#fff" />
      <path d="M54 47 Q60 53 66 47" stroke="#8c3a35" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="45" cy="45" r="3.5" fill="rgba(255,120,120,.25)" />
      <circle cx="75" cy="45" r="3.5" fill="rgba(255,120,120,.25)" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-8.5-5.2-8.5-11A4.8 4.8 0 0 1 12 6.6 4.8 4.8 0 0 1 20.5 10c0 5.8-8.5 11-8.5 11Z" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path
        d="M15 6h18v4h7v6c0 6-4.6 10.5-10 10.9V31h5v5H13v-5h5v-4.1C12.6 26.5 8 22 8 16V10h7V6Zm0 9H12v1c0 3.7 1.9 6.6 5 7.8V15h-2Zm18 0h-2v8.8c3.1-1.2 5-4.1 5-7.8v-1h-3ZM19 36h12v6H19v-6Z"
        fill="currentColor"
      />
    </svg>
  );
}
