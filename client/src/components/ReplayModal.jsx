import { useEffect, useMemo, useState } from 'react';
import { API } from '../socket.js';
import { short } from '../lib/session.js';
import './replay-modal.css';

const TTT_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function buildTttReplay(replay, step) {
  const board = Array(9).fill(null);
  let winner = null;
  let winLine = null;
  for (const mv of replay.moves.slice(0, step)) {
    if (mv.index != null && mv.symbol) board[mv.index] = mv.symbol;
  }
  for (const line of TTT_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      winner = board[a];
      winLine = line;
    }
  }
  if (!winner && board.every(Boolean)) winner = 'draw';
  const turn = step % 2 === 0 ? 'X' : 'O';
  return { board, winner, winLine, turn };
}

function buildMemoryReplay(replay, step) {
  const layout = Array.isArray(replay.layout) ? replay.layout : [];
  const cards = layout.map((c) => ({
    pairId: c.pairId,
    content: c.content,
    matched: false,
    flipped: false,
  }));
  let turn = 'X';
  let flipped = [];
  const scores = { [replay.players?.X]: 0, [replay.players?.O]: 0 };

  for (const mv of (replay.moves || []).slice(0, step)) {
    const i = mv.index;
    if (cards[i]) {
      cards[i].flipped = true;
      flipped.push(i);
      if (flipped.length === 2) {
        const [a, b] = flipped;
        if (cards[a].pairId === cards[b].pairId) {
          cards[a].matched = cards[b].matched = true;
          scores[replay.players[turn]] = (scores[replay.players[turn]] || 0) + 1;
        } else {
          turn = turn === 'X' ? 'O' : 'X';
        }
        flipped = [];
      }
    }
  }
  return {
    cards,
    turn,
    scores,
    faceUp: flipped,
    winner: step >= (replay.moves?.length || 0) ? replay.result : null,
  };
}

export default function ReplayModal({ matchId, onClose }) {
  const [replay, setReplay] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`${API}/api/replay/${matchId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Replay not found');
        return r.json();
      })
      .then((d) => {
        if (active) {
          setReplay(d);
          setLoading(false);
          setStep(0);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [matchId]);

  const total = replay?.moves?.length || 0;

  useEffect(() => {
    if (!playing || total === 0) return;
    if (step >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => Math.min(s + 1, total)), 800);
    return () => clearTimeout(t);
  }, [playing, step, total]);

  const nameOf = (addr) => replay?.names?.[addr] || short(addr);

  const state = useMemo(() => {
    if (!replay) return null;
    if (replay.gameType === 'memory' && replay.layout) {
      return buildMemoryReplay(replay, step);
    }
    return buildTttReplay(replay, step);
  }, [replay, step]);

  const jump = (d) => {
    setPlaying(false);
    setStep((s) => Math.max(0, Math.min(total, s + d)));
  };

  const status = !state
    ? ''
    : state.winner
      ? state.winner === 'draw'
        ? "Match Result: It's a draw!"
        : `Winner: ${nameOf(replay?.players?.[state.winner] ?? '') || state.winner}`
      : `Move ${step}/${total} — ${nameOf(replay?.players?.[state.turn] ?? '')}'s turn`;

  return (
    <div className="replay-overlay" onClick={onClose}>
      <div className="replay-modal" onClick={(e) => e.stopPropagation()}>
        <div className="replay-modal-head">
          <div className="replay-head-title">
            <span className="replay-tag">▶ Replay Archive</span>
            <h3>Match {short(matchId)}</h3>
          </div>
          <button type="button" className="replay-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {loading && <div className="replay-loading">Loading verified match replay…</div>}
        {error && <div className="replay-error">{error}</div>}

        {!loading && !error && replay && (
          <div className="replay-body">
            <div className="replay-info-bar">
              <span className="replay-status">{status}</span>
              <span className="replay-badge-pill">
                {replay.gameType === 'memory'
                  ? '🧠 Memory'
                  : replay.gameType === 'math-arena'
                    ? '⚡ Math Arena'
                    : '⭕ Tic Tac Toe'}
                {replay.deck ? ` · ${replay.deck}` : ''}
              </span>
            </div>

            {replay.gameType === 'memory' && state?.cards ? (
              <div className="replay-memory-wrap">
                <div className="replay-score-row">
                  {Object.entries(state.scores || {}).map(([addr, s]) => (
                    <span
                      key={addr}
                      className={`replay-score-chip ${replay.players?.[state.turn] === addr ? 'active' : ''}`}
                    >
                      {nameOf(addr)}: <b>{s} pairs</b>
                    </span>
                  ))}
                </div>
                <div
                  className="replay-memory-grid"
                  style={{
                    gridTemplateColumns: `repeat(${state.cards.length <= 16 ? 4 : 5}, 1fr)`,
                  }}
                >
                  {state.cards.map((c, i) => (
                    <div
                      key={i}
                      className={`replay-card ${c.matched ? 'matched' : c.flipped ? 'flipped' : ''}`}
                    >
                      {c.matched || c.flipped ? c.content : '?'}
                    </div>
                  ))}
                </div>
              </div>
            ) : replay.gameType === 'tic-tac-toe' && state?.board ? (
              <div className="replay-ttt-wrap">
                <div className="replay-ttt-grid">
                  {state.board.map((cell, i) => (
                    <div
                      key={i}
                      className={`replay-ttt-cell ${cell?.toLowerCase() || ''} ${state.winLine?.includes(i) ? 'win' : ''}`}
                    >
                      {cell}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="replay-generic-list">
                <p className="generic-desc">
                  Recorded {replay.moves?.length || 0} moves for this duel:
                </p>
                <div className="replay-moves-scroll">
                  {replay.moves?.slice(0, step).map((m, idx) => (
                    <div key={idx} className="replay-move-row">
                      <span className="mv-idx">#{idx + 1}</span>
                      <span className="mv-addr">{nameOf(m.address)}</span>
                      <span className="mv-action">
                        {m.index != null ? `Tile/Col ${m.index}` : `Action`}
                      </span>
                      <span className="mv-time">{new Date(m.t).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="replay-control-dock">
              <button
                type="button"
                className="btn-replay-ctrl"
                onClick={() => jump(-total)}
                title="First Move"
              >
                ⏮
              </button>
              <button
                type="button"
                className="btn-replay-ctrl"
                onClick={() => jump(-1)}
                title="Step Back"
              >
                ⏪
              </button>
              <button
                type="button"
                className="btn-replay-play"
                onClick={() => {
                  if (step >= total) setStep(0);
                  setPlaying((p) => !p);
                }}
              >
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button
                type="button"
                className="btn-replay-ctrl"
                onClick={() => jump(1)}
                title="Step Forward"
              >
                ⏩
              </button>
              <button
                type="button"
                className="btn-replay-ctrl"
                onClick={() => jump(total)}
                title="Final Board"
              >
                ⏭
              </button>
              <span className="replay-step-count">
                {step} / {total} moves
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
