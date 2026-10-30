/**
 * @file ChatAndWatchSection.jsx
 * @description Lobby sidebar supporting real-time public chat and live match spectating.
 */

import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import { navigate } from '../lib/router.js';
import { short } from '../lib/session.js';
import { ChatIcon, EyeIcon } from './Icons.jsx';
import { BOT_ADDRESS } from '../../../shared/constants.js';

const GAME_LABELS = {
  memory: 'Memory Match',
  'math-arena': 'Neon Math Arena',
  'connect-four': 'Connect Four',
  'cyber-blaster': 'Cyber Blaster Arena',
  'tic-tac-toe': 'Tic Tac Toe',
};

const PRESETS = [
  '👋 Hello!',
  '🎮 Duel anyone?',
  '👍 Good luck!',
  '⚡ GG!',
  '🏆 Great match!',
  '🔥 Rematch?',
];

export default function ChatAndWatchSection({ rooms, wallet, profile: _profile }) {
  const [tab, setTab] = useState('watch'); // 'watch' | 'chat'
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const logRef = useRef(null);

  const live = (rooms || [])
    .map((r) => ({
      ...r,
      humans: Object.entries(r.players || {}).filter(
        ([addr]) => addr.toLowerCase() !== BOT_ADDRESS.toLowerCase()
      ),
    }))
    .filter((r) => r.humans.length >= 2);

  useEffect(() => {
    const onHist = (list) => {
      if (Array.isArray(list)) setMessages(list);
    };
    const onMsg = (m) => {
      setMessages((prev) => [...prev, m]);
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
              <span className="cw-empty-icon" aria-hidden="true">
                🎯
              </span>
              <p className="side-empty">
                No player duels in progress right now. Start a match on the shelf or invite a friend
                to play!
              </p>
            </div>
          ) : (
            <ul className="live-list">
              {live.map((r) => (
                <li key={r.roomId} className="live-row">
                  <div className="live-info">
                    <span className="live-game">{GAME_LABELS[r.gameType] || r.gameType}</span>
                    <span className="live-players">
                      {r.humans.map(([addr, name]) => name || short(addr)).join(' vs ')}
                    </span>
                    <span className="live-watchers">{r.spectators || 0} watching</span>
                  </div>
                  <button type="button" className="live-watch" onClick={() => watchRoom(r)}>
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
                const timeStr =
                  m.t || m.time
                    ? new Date(m.t || m.time).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '';
                return (
                  <div key={idx} className={`lobby-msg ${isMe ? 'mine' : ''}`}>
                    <div className="lobby-msg-head">
                      <span className="lobby-msg-avatar">
                        {(m.from || '?').slice(0, 1).toUpperCase()}
                      </span>
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
            {PRESETS.map((preset) => (
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
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(text);
            }}
          >
            <input
              type="text"
              className="lobby-chat-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
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
