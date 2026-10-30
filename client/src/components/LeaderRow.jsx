/**
 * @file LeaderRow.jsx
 * @description Single rank entry component in the Battle Arena Leaderboard.
 */

import { short } from '../lib/session.js';

export function LeaderRow({ player, me }) {
  return (
    <li className={`lb-row ${me ? 'me' : ''} ${player.rank <= 3 ? `top${player.rank}` : ''}`}>
      <span className="lb-rank">{player.rank}</span>
      <span className="lb-player">
        <span className="lb-avatar">{(player.name || '?').slice(0, 1).toUpperCase()}</span>
        <span className="lb-name" title={player.address}>
          {player.name || short(player.address)}
        </span>
      </span>
      <span className="lb-lv">{player.level || 1}</span>
      <span className="lb-w">{player.wins || 0}</span>
      <span className="lb-pts">{(player.tokens || 0).toLocaleString()}</span>
    </li>
  );
}
