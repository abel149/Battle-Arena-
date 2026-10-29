// Player profiles, stats, badges, and ARENA token balances.
// Backed by SQLite (better-sqlite3) — swap to a different DB later if needed.
// All read/writes are synchronous and serialized; suitable for the single-threaded
// Node event loop used by this server.

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.ARENA_DB_PATH || path.join(__dirname, 'data.sqlite');

// ---- Schema ----
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (
    address TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT,
    email TEXT,
    password TEXT,
    registered INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    matches INTEGER NOT NULL DEFAULT 0,
    tokens INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    streak INTEGER NOT NULL DEFAULT 0,
    bestStreak INTEGER NOT NULL DEFAULT 0,
    memoryWins INTEGER NOT NULL DEFAULT 0,
    deckStats TEXT NOT NULL DEFAULT '{}',
    badges TEXT NOT NULL DEFAULT '[]',
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_username ON players(username)`,
  `CREATE INDEX IF NOT EXISTS ix_registered ON players(registered)`,
  `CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  // Finished-match archive for replay: full move list + final board layout.
  `CREATE TABLE IF NOT EXISTS matches (
    matchId TEXT PRIMARY KEY,
    gameType TEXT NOT NULL,
    deck TEXT,
    players TEXT NOT NULL,
    names TEXT NOT NULL DEFAULT '{}',
    layout TEXT,
    result TEXT NOT NULL,
    winner TEXT,
    moves TEXT NOT NULL DEFAULT '[]',
    recordedAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Weekly leaderboard window: one row per (week, address), reset by week key.
  `CREATE TABLE IF NOT EXISTS weekly_points (
    week TEXT NOT NULL,
    address TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (week, address)
  )`,
];

let db;
let prepared;

function open() {
  if (db) return db;
  db = new Database(DATA_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const stmt of SCHEMA) db.exec(stmt);
  prepare();
  return db;
}

function prepare() {
  prepared = {
    // Upsert a player row (used on registration and on result application).
    upsert: db.prepare(`
      INSERT INTO players (address, name, username, email, password, registered,
        wins, losses, draws, matches, tokens, xp, level, streak, bestStreak,
        memoryWins, deckStats, badges, updatedAt)
      VALUES (@address, @name, @username, @email, @password, @registered,
        @wins, @losses, @draws, @matches, @tokens, @xp, @level, @streak, @bestStreak,
        @memoryWins, @deckStats, @badges, @updatedAt)
      ON CONFLICT(address) DO UPDATE SET
        name = excluded.name,
        username = excluded.username,
        email = excluded.email,
        password = excluded.password,
        registered = excluded.registered,
        wins = excluded.wins,
        losses = excluded.losses,
        draws = excluded.draws,
        matches = excluded.matches,
        tokens = excluded.tokens,
        xp = excluded.xp,
        level = excluded.level,
        streak = excluded.streak,
        bestStreak = excluded.bestStreak,
        memoryWins = excluded.memoryWins,
        deckStats = excluded.deckStats,
        badges = excluded.badges,
        updatedAt = excluded.updatedAt
    `),
    getByAddress: db.prepare('SELECT * FROM players WHERE address = ?'),
    getByUsername: db.prepare('SELECT * FROM players WHERE lower(username) = lower(?)'),
    usernameExists: db.prepare('SELECT 1 FROM players WHERE lower(username) = lower(?) AND address != ? LIMIT 1'),
    count: db.prepare('SELECT COUNT(*) AS c FROM players'),
    leaderboard: db.prepare(`
      SELECT * FROM players
      ORDER BY tokens DESC, wins DESC
    `),
    updateDeckStats: db.prepare(`
      UPDATE players SET deckStats = @deckStats, updatedAt = @updatedAt WHERE address = @address
    `),
    updateBadges: db.prepare(`
      UPDATE players SET badges = @badges, updatedAt = @updatedAt WHERE address = @address
    `),
    saveMatch: db.prepare(`
      INSERT OR REPLACE INTO matches (matchId, gameType, deck, players, names, layout, result, winner, moves, recordedAt)
      VALUES (@matchId, @gameType, @deck, @players, @names, @layout, @result, @winner, @moves, @recordedAt)
    `),
    weeklyUpsert: db.prepare(`
      INSERT INTO weekly_points (week, address, points, wins) VALUES (@week, @address, @points, @wins)
      ON CONFLICT(week, address) DO UPDATE SET
        points = points + excluded.points,
        wins = wins + excluded.wins
    `),
    weeklyRows: db.prepare(`
      SELECT wp.address, wp.points, wp.wins
      FROM weekly_points wp WHERE wp.week = ?
      ORDER BY wp.points DESC, wp.wins DESC
      LIMIT 50
    `),
    weeklyGet: db.prepare('SELECT points, wins FROM weekly_points WHERE week = ? AND address = ?'),
  };
}

function rowToPlayer(row) {
  if (!row) return null;
  return {
    address: row.address,
    name: row.name,
    username: row.username || null,
    email: row.email || null,
    password: row.password || null,
    registered: Boolean(row.registered),
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    matches: row.matches,
    tokens: row.tokens,
    xp: row.xp,
    level: row.level,
    streak: row.streak,
    bestStreak: row.bestStreak,
    memoryWins: row.memoryWins,
    deckStats: safeJson(row.deckStats),
    badges: safeJson(row.badges),
  };
}

function safeJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function playerToRow(p) {
  return {
    address: p.address,
    name: p.name,
    username: p.username,
    email: p.email,
    password: p.password,
    registered: p.registered ? 1 : 0,
    wins: p.wins,
    losses: p.losses,
    draws: p.draws,
    matches: p.matches,
    tokens: p.tokens,
    xp: p.xp,
    level: p.level,
    streak: p.streak,
    bestStreak: p.bestStreak,
    memoryWins: p.memoryWins,
    deckStats: JSON.stringify(p.deckStats),
    badges: JSON.stringify(p.badges),
    updatedAt: new Date().toISOString(),
  };
}

// ---- Internal helpers ----

function createPlayer(address, name) {
  return {
    address,
    name: name || 'Player-' + address.slice(2, 8),
    wins: 0, losses: 0, draws: 0, matches: 0, tokens: 0, xp: 0, level: 1,
    streak: 0, bestStreak: 0, memoryWins: 0, deckStats: {}, badges: [],
    registered: false, email: null, password: null, username: null,
  };
}

// ---- Public API (drop-in replacement for the JSON-file store) ----

export function upsertPlayer(address, name) {
  open();
  const existing = getPlayer(address);
  let p = existing;
  if (!p) {
    p = {
      address,
      name: name || 'Player-' + address.slice(2, 8),
      wins: 0, losses: 0, draws: 0, matches: 0, tokens: 0, xp: 0, level: 1,
      streak: 0, bestStreak: 0, memoryWins: 0, deckStats: {}, badges: [],
      registered: false, email: null, password: null, username: null,
    };
  }
  // Backfill fields for players created before this version
  p.xp ??= 0;
  p.level ??= 1;
  p.streak ??= 0;
  p.bestStreak ??= 0;
  p.memoryWins ??= 0;
  p.deckStats ??= {};
  p.badges ??= [];
  if (name) p.name = name;
  // `name` is NOT NULL in the schema; guarantee a fallback when p.name is still null.
  if (!p.name) p.name = 'Player-' + address.slice(2, 8);
  prepared.upsert.run(playerToRow(p));
  return getPlayer(address); // return fresh copy from DB
}

export function getPlayer(address) {
  open();
  return rowToPlayer(prepared.getByAddress.get(address));
}

function usernameIndex() {
  open();
  const rows = db.prepare('SELECT address, username FROM players WHERE username IS NOT NULL').all();
  const idx = {};
  for (const r of rows) {
    if (r.username) idx[r.username.toLowerCase()] = r.address;
  }
  return idx;
}

export function validateUsername(username) {
  if (!username || !username.trim()) return 'Username is required';
  const n = username.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(n)) return 'Username must be 3–20 letters, numbers, or underscores.';
  return null;
}

export function validatePassword(password) {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  return null;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export async function registerPlayer(address, { name, username, email, password } = {}) {
  open();
  const existingPlayer = getPlayer(address);
  if (existingPlayer?.registered) {
    return { error: 'A player with this wallet already exists' };
  }
  const usernameErr = validateUsername(username);
  if (usernameErr) return { error: usernameErr };
  const passwordErr = validatePassword(password);
  if (passwordErr) return { error: passwordErr };
  if (!username || !username.trim()) {
    return { error: 'Username is required' };
  }
  const normalized = username.trim().toLowerCase();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(normalized)) {
    return { error: 'Username must be 3–20 letters, numbers, or underscores.' };
  }
  const taken = prepared.usernameExists.get(normalized, address);
  if (taken) {
    const addr = (await db.prepare('SELECT address FROM players WHERE lower(username) = lower(?)').get(normalized));
    return { error: 'Username already taken', conflict: addr?.address };
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
  prepared.upsert.run(playerToRow(profile));
  return getPlayer(address);
}

export async function loginPlayerByCredentials({ username, password } = {}) {
  open();
  const usernameErr = validateUsername(username);
  if (usernameErr) return { error: usernameErr };
  const passwordErr = validatePassword(password);
  if (passwordErr) return { error: passwordErr };
  const normalized = username.trim().toLowerCase();
  const row = prepared.getByUsername.get(normalized);
  if (!row) return { error: 'Unknown username' };
  const p = rowToPlayer(row);
  if (!p.password) return { error: 'No password set for this account' };
  const ok = await verifyPassword(password, p.password);
  if (!ok) return { error: 'Incorrect password' };
  return p;
}

export async function loginPlayer(address, { username, name, password } = {}) {
  open();
  const existingPlayer = getPlayer(address);
  if (existingPlayer) {
    if (password) {
      if (!existingPlayer.password) return { error: 'No password set for this account' };
      const ok = await verifyPassword(password, existingPlayer.password);
      if (!ok) return { error: 'Incorrect password' };
    }
    return existingPlayer;
  }
  if (!username || !username.trim()) {
    return { error: 'No registered profile for this wallet. Register first.' };
  }
  const reg = await registerPlayer(address, { name, username, email: null, password });
  if (reg.error) return reg;
  return reg;
}

export function isRegistered(address) {
  const p = getPlayer(address);
  return !!(p && p.registered);
}

export function safeProfile(address) {
  const p = getPlayer(address);
  if (!p) return null;
  const { password, ...safe } = p;
  return safe;
}

export function usernames() {
  open();
  return db.prepare('SELECT address, username, name FROM players WHERE username IS NOT NULL').all()
    .map(p => ({ address: p.address, username: p.username, name: p.name }));
}

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
  { id: 'flag_master', label: 'Flag Master', desc: 'Win 3 Flag deck matches', check: p => (p.deckStats?.flags?.wins || 0) >= 3 },
  { id: 'math_whiz',   label: 'Math Whiz',   desc: 'Win 3 Math deck matches', check: p => (p.deckStats?.math?.wins || 0) >= 3 },
  { id: 'polyglot',    label: 'Polyglot',    desc: 'Win 3 Kiswahili deck matches', check: p => (p.deckStats?.swahili?.wins || 0) >= 3 },
  { id: 'memory_king', label: 'Memory King', desc: 'Win 10 Memory matches', check: p => p.memoryWins >= 10 },
];

export function levelFor(xp) {
  return Math.floor(xp / 100) + 1;
}

export function applyResult(address, result, ctx = {}) {
  open();
  const p = getPlayer(address) || { address, name: 'Player-' + address.slice(2, 8), wins: 0, losses: 0, draws: 0, matches: 0, tokens: 0, xp: 0, level: 1, streak: 0, bestStreak: 0, memoryWins: 0, deckStats: {}, badges: [], registered: false };
  if (!p.name) p.name = 'Player-' + address.slice(2, 8);
  p.matches += 1;
  if (result === 'win')  { p.wins += 1;   p.tokens += 10; p.xp += 50; p.streak += 1; }
  if (result === 'draw') { p.draws += 1;  p.tokens += 3;  p.xp += 20; p.streak = 0; }
  if (result === 'loss') { p.losses += 1; p.tokens += 1;  p.xp += 10; p.streak = 0; }
  p.bestStreak = Math.max(p.bestStreak, p.streak);
  if (ctx.daily) p.xp += 15;
  p.level = levelFor(p.xp);

  // Weekly leaderboard points mirror the ARENA earned this match.
  const earned = result === 'win' ? 10 : result === 'draw' ? 3 : result === 'loss' ? 1 : 0;
  if (earned > 0) {
    prepared.weeklyUpsert.run({ week: weekStartFor(), address, points: earned, wins: result === 'win' ? 1 : 0 });
  }

  if (ctx.gameType === 'memory' && ctx.deck) {
    p.memoryWins += result === 'win' ? 1 : 0;
    const d = p.deckStats[ctx.deck] || (p.deckStats[ctx.deck] = { wins: 0, matches: 0 });
    d.matches += 1;
    if (result === 'win') d.wins += 1;
  }

  const owned = new Set(p.badges.map(b => b.id));
  for (const def of BADGE_DEFS) {
    if (!owned.has(def.id) && def.check(p)) {
      p.badges.push({ id: def.id, label: def.label, desc: def.desc, awardedAt: Date.now() });
    }
  }

  // Update only changed fields in the DB (preserves concurrent reads)
  prepared.upsert.run(playerToRow(p));
  return getPlayer(address);
}

export function leaderboard() {
  open();
  return prepared.leaderboard.all().map((row, i) => ({ rank: i + 1, ...rowToPlayer(row) }));
}

// ---- Finished-match archive (for the replay feature) ----

export function saveMatch({ matchId, gameType, deck, players, names, layout, result, winner, moves }) {
  open();
  prepared.saveMatch.run({
    matchId,
    gameType,
    deck: deck || null,
    players: JSON.stringify(players),
    names: JSON.stringify(names || {}),
    layout: layout ? JSON.stringify(layout) : null,
    result,
    winner: winner || null,
    moves: JSON.stringify(moves || []),
    recordedAt: new Date().toISOString(),
  });
}

export function getReplay(matchId) {
  open();
  const row = db.prepare('SELECT * FROM matches WHERE matchId = ?').get(matchId);
  if (!row) return null;
  return {
    matchId: row.matchId,
    gameType: row.gameType,
    deck: row.deck,
    players: safeJson(row.players) || {},
    names: safeJson(row.names) || {},
    layout: safeJson(row.layout),
    result: row.result,
    winner: row.winner,
    moves: safeJson(row.moves) || [],
    recordedAt: row.recordedAt,
  };
}

// ---- Weekly leaderboard ----

// Monday (UTC) of the week containing `now` as an ISO date string.
// Every key rotation is an implicit leaderboard reset.
export function weekStartFor(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function leaderboardWeekly(now = new Date()) {
  open();
  const week = weekStartFor(now);
  return prepared.weeklyRows.all(week).map((row, i) => {
    const p = safeProfile(row.address) || {};
    return {
      rank: i + 1,
      address: row.address,
      name: p.name || row.address.slice(0, 8),
      level: p.level || 1,
      points: row.points,
      wins: row.wins,
    };
  });
}

export function weeklyStats(address, now = new Date()) {
  open();
  const row = prepared.weeklyGet.get(weekStartFor(now), address);
  return { week: weekStartFor(now), points: row?.points || 0, wins: row?.wins || 0 };
}

// ---- On-chain badge id mapping (ArenaBadges.sol) ----

// Deterministic ERC-1155 token id for a badge: index in BADGE_DEFS + 1.
export function badgeNumericId(badgeId) {
  const idx = BADGE_DEFS.findIndex(d => d.id === badgeId);
  return idx === -1 ? null : idx + 1;
}

export { BADGE_DEFS };

export { getPlayer as safeProfileForInternal };
