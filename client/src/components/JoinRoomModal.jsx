import { useEffect, useState } from 'react';
import './auth-modal.css';

const CODE_RE = /^[A-Z0-9]{5}$/;

// Asks for a friend's 5-character room code, then hands it to the caller.
export default function JoinRoomModal({ gameLabel, onJoin, onClose }) {
  const [code, setCode] = useState('');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit(e) {
    e.preventDefault();
    if (CODE_RE.test(code)) onJoin(code);
  }

  return (
    <div
      className="auth-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form className="auth-card join-card" onSubmit={submit}>
        <h3>Join a {gameLabel} room</h3>
        <p>Enter the 5-character code your friend shared.</p>
        <input
          className="room-input"
          value={code}
          onChange={(e) =>
            setCode(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 5)
            )
          }
          placeholder="K7QD2"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-label="Room code"
        />
        <div className="auth-actions">
          <button type="button" className="auth-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="auth-submit" disabled={!CODE_RE.test(code)}>
            Join room
          </button>
        </div>
      </form>
    </div>
  );
}
