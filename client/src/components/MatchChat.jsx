import { useEffect, useRef, useState } from 'react';
import { socket } from '../socket.js';
import './match-chat.css';

const PRESETS = ['Good luck!', 'Nice one!', 'Well played!', 'Thanks!', 'Rematch?', 'Oops!'];
const COOLDOWN_MS = 1500; // the server has no rate limit, so slow spamming down here
const KEEP = 4; // how many recent messages stay on screen

export default function MatchChat({ roomId, myAddress }) {
  const [messages, setMessages] = useState([]);
  const [cooling, setCooling] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    setMessages([]);
    // The server sends chat to everyone in the room, including the sender.
    const onMessage = (msg) => setMessages((list) => [...list.slice(-(KEEP - 1)), msg]);
    socket.on('chat:message', onMessage);
    return () => socket.off('chat:message', onMessage);
  }, [roomId]);

  useEffect(() => () => clearTimeout(timer.current), []);

  function send(text) {
    if (cooling || !roomId) return;
    socket.emit('chat:send', { roomId, text });
    setCooling(true);
    timer.current = setTimeout(() => setCooling(false), COOLDOWN_MS);
  }

  return (
    <div className="match-chat">
      <div className="match-chat-log" aria-live="polite">
        {messages.length === 0 ? (
          <span className="mc-empty">Send a quick message to your rival</span>
        ) : (
          messages.map((m, i) => {
            const mine = m.address === myAddress;
            return (
              <div key={`${m.t}-${i}`} className={`mc-msg ${mine ? 'me' : ''}`}>
                <b>{mine ? 'You' : m.from}</b> {m.text}
              </div>
            );
          })
        )}
      </div>
      <div className="match-chat-presets">
        {PRESETS.map((p) => (
          <button key={p} type="button" disabled={cooling} onClick={() => send(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
