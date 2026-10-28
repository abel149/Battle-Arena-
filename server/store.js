// Player profiles, stats, badges, and ARENA token balances.
// Persisted to data.json — swap for a DB later if needed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';

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

function createPlayer(address, name) {
  return {
    address,
    name: name || 'Player-' + address.slice(2, 8),
    wins: 0,
    losses: 0,
    draws: 0,
    matches: 0,
    tokens: 0,
    xp: 0,
    level: 1,
    streak: 0,
    bestStreak: 0,
    memoryWins: 0,
    deckStats: {},
    badges: [],
  };
}

export function upsertPlayer(address, name) {
  let p = data.players[address];
  if (!p) {
    p = createPlayer(address, name);
  }
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

const USERNAME_KEY = 'arena_usernames'; // global username -> address index

function usernameIndex() {
  let idx = data[USERNAME_KEY];
  const anyPlayers = Object.keys(data.players).length > 0;
  if (!idx || Object.keys(idx).length === 0) {
    idx = {};
    for (const p of Object.values(data.players)) {
      if (p.username) idx[p.username.toLowerCase()] = p.address;
    }
    data[USERNAME_KEY] = idx;
  }
  return idx;
}

function persistUsernameIndex() {
  // Rebuild from scratch so newly registered usernames are picked up.
  const idx = {};
  for (const p of Object.values(data.players)) {
    if (p.username) idx[p.username.toLowerCase()] = p.address;
  }
  data[USERNAME_KEY] = idx;
  persist();
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const PASSWORD_MIN = 8;

/** Shared validation for usernames (client mirrors this). */
export function validateUsername(username) {
  if (!username || !username.trim()) return 'Username is required';
  const n = username.trim();
  if (!USERNAME_RE.test(n)) return 'Username must be 3–20 letters, numbers, or underscores.';
  return null;
}

/** Validate a password for registration. */
export function validatePassword(password) {
  if (!password) return 'Password is required';
  if (password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  return null;
}

/** Hash a password for storage. */
export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

/** Verify a password against a stored hash. */
export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

/** Register a new player identity. `address` is the wallet id (unique key).
 *  `username` must be globally unique (case-insensitive) and 3–20 chars
 *  of [a-zA-Z0-9_]. `password` is required (min 8 chars). `email` optional.
 *  Returns the created profile, or { error, conflict } on failure.
 */
export async function registerPlayer(address, { name, username, email, password } = {}) {
  const usernameErr = validateUsername(username);
  if (usernameErr) return { error: usernameErr };
  const passwordErr = validatePassword(password);
  if (passwordErr) return { error: passwordErr };
  const existingPlayer = data.players[address];
  if (existingPlayer?.registered) {
    return { error: 'A player with this wallet already exists' };
  }
  if (!username || !username.trim()) {
    return { error: 'Username is required' };
  }
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_RE.test(normalized)) {
    return { error: 'Username must be 3–20 letters, numbers, or underscores.' };
  }
  const existing = usernameIndex()[normalized];
  if (existing) {
    return { error: 'Username already taken', conflict: existing };
  }
  const displayName = name && name.trim() ? name.trim() : normalized;
  const passwordHash = password ? await hashPassword(password) : null;
  const profile = {
    ...(existingPlayer || createPlayer(address, displayName)),
    address,
    name: displayName,
    username: normalized,
    email: email && email.trim() ? email.trim().toLowerCase() : null,
    password: passwordHash,
    registered: true,
  };
  data.players[address] = profile;
  persistUsernameIndex();
  return profile;
}

/** Log in a registered player by username + password.
 *  The wallet address is resolved from the username index.
 *  Returns the profile, or { error } on failure.
 */
export async function loginPlayerByCredentials({ username, password } = {}) {
  const usernameErr = validateUsername(username);
  if (usernameErr) return { error: usernameErr };
  const passwordErr = validatePassword(password);
  if (passwordErr) return { error: passwordErr };
  const normalized = username.trim().toLowerCase();
  const idx = usernameIndex();
  const address = idx[normalized];
  if (!address) return { error: 'Unknown username', debug: { normalized, hasIdx: !!idx, idxKeys: idx ? Object.keys(idx) : null } };
  const p = data.players[address];
  if (!p || !p.password) return { error: 'No password set for this account' };
  const ok = await verifyPassword(password, p.password);
  if (!ok) return { error: 'Incorrect password' };
  return p;
}

/** Log in / claim an existing wallet as a registered identity.
 *  If the wallet already has a registered profile, this is a no-op lookup.
 *  If the wallet is unregistered, a username can be provided to claim it.
 *  Returns the profile, or { error } on failure.
 */
export async function loginPlayer(address, { username, name, password } = {}) {
  let p = data.players[address];
  if (p) {
    // Wallet already registered — password is optional here (legacy wallet login).
    // If a password is supplied, verify it against the stored hash.
    if (password) {
      if (!p.password) return { error: 'No password set for this account' };
      const ok = await verifyPassword(password, p.password);
      if (!ok) return { error: 'Incorrect password' };
    }
    return p;
  }
  // Wallet not registered yet — allow claiming with a username + password
  if (!username || !username.trim()) {
    return { error: 'No registered profile for this wallet. Register first.' };
  }
  const reg = await registerPlayer(address, { name, username, email: null, password });
  if (reg.error) return reg;
  return reg;
}

/** Whether `address` has a registered (username-bearing) profile. */
export function isRegistered(address) {
  return !!(data.players[address] && data.players[address].registered);
}

/** Return a client-safe profile (password hash stripped). */
export function safeProfile(address) {
  const p = data.players[address];
  if (!p) return null;
  const { password, ...safe } = p;
  return safe;
}

/** List of all usernames (for the client hint display; not for login auth). */
export function usernames() {
  return Object.values(data.players)
    .filter(p => p.username)
    .map(p => ({ address: p.address, username: p.username, name: p.name }));
}

/** Strip password from a profile object (in place-safe copy). */
export function withoutPassword(p) {
  if (!p) return p;
  const { password, ...safe } = p;
  return safe;
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
