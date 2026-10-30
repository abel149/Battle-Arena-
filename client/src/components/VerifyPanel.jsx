import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { API } from '../socket.js';
import { short } from '../lib/session.js';
import './chain.css';

function CopyRow({ label, value, href }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked — ignore */ }
  };
  return (
    <div className="vp-row">
      <span className="vp-label">{label}</span>
      <span className="vp-value mono" title={value}>{short(value)}</span>
      {href && <a className="vp-mini" href={href} target="_blank" rel="noreferrer">Explorer ↗</a>}
      <button type="button" className="vp-mini" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

/** Modal that checks a match against the server's ledger (the chain when on-chain). */
export default function VerifyPanel({ matchId, status, onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fetch(`${API}/api/verify/${encodeURIComponent(matchId)}`)
      .then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }) => {
        if (!alive) return;
        setState(ok && body.valid ? { entry: body.entry } : { notFound: true, error: body.error });
      })
      .catch(() => alive && setState({ error: 'Could not reach the arena server.' }));
    return () => { alive = false; };
  }, [matchId]);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entry = state.entry;
  const real = !!status?.onchain && !status?.error;
  const explorer = entry?.txHash && status?.explorerTx ? `${status.explorerTx}${entry.txHash}` : null;
  const winner = !entry ? '' : entry.winner === 'draw' ? 'Draw' : entry.winner;

  return createPortal(
    <div className="vp-backdrop" onClick={onClose} role="presentation">
      <div className="vp-card" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Verify match">
        <button type="button" className="vp-close" onClick={onClose} aria-label="Close">✕</button>
        <h3 className="vp-title">Match verification</h3>

        {state.loading && <p className="vp-note">Checking the ledger…</p>}

        {state.notFound && (
          <div className="vp-status bad">✕ Not found in the ledger yet. The transaction may still be confirming — try again in a few seconds.</div>
        )}
        {state.error && !state.notFound && <div className="vp-status bad">✕ {state.error}</div>}

        {entry && (
          <>
            <div className={`vp-status ${real ? 'good' : 'sim'}`}>
              {real
                ? `✓ Verified on ${status.network}`
                : '🧪 Found in the simulated ledger (no real blockchain)'}
            </div>
            <CopyRow label="Match ID" value={entry.matchId} />
            <div className="vp-row">
              <span className="vp-label">Game</span>
              <span className="vp-value">{entry.gameType}</span>
            </div>
            <CopyRow label="Winner" value={winner === 'Draw' ? '' : winner} />
            {winner === 'Draw' && (
              <div className="vp-row"><span className="vp-label">Winner</span><span className="vp-value">Draw</span></div>
            )}
            <CopyRow label="Player 1" value={entry.players?.X} />
            <CopyRow label="Player 2" value={entry.players?.O} />
            {Number.isFinite(entry.moves) && (
              <div className="vp-row"><span className="vp-label">Moves</span><span className="vp-value">{entry.moves}</span></div>
            )}
            <div className="vp-row">
              <span className="vp-label">Time</span>
              <span className="vp-value">
                {new Date(entry.timestamp < 1e12 ? entry.timestamp * 1000 : entry.timestamp).toLocaleString()}
              </span>
            </div>
            <CopyRow label="Result hash" value={entry.resultHash} />
            <CopyRow label="Tx hash" value={entry.txHash} href={explorer} />
            {real && !explorer && (
              <p className="vp-note">
                This is a local chain, so there is no block explorer. The data above was read straight from the
                MatchResult contract{status.contract ? ` at ${short(status.contract)}` : ''}.
              </p>
            )}
            {!real && (
              <p className="vp-note">
                The tx hash is generated locally. Start the server with <code>npm start</code> to record on a real chain.
              </p>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
