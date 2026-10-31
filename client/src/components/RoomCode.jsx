import { useState } from 'react';

// Big copyable room code shown to a host who is waiting for a friend.
export default function RoomCode({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };
  return (
    <div className="room-code-box">
      <span className="room-code" aria-label={`Room code ${code.split('').join(' ')}`}>
        {code}
      </span>
      <button type="button" className="room-copy" onClick={copy}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
