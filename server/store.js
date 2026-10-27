// Player profiles, stats, badges, and ARENA token balances.
// Persisted to data.json — swap for a DB later if needed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data.json');

let data = { players: {} };
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch {
  data = { players: {} };
}

function persist() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

export function upsertPlayer(address, name) {
  const p = data.players[address] || {
    address,
    name: name || 'Player-' + address.slice(2, 8),
    wins: 0,
    losses: 0,
    draws: 0,
    matches: 0,
    tokens: 0,      // ARENA reward tokens
    xp: 0,
    level: 1,
    streak: 0,      // current win streak
    bestStreak: 0,
    memoryWins: 0,
    deckStats: {},  // per educational deck: { wins, matches }
    badges: [],
  };
  // Backfill fields for players created before this version
  p.xp ??= 0;
  p.level ??= 1;
  p.streak ??= 0;
  p.bestStreak ??= 0;
  p.memoryWins ??= 0;
  p.deckStats ??= {};
  if (name) p.name = name;
  data.players[address] = p;
  persist();
  return p;
}

export function getPlayer(address) {
  return data.players[address] || null;
}

const BADGE_DEFS = [
  { id: 'first_blood', label: 'First Blood', desc: 'Win your first match',   check: p => p.wins >= 1 },
  { id: 'hat_trick',   label: 'Hat Trick',   desc: 'Win 3 matches',          check: p => p.wins >= 3 },
  { id: 'veteran',     label: 'Arena Veteran', desc: 'Play 10 matches',      check: p => p.matches >= 10 },
  { id: 'whale',       label: 'Token Whale', desc: 'Hold 100 ARENA tokens',  check: p => p.tokens >= 100 },
  { id: 'streak_3',    label: 'On Fire',     desc: 'Win 3 matches in a row', check: p => p.bestStreak >= 3 },
  { id: 'level_5',     label: 'Rising Star', desc: 'Reach level 5',          check: p => p.level >= 5 },
  // Learning badges — tied to educational Memory Match decks
  { id: 'flag_master', label: 'Flag Master', desc: 'Win 3 Flag deck matches',
    check: p => (p.deckStats?.flags?.wins || 0) >= 3 },
  { id: 'math_whiz',   label: 'Math Whiz',   desc: 'Win 3 Math deck matches',
    check: p => (p.deckStats?.math?.wins || 0) >= 3 },
  { id: 'polyglot',    label: 'Polyglot',    desc: 'Win 3 Kiswahili deck matches',
    check: p => (p.deckStats?.swahili?.wins || 0) >= 3 },
  { id: 'memory_king', label: 'Memory King', desc: 'Win 10 Memory matches',
    check: p => p.memoryWins >= 10 },
];

export function levelFor(xp) {
  return Math.floor(xp / 100) + 1; // level up every 100 XP
}

// Result from the perspective of `address`: 'win' | 'loss' | 'draw'
// ctx: { gameType, deck } — optional, used for learning stats/badges
export function applyResult(address, result, ctx = {}) {
  const p = upsertPlayer(address);
  p.matches += 1;
  if (result === 'win')  { p.wins += 1;   p.tokens += 10; p.xp += 50; p.streak += 1; }
  if (result === 'draw') { p.draws += 1;  p.tokens += 3;  p.xp += 20; p.streak = 0; }
  if (result === 'loss') { p.losses += 1; p.tokens += 1;  p.xp += 10; p.streak = 0; }
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  if (ctx.daily) p.xp += 15; // Daily Challenge deck bonus
  p.level = levelFor(p.xp);

  // Track per-deck learning stats for Memory Match
  if (ctx.gameType === 'memory' && ctx.deck) {
    p.memoryWins += result === 'win' ? 1 : 0;
    const d = (p.deckStats[ctx.deck] ||= { wins: 0, matches: 0 });
    d.matches += 1;
    if (result === 'win') d.wins += 1;
  }

  // Award any newly-earned badges
  const owned = new Set(p.badges.map(b => b.id));
  for (const def of BADGE_DEFS) {
    if (!owned.has(def.id) && def.check(p)) {
      p.badges.push({ id: def.id, label: def.label, desc: def.desc, awardedAt: Date.now() });
    }
  }
  persist();
  return p;
}

export function leaderboard() {
  return Object.values(data.players)
    .sort((a, b) => b.tokens - a.tokens || b.wins - a.wins)
    .map((p, i) => ({ rank: i + 1, ...p }));
}
