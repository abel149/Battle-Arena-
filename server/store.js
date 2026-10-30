// Player profiles, stats, badges, and ARENA token balances.
// Backed by SQLite (better-sqlite3) — swap to a different DB later if needed.
// All read/writes are synchronous and serialized; suitable for the single-threaded
// Node event loop used by this server.

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.ARENA_DB_PATH || path.join(__dirname, 'data.sqlite');
const LEGACY_DATA_FILE = process.env.ARENA_LEGACY_DATA_PATH || path.join(__dirname, 'data.json');

export const BATTLE_PASS_TIERS = [
  { tier: 1, xpRequired: 0, name: "Room Cadet", rewardText: "10 ARENA Allowance + Room Commander Badge", voucher: null },
  { tier: 2, xpRequired: 100, name: "Chore Apprentice", rewardText: "+3 Arena Energy + 15 ARENA Allowance", voucher: null },
  { tier: 3, xpRequired: 200, name: "Screen Explorer", rewardText: "🎮 1 Hour Screen Time Pass + 20 ARENA", voucher: { type: 'screentime', title: "1 Hour Bonus Screen Time Pass" } },
  { tier: 4, xpRequired: 300, name: "Homework Hero", rewardText: "+4 Arena Energy + 25 ARENA Allowance", voucher: null },
  { tier: 5, xpRequired: 400, name: "Pizza Paladin", rewardText: "🍕 Pizza Night Choice Pass + 35 ARENA", voucher: { type: 'pizza', title: "Family Pizza Night Choice Pass" } },
  { tier: 6, xpRequired: 500, name: "Bookworm Knight", rewardText: "+5 Arena Energy + 40 ARENA Allowance", voucher: null },
  { tier: 7, xpRequired: 600, name: "Sundae Sovereign", rewardText: "🍦 Ice Cream Spree Pass + 50 ARENA", voucher: { type: 'icecream', title: "Ice Cream Spree Family Pass" } },
  { tier: 8, xpRequired: 700, name: "Cleanliness Champion", rewardText: "+6 Arena Energy + 60 ARENA Allowance", voucher: null },
  { tier: 9, xpRequired: 800, name: "Cinema Champion", rewardText: "🎟️ Movie Night Family Pick + 75 ARENA", voucher: { type: 'movie', title: "Movie Night Family Pick Pass" } },
  { tier: 10, xpRequired: 900, name: "Legendary Chore Master", rewardText: "🎁 $25 Toy Store / Robux Voucher + 100 ARENA", voucher: { type: 'toy_store', title: "$25 Toy Store / Robux Gift Voucher" } },
];

export const DEFAULT_CHORES = [
  { id: 'chore_room', title: "Clean up bedroom & make bed", category: "room", energyReward: 3, xpReward: 50, allowanceReward: 5 },
  { id: 'chore_homework', title: "Complete math & school homework", category: "homework", energyReward: 3, xpReward: 60, allowanceReward: 5 },
  { id: 'chore_reading', title: "Read a book for 30 minutes", category: "reading", energyReward: 2, xpReward: 40, allowanceReward: 3 },
  { id: 'chore_dishes', title: "Help empty or load the dishwasher", category: "dishes", energyReward: 2, xpReward: 35, allowanceReward: 3 },
  { id: 'chore_pets', title: "Feed or walk family pet", category: "pets", energyReward: 2, xpReward: 35, allowanceReward: 3 },
  { id: 'chore_quiz', title: "Pass 5-Question Daily Brain Quiz", category: "quiz", energyReward: 2, xpReward: 40, allowanceReward: 2 },
];

export const SKINS = [
  {
    id: 'neon-striker',
    name: 'Neon Striker',
    rarity: 'Common',
    isDefault: true,
    choreId: null,
    choreTitle: 'Starter Blaster',
    choreCategory: 'starter',
    choreDescription: 'Default issue combat interceptor. Free for all arena pilots.',
    primaryColor: '#00f0ff',
    accentColor: '#0077ff',
    laserColor: '#00ffff',
    bulletType: 'plasma',
    trailColor: '#00d4ff',
  },
  {
    id: 'crimson-phoenix',
    name: 'Crimson Phoenix',
    rarity: 'Rare',
    isDefault: false,
    choreId: 'chore_room',
    choreTitle: 'Clean up bedroom & make bed',
    choreCategory: 'room',
    choreDescription: 'Fold all clothes, make your bed, and vacuum or sweep your bedroom floor.',
    primaryColor: '#ff2d55',
    accentColor: '#ff9500',
    laserColor: '#ff3b30',
    bulletType: 'fireball',
    trailColor: '#ff6b4a',
  },
  {
    id: 'shadow-phantom',
    name: 'Shadow Phantom',
    rarity: 'Epic',
    isDefault: false,
    choreId: 'chore_homework',
    choreTitle: 'Complete math & school homework',
    choreCategory: 'homework',
    choreDescription: 'Finish all daily school assignments, math problems, and prepare your school bag.',
    primaryColor: '#af52de',
    accentColor: '#5856d6',
    laserColor: '#bf5af2',
    bulletType: 'shuriken',
    trailColor: '#9d4edd',
  },
  {
    id: 'emerald-titan',
    name: 'Emerald Titan',
    rarity: 'Rare',
    isDefault: false,
    choreId: 'chore_reading',
    choreTitle: 'Read a book for 30 minutes',
    choreCategory: 'reading',
    choreDescription: 'Read 30 minutes of a book, educational article, or chapter.',
    primaryColor: '#34c759',
    accentColor: '#30d158',
    laserColor: '#32d74b',
    bulletType: 'railgun',
    trailColor: '#00ff88',
  },
  {
    id: 'solar-sovereign',
    name: 'Solar Sovereign',
    rarity: 'Legendary',
    isDefault: false,
    choreId: 'chore_dishes',
    choreTitle: 'Help empty or load the dishwasher',
    choreCategory: 'dishes',
    choreDescription: 'Help wash dishes, clear the dining table, or empty the dishwasher.',
    primaryColor: '#ffd60a',
    accentColor: '#ff9f0a',
    laserColor: '#ffe600',
    bulletType: 'solar',
    trailColor: '#ffea70',
  },
  {
    id: 'cosmic-dragon',
    name: 'Cosmic Dragon',
    rarity: 'Legendary',
    isDefault: false,
    choreId: 'chore_pets',
    choreTitle: 'Feed or walk family pet',
    choreCategory: 'pets',
    choreDescription: 'Take the family pet on a 20+ minute walk or feed and care for them.',
    primaryColor: '#00f5d4',
    accentColor: '#7b2cbf',
    laserColor: '#00f5d4',
    bulletType: 'dragon',
    trailColor: '#70e000',
  },
];

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
    energy INTEGER NOT NULL DEFAULT 5,
    parentAddress TEXT,
    battlePassXp INTEGER NOT NULL DEFAULT 0,
    battlePassTier INTEGER NOT NULL DEFAULT 1,
    allowanceBalance INTEGER NOT NULL DEFAULT 0,
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
  // Parent-backed Proof-of-Chore table
  `CREATE TABLE IF NOT EXISTS chores (
    id TEXT PRIMARY KEY,
    kidAddress TEXT NOT NULL,
    parentAddress TEXT,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    energyReward INTEGER NOT NULL DEFAULT 2,
    xpReward INTEGER NOT NULL DEFAULT 40,
    allowanceReward INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'available',
    submittedAt TEXT,
    verifiedAt TEXT,
    verificationProof TEXT,
    notes TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS ix_chores_kid ON chores(kidAddress)`,
  `CREATE INDEX IF NOT EXISTS ix_chores_parent ON chores(parentAddress)`,
  // Battle pass vouchers unlocked through tiers
  `CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    kidAddress TEXT NOT NULL,
    parentAddress TEXT,
    tier INTEGER NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unlocked',
    claimedAt TEXT,
    redeemedAt TEXT,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS ix_vouchers_kid ON vouchers(kidAddress)`,
  // Player unlocked skins
  `CREATE TABLE IF NOT EXISTS player_skins (
    address TEXT NOT NULL,
    skinId TEXT NOT NULL,
    unlockedAt TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (address, skinId)
  )`,
  `CREATE INDEX IF NOT EXISTS ix_player_skins ON player_skins(address)`,
  // Parent 4-digit PINs (stored as bcrypt hash, default '1234')
  `CREATE TABLE IF NOT EXISTS parent_pins (
    address TEXT PRIMARY KEY,
    pinHash TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Active in-progress rooms persistence (eliminates in-memory volatility on restart)
  `CREATE TABLE IF NOT EXISTS active_rooms (
    roomId TEXT PRIMARY KEY,
    gameType TEXT NOT NULL,
    deck TEXT,
    players TEXT NOT NULL,
    names TEXT NOT NULL DEFAULT '{}',
    game TEXT NOT NULL,
    moves TEXT NOT NULL DEFAULT '[]',
    chat TEXT NOT NULL DEFAULT '[]',
    spectators TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`,
  // Parent PIN brute-force attempt lockout persistence (eliminates in-memory volatility on restart)
  `CREATE TABLE IF NOT EXISTS pin_attempts (
    address TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    lockedUntil INTEGER NOT NULL DEFAULT 0,
    updatedAt INTEGER NOT NULL DEFAULT 0
  )`,
  // Login sessions: the client keeps a random token; only its hash is stored.
  `CREATE TABLE IF NOT EXISTS sessions (
    tokenHash TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`,
  // Brain Quiz cooldown tracking (prevents infinite energy spam)
  `CREATE TABLE IF NOT EXISTS quiz_cooldowns (
    address TEXT PRIMARY KEY,
    lastCompletedAt INTEGER NOT NULL
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
  // Migrate columns if players table was created prior
  const cols = db.pragma('table_info(players)').map(c => c.name);
  if (!cols.includes('energy')) db.exec('ALTER TABLE players ADD COLUMN energy INTEGER NOT NULL DEFAULT 5');
  if (!cols.includes('parentAddress')) db.exec('ALTER TABLE players ADD COLUMN parentAddress TEXT');
  if (!cols.includes('battlePassXp')) db.exec('ALTER TABLE players ADD COLUMN battlePassXp INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('battlePassTier')) db.exec('ALTER TABLE players ADD COLUMN battlePassTier INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('allowanceBalance')) db.exec('ALTER TABLE players ADD COLUMN allowanceBalance INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('equippedSkin')) db.exec("ALTER TABLE players ADD COLUMN equippedSkin TEXT NOT NULL DEFAULT 'neon-striker'");
  prepare();
  migrateLegacyPlayers();
  return db;
}

function migrateLegacyPlayers() {
  if (prepared.count.get().c > 0 || !fs.existsSync(LEGACY_DATA_FILE)) return;

  const legacyData = JSON.parse(fs.readFileSync(LEGACY_DATA_FILE, 'utf8'));
  if (!legacyData.players || typeof legacyData.players !== 'object' || Array.isArray(legacyData.players)) {
    throw new Error(`Cannot migrate legacy player data from ${LEGACY_DATA_FILE}`);
  }

  const migrate = db.transaction(() => {
    for (const [key, legacyPlayer] of Object.entries(legacyData.players)) {
      if (!legacyPlayer || typeof legacyPlayer !== 'object' || Array.isArray(legacyPlayer)) {
        throw new Error(`Invalid legacy player record for ${key}`);
      }
      const address = legacyPlayer.address || key;
      if (typeof address !== 'string' || !address) {
        throw new Error(`Invalid legacy player address for ${key}`);
      }
      const player = {
        ...createPlayer(address, legacyPlayer.name),
        ...legacyPlayer,
        address,
        registered: Boolean(legacyPlayer.registered),
        username: legacyPlayer.username || null,
        email: legacyPlayer.email || null,
        password: legacyPlayer.password || null,
      };
      prepared.upsert.run(playerToRow(player));
    }
  });
  migrate();
}

function prepare() {
  prepared = {
    // Upsert a player row (used on registration and on result application).
    upsert: db.prepare(`
      INSERT INTO players (address, name, username, email, password, registered,
        wins, losses, draws, matches, tokens, xp, level, streak, bestStreak,
        memoryWins, deckStats, badges, energy, parentAddress, battlePassXp, battlePassTier, allowanceBalance, equippedSkin, updatedAt)
      VALUES (@address, @name, @username, @email, @password, @registered,
        @wins, @losses, @draws, @matches, @tokens, @xp, @level, @streak, @bestStreak,
        @memoryWins, @deckStats, @badges, @energy, @parentAddress, @battlePassXp, @battlePassTier, @allowanceBalance, @equippedSkin, @updatedAt)
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
        energy = excluded.energy,
        parentAddress = excluded.parentAddress,
        battlePassXp = excluded.battlePassXp,
        battlePassTier = excluded.battlePassTier,
        allowanceBalance = excluded.allowanceBalance,
        equippedSkin = excluded.equippedSkin,
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
    // Proof-of-Chore prepared statements
    getChoresForKid: db.prepare('SELECT * FROM chores WHERE kidAddress = ? ORDER BY createdAt DESC'),
    getChoreById: db.prepare('SELECT * FROM chores WHERE id = ?'),
    insertChore: db.prepare(`
      INSERT OR IGNORE INTO chores (id, kidAddress, parentAddress, title, category, energyReward, xpReward, allowanceReward, status, submittedAt, verifiedAt, verificationProof, notes, createdAt)
      VALUES (@id, @kidAddress, @parentAddress, @title, @category, @energyReward, @xpReward, @allowanceReward, @status, @submittedAt, @verifiedAt, @verificationProof, @notes, @createdAt)
    `),
    updateChoreStatus: db.prepare(`
      UPDATE chores SET status = @status, submittedAt = @submittedAt, verifiedAt = @verifiedAt, verificationProof = @verificationProof, notes = @notes WHERE id = @id
    `),
    updateKidParent: db.prepare('UPDATE players SET parentAddress = ? WHERE address = ?'),
    updateKidParentOnChores: db.prepare('UPDATE chores SET parentAddress = ? WHERE kidAddress = ?'),
    getKidsForParent: db.prepare('SELECT * FROM players WHERE parentAddress = ?'),
    getPendingChoresForParent: db.prepare("SELECT * FROM chores WHERE (parentAddress = ? OR parentAddress IS NULL) AND status = 'pending_approval' ORDER BY submittedAt DESC"),
    getVouchersForKid: db.prepare('SELECT * FROM vouchers WHERE kidAddress = ? ORDER BY tier ASC'),
    getVoucherById: db.prepare('SELECT * FROM vouchers WHERE id = ?'),
    insertVoucher: db.prepare(`
      INSERT OR IGNORE INTO vouchers (id, kidAddress, parentAddress, tier, title, type, status, claimedAt, redeemedAt, createdAt)
      VALUES (@id, @kidAddress, @parentAddress, @tier, @title, @type, @status, @claimedAt, @redeemedAt, @createdAt)
    `),
    updateVoucherStatus: db.prepare('UPDATE vouchers SET status = @status, claimedAt = @claimedAt, redeemedAt = @redeemedAt WHERE id = @id'),
    // Skins and Parent PIN prepared statements
    getUnlockedSkins: db.prepare('SELECT skinId, unlockedAt FROM player_skins WHERE address = ?'),
    unlockSkin: db.prepare('INSERT OR IGNORE INTO player_skins (address, skinId, unlockedAt) VALUES (?, ?, ?)'),
    getParentPin: db.prepare('SELECT pinHash FROM parent_pins WHERE address = ?'),
    setParentPin: db.prepare('INSERT OR REPLACE INTO parent_pins (address, pinHash, updatedAt) VALUES (?, ?, ?)'),
    // PIN brute-force attempt persistence
    getPinAttempt: db.prepare('SELECT count, lockedUntil FROM pin_attempts WHERE address = ?'),
    savePinAttempt: db.prepare(`
      INSERT INTO pin_attempts (address, count, lockedUntil, updatedAt)
      VALUES (@address, @count, @lockedUntil, @updatedAt)
      ON CONFLICT(address) DO UPDATE SET
        count = excluded.count,
        lockedUntil = excluded.lockedUntil,
        updatedAt = excluded.updatedAt
    `),
    deletePinAttempt: db.prepare('DELETE FROM pin_attempts WHERE address = ?'),
    // Active rooms persistence
    upsertActiveRoom: db.prepare(`
      INSERT INTO active_rooms (roomId, gameType, deck, players, names, game, moves, chat, spectators, createdAt, updatedAt)
      VALUES (@roomId, @gameType, @deck, @players, @names, @game, @moves, @chat, @spectators, @createdAt, @updatedAt)
      ON CONFLICT(roomId) DO UPDATE SET
        game = excluded.game,
        moves = excluded.moves,
        chat = excluded.chat,
        spectators = excluded.spectators,
        updatedAt = excluded.updatedAt
    `),
    deleteActiveRoom: db.prepare('DELETE FROM active_rooms WHERE roomId = ?'),
    getActiveRoom: db.prepare('SELECT * FROM active_rooms WHERE roomId = ?'),
    listActiveRooms: db.prepare('SELECT * FROM active_rooms ORDER BY createdAt DESC'),
    cleanupStaleActiveRooms: db.prepare('DELETE FROM active_rooms WHERE updatedAt < ?'),
    sessionInsert: db.prepare('INSERT INTO sessions (tokenHash, address, createdAt) VALUES (?, ?, ?)'),
    sessionGet: db.prepare('SELECT address, createdAt FROM sessions WHERE tokenHash = ?'),
    sessionDelete: db.prepare('DELETE FROM sessions WHERE tokenHash = ?'),
    getQuizCooldown: db.prepare('SELECT lastCompletedAt FROM quiz_cooldowns WHERE address = ?'),
    setQuizCooldown: db.prepare('INSERT OR REPLACE INTO quiz_cooldowns (address, lastCompletedAt) VALUES (?, ?)'),
  };
}

// ---- Login sessions ----

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (reduced from 30 days)
const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

/** Create a login session for `address`; returns the opaque token for the client. */
export function createSession(address) {
  open();
  const token = crypto.randomBytes(32).toString('hex');
  prepared.sessionInsert.run(hashToken(token), address, Date.now());
  return token;
}

/** Address a valid, unexpired session token belongs to — or null. */
export function addressForSession(token) {
  if (!token || typeof token !== 'string') return null;
  open();
  const row = prepared.sessionGet.get(hashToken(token));
  if (!row) return null;
  if (Date.now() - row.createdAt > SESSION_TTL_MS) {
    prepared.sessionDelete.run(hashToken(token));
    return null;
  }
  return row.address;
}

export function deleteSession(token) {
  if (!token || typeof token !== 'string') return;
  open();
  prepared.sessionDelete.run(hashToken(token));
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
    energy: row.energy !== undefined && row.energy !== null ? row.energy : 5,
    parentAddress: row.parentAddress || null,
    battlePassXp: row.battlePassXp || 0,
    battlePassTier: row.battlePassTier || 1,
    allowanceBalance: row.allowanceBalance || 0,
    equippedSkin: row.equippedSkin || 'neon-striker',
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
    energy: p.energy !== undefined && p.energy !== null ? p.energy : 5,
    parentAddress: p.parentAddress || null,
    battlePassXp: p.battlePassXp || 0,
    battlePassTier: p.battlePassTier || 1,
    allowanceBalance: p.allowanceBalance || 0,
    equippedSkin: p.equippedSkin || 'neon-striker',
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
    energy: 5, parentAddress: null, battlePassXp: 0, battlePassTier: 1, allowanceBalance: 0,
    equippedSkin: 'neon-striker',
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
    return { error: 'Username already taken' };
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

export async function loginPlayer(address, { username, name, password, signatureVerified = false } = {}) {
  open();
  const existingPlayer = getPlayer(address);
  if (existingPlayer) {
    if (password) {
      if (!existingPlayer.password) return { error: 'No password set for this account' };
      const ok = await verifyPassword(password, existingPlayer.password);
      if (!ok) return { error: 'Incorrect password' };
      return existingPlayer;
    }
    if (signatureVerified) {
      return existingPlayer;
    }
    return { error: 'Authentication required: provide password or wallet signature' };
  }
  if (!username || !username.trim()) {
    return { error: 'No registered profile for this wallet. Register first.' };
  }
  if (!signatureVerified && !password) {
    return { error: 'Authentication required to register this account' };
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
  const { password, email, ...safe } = p;
  return safe;
}

export function usernames() {
  open();
  return db.prepare('SELECT address, username, name FROM players WHERE username IS NOT NULL').all()
    .map(p => ({ address: p.address, username: p.username, name: p.name }));
}

export function withoutPassword(p) {
  if (!p) return p;
  const { password, email, ...safe } = p;
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

  // Battle pass progression: every finished match awards +25 Battle Pass XP
  p.battlePassXp = (p.battlePassXp || 0) + 25;
  p.battlePassTier = Math.min(10, Math.floor(p.battlePassXp / 100) + 1);
  syncBattlePassVouchers(address, p.battlePassTier, p.parentAddress);

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
  return prepared.leaderboard.all()
    .map((row, i) => withoutPassword({ rank: i + 1, ...rowToPlayer(row) }));
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

// ---- Proof-of-Chore & Battle Pass API ----

export function syncBattlePassVouchers(kidAddress, tier, parentAddress = null) {
  open();
  for (const t of BATTLE_PASS_TIERS) {
    if (t.tier <= tier && t.voucher) {
      const vId = `voucher_${kidAddress.slice(2, 8)}_${t.tier}`;
      prepared.insertVoucher.run({
        id: vId,
        kidAddress,
        parentAddress: parentAddress || null,
        tier: t.tier,
        title: t.voucher.title,
        type: t.voucher.type,
        status: 'unlocked',
        claimedAt: null,
        redeemedAt: null,
        createdAt: new Date().toISOString(),
      });
    }
  }
}

export function getChores(kidAddress) {
  open();
  upsertPlayer(kidAddress);
  let chores = prepared.getChoresForKid.all(kidAddress);
  if (chores.length === 0) {
    const p = getPlayer(kidAddress);
    const parent = p?.parentAddress || null;
    for (const d of DEFAULT_CHORES) {
      const cId = `chore_${kidAddress.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-12)}_${d.id}`;
      prepared.insertChore.run({
        id: cId,
        kidAddress,
        parentAddress: parent,
        title: d.title,
        category: d.category,
        energyReward: d.energyReward,
        xpReward: d.xpReward,
        allowanceReward: d.allowanceReward,
        status: 'available',
        submittedAt: null,
        verifiedAt: null,
        verificationProof: null,
        notes: null,
        createdAt: new Date().toISOString(),
      });
    }
    chores = prepared.getChoresForKid.all(kidAddress);
  }
  return chores;
}

export function submitChore(kidAddress, choreId, notes = '') {
  open();
  const chore = prepared.getChoreById.get(choreId);
  if (!chore || chore.kidAddress !== kidAddress) {
    return { error: 'Chore not found' };
  }
  if (chore.status !== 'available') {
    return { error: 'Chore is already ' + chore.status };
  }
  prepared.updateChoreStatus.run({
    id: choreId,
    status: 'pending_approval',
    submittedAt: new Date().toISOString(),
    verifiedAt: null,
    verificationProof: null,
    notes: notes || 'Completed by kid',
  });
  return prepared.getChoreById.get(choreId);
}

export function verifyChore(choreId, parentAddress, proofHash = null) {
  open();
  const chore = prepared.getChoreById.get(choreId);
  if (!chore) return { error: 'Chore not found' };
  if (chore.status === 'verified') return { error: 'Chore already verified' };
  if (chore.parentAddress && parentAddress && chore.parentAddress.toLowerCase() !== parentAddress.toLowerCase()) {
    return { error: 'Only the assigned parent can verify this chore' };
  }

  prepared.updateChoreStatus.run({
    id: choreId,
    status: 'verified',
    submittedAt: chore.submittedAt || new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    verificationProof: proofHash || ('0x' + crypto.randomBytes(32).toString('hex')),
    notes: chore.notes || '',
  });

  const p = getPlayer(chore.kidAddress);
  let unlockedSkin = null;
  if (p) {
    p.energy = (p.energy || 0) + chore.energyReward;
    p.battlePassXp = (p.battlePassXp || 0) + chore.xpReward;
    p.battlePassTier = Math.min(10, Math.floor(p.battlePassXp / 100) + 1);
    p.allowanceBalance = (p.allowanceBalance || 0) + chore.allowanceReward;
    p.tokens = (p.tokens || 0) + chore.allowanceReward;
    if (parentAddress && !p.parentAddress) p.parentAddress = parentAddress;

    // Check if this chore unlocks any skin!
    const matchingSkin = SKINS.find(s => s.choreId === chore.id || (s.choreCategory && s.choreCategory === chore.category));
    if (matchingSkin) {
      unlockSkin(p.address, matchingSkin.id);
      unlockedSkin = matchingSkin;
    }

    prepared.upsert.run(playerToRow(p));
    syncBattlePassVouchers(p.address, p.battlePassTier, p.parentAddress);
  }

  return {
    ok: true,
    chore: prepared.getChoreById.get(choreId),
    player: getPlayer(chore.kidAddress),
    unlockedSkin,
  };
}

export function createCustomChore({ kidAddress, parentAddress, title, category, energyReward, xpReward, allowanceReward }) {
  open();
  const id = 'chore_' + crypto.randomBytes(8).toString('hex');
  prepared.insertChore.run({
    id,
    kidAddress,
    parentAddress: parentAddress || null,
    title: title || 'Custom Family Chore',
    category: category || 'custom',
    energyReward: Number(energyReward) || 2,
    xpReward: Number(xpReward) || 40,
    allowanceReward: Number(allowanceReward) || 5,
    status: 'available',
    submittedAt: null,
    verifiedAt: null,
    verificationProof: null,
    notes: null,
    createdAt: new Date().toISOString(),
  });
  return prepared.getChoreById.get(id);
}

export function linkParent(kidIdentifier, parentAddress) {
  open();
  let kidAddress = String(kidIdentifier || '').trim();
  if (kidAddress.startsWith('@')) kidAddress = kidAddress.slice(1);
  const byUsername = prepared.getByUsername.get(kidAddress.toLowerCase());
  if (byUsername) {
    kidAddress = byUsername.address;
  }
  upsertPlayer(kidAddress);
  prepared.updateKidParent.run(parentAddress, kidAddress);
  prepared.updateKidParentOnChores.run(parentAddress, kidAddress);
  return getPlayer(kidAddress);
}

export function getParentKids(parentAddress) {
  open();
  const kids = prepared.getKidsForParent.all(parentAddress).map(rowToPlayer);
  const pending = prepared.getPendingChoresForParent.all(parentAddress);
  return { kids, pendingChores: pending };
}

export function getVouchers(kidAddress) {
  open();
  const p = getPlayer(kidAddress);
  if (p) syncBattlePassVouchers(kidAddress, p.battlePassTier || 1, p.parentAddress);
  return prepared.getVouchersForKid.all(kidAddress);
}

export function redeemVoucher(voucherId, parentAddress) {
  open();
  const v = prepared.getVoucherById.get(voucherId);
  if (!v) return { error: 'Voucher not found' };
  if (v.status === 'redeemed') return { error: 'Voucher already redeemed' };
  prepared.updateVoucherStatus.run({
    id: voucherId,
    status: 'redeemed',
    claimedAt: v.claimedAt || new Date().toISOString(),
    redeemedAt: new Date().toISOString(),
  });
  return prepared.getVoucherById.get(voucherId);
}

export function consumeEnergy(kidAddress, amount = 1) {
  open();
  const p = getPlayer(kidAddress);
  if (!p) return { error: 'Player not found' };
  if ((p.energy || 0) < amount) {
    return { error: 'Insufficient energy', energy: p.energy || 0 };
  }
  p.energy -= amount;
  prepared.upsert.run(playerToRow(p));
  return { ok: true, energy: p.energy };
}

export function addEnergy(kidAddress, amount = 2) {
  open();
  const p = getPlayer(kidAddress);
  if (!p) return { error: 'Player not found' };
  p.energy = (p.energy || 0) + amount;
  prepared.upsert.run(playerToRow(p));
  return { ok: true, energy: p.energy };
}

export const QUIZ_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between brain quizzes

export function completeBrainQuiz(kidAddress) {
  open();
  const normalized = String(kidAddress || '').toLowerCase();
  const row = prepared.getQuizCooldown.get(normalized);
  if (row && Date.now() - row.lastCompletedAt < QUIZ_COOLDOWN_MS) {
    const waitSec = Math.ceil((QUIZ_COOLDOWN_MS - (Date.now() - row.lastCompletedAt)) / 1000);
    return { error: `Brain Quiz already completed recently. Please wait ${waitSec}s before taking it again.` };
  }
  const p = getPlayer(kidAddress);
  if (!p) return { error: 'Player not found' };
  p.energy = (p.energy || 0) + 2;
  p.battlePassXp = (p.battlePassXp || 0) + 40;
  p.battlePassTier = Math.min(10, Math.floor(p.battlePassXp / 100) + 1);
  p.tokens = (p.tokens || 0) + 2;
  prepared.upsert.run(playerToRow(p));
  prepared.setQuizCooldown.run(normalized, Date.now());
  syncBattlePassVouchers(p.address, p.battlePassTier, p.parentAddress);
  return { ok: true, energy: p.energy, battlePassXp: p.battlePassXp, battlePassTier: p.battlePassTier };
}

export function getParentPin(address) {
  open();
  const row = prepared.getParentPin.get(address);
  return row ? row.pinHash : null;
}

// ---- Skin & Parent Approval System ----

export function unlockSkin(address, skinId) {
  open();
  const skin = SKINS.find(s => s.id === skinId);
  if (!skin) return { error: 'Unknown skin' };
  prepared.unlockSkin.run(address, skinId, new Date().toISOString());
  return { ok: true, skinId };
}

export function isSkinUnlocked(address, skinId) {
  open();
  if (skinId === 'neon-striker') return true;
  if (!address) return false;
  const rows = prepared.getUnlockedSkins.all(address);
  return rows.some(r => r.skinId === skinId);
}

export function getSkins(address) {
  open();
  const p = address ? getPlayer(address) : null;
  const unlockedRows = address ? prepared.getUnlockedSkins.all(address) : [];
  const unlockedSet = new Set(unlockedRows.map(r => r.skinId));
  unlockedSet.add('neon-striker'); // default is always unlocked

  const chores = address ? getChores(address) : [];
  const choreMap = new Map();
  for (const c of chores) {
    choreMap.set(c.id, c);
    choreMap.set(c.category, c);
  }

  const equippedId = p?.equippedSkin || 'neon-striker';

  return SKINS.map(skin => {
    const isUnlocked = unlockedSet.has(skin.id);
    const chore = skin.choreId ? choreMap.get(skin.choreId) : (skin.choreCategory ? choreMap.get(skin.choreCategory) : null);
    return {
      ...skin,
      unlocked: isUnlocked,
      equipped: equippedId === skin.id,
      choreStatus: chore ? chore.status : (skin.isDefault ? 'verified' : 'available'),
      choreNotes: chore?.notes || null,
      choreSubmittedAt: chore?.submittedAt || null,
      choreVerifiedAt: chore?.verifiedAt || null,
    };
  });
}

export function equipSkin(address, skinId) {
  open();
  const p = getPlayer(address);
  if (!p) return { error: 'Player not found' };
  const skin = SKINS.find(s => s.id === skinId);
  if (!skin) return { error: 'Unknown skin' };
  if (!isSkinUnlocked(address, skinId)) {
    return { error: 'Skin is locked. Complete the required chore first!' };
  }
  p.equippedSkin = skinId;
  prepared.upsert.run(playerToRow(p));
  return { ok: true, equippedSkin: skinId, player: getPlayer(address) };
}

export function getEquippedSkin(address) {
  open();
  const p = address ? getPlayer(address) : null;
  const skinId = p?.equippedSkin || 'neon-striker';
  return SKINS.find(s => s.id === skinId) || SKINS[0];
}

// Parent PIN Verification (Default PIN is '1234')
const DEFAULT_PARENT_PIN = '1234';
const PIN_LOCKOUT_MS = 5 * 60 * 1000; // 5 minute lockout

export function resetPinAttempts(address) {
  open();
  prepared.deletePinAttempt.run(address || 'default');
}

export function getPinAttempt(address) {
  open();
  const row = prepared.getPinAttempt.get(address || 'default');
  if (!row) return null;
  return { count: row.count, lockedUntil: row.lockedUntil };
}

export function verifyParentPin(address, pin) {
  open();
  const key = address || 'default';
  const now = Date.now();
  const row = prepared.getPinAttempt.get(key);
  const attempt = row ? { count: row.count, lockedUntil: row.lockedUntil } : null;

  if (attempt && attempt.lockedUntil > now) {
    const waitSec = Math.ceil((attempt.lockedUntil - now) / 1000);
    return {
      ok: false,
      locked: true,
      error: `Too many failed attempts. PIN locked for ${waitSec}s.`,
    };
  }

  if (!pin) return { ok: false, error: 'PIN required' };
  const pinRow = prepared.getParentPin.get(key);
  let isMatch = false;
  let isDefault = false;

  if (!pinRow) {
    // If not set, default is 1234
    isDefault = true;
    isMatch = String(pin).trim() === DEFAULT_PARENT_PIN;
  } else {
    isMatch = bcrypt.compareSync(String(pin).trim(), pinRow.pinHash);
  }

  if (isMatch) {
    prepared.deletePinAttempt.run(key);
    return { ok: true, isDefault };
  }

  // Failed attempt
  const current = attempt && attempt.lockedUntil > 0 && attempt.lockedUntil <= now
    ? { count: 0, lockedUntil: 0 }
    : (attempt || { count: 0, lockedUntil: 0 });

  current.count += 1;
  if (current.count >= 5) {
    current.lockedUntil = now + PIN_LOCKOUT_MS;
    prepared.savePinAttempt.run({
      address: key,
      count: current.count,
      lockedUntil: current.lockedUntil,
      updatedAt: now,
    });
    return {
      ok: false,
      locked: true,
      error: 'Too many failed attempts. PIN locked for 5 minutes.',
    };
  }

  prepared.savePinAttempt.run({
    address: key,
    count: current.count,
    lockedUntil: current.lockedUntil,
    updatedAt: now,
  });
  const remaining = 5 - current.count;
  return {
    ok: false,
    error: `Incorrect Parent PIN. (${remaining} attempt${remaining === 1 ? '' : 's'} remaining)`,
  };
}

export function setParentPin(address, newPin) {
  open();
  const clean = String(newPin || '').trim();
  if (!/^\d{4,6}$/.test(clean)) {
    return { error: 'PIN must be 4 to 6 digits' };
  }
  const hash = bcrypt.hashSync(clean, 8);
  prepared.setParentPin.run(address || 'default', hash, new Date().toISOString());
  return { ok: true };
}

// ----------------- Active Game Rooms Persistence -----------------
// Eliminates in-memory volatility on server crashes, reboots, and redeploys.

export function saveActiveRoom(room) {
  if (!room || !room.id || !room.game) return;
  open();
  const now = Date.now();
  prepared.upsertActiveRoom.run({
    roomId: room.id,
    gameType: room.gameType,
    deck: room.deck || room.game.deck || null,
    players: JSON.stringify(room.game.players || {}),
    names: JSON.stringify(room.names || {}),
    game: JSON.stringify(room.game),
    moves: JSON.stringify(room.game.moves || []),
    chat: JSON.stringify(room.chat || []),
    spectators: JSON.stringify(Array.from(room.spectators || [])),
    createdAt: room.createdAt || now,
    updatedAt: now,
  });
}

export function removeActiveRoom(roomId) {
  if (!roomId) return;
  open();
  prepared.deleteActiveRoom.run(roomId);
}

export function getActiveRoom(roomId) {
  if (!roomId) return null;
  open();
  const row = prepared.getActiveRoom.get(roomId);
  if (!row) return null;
  return {
    ...row,
    players: JSON.parse(row.players),
    names: JSON.parse(row.names),
    game: JSON.parse(row.game),
    moves: JSON.parse(row.moves),
    chat: JSON.parse(row.chat),
    spectators: JSON.parse(row.spectators),
  };
}

export function listActiveRooms() {
  open();
  const rows = prepared.listActiveRooms.all();
  return rows.map(row => ({
    ...row,
    players: JSON.parse(row.players),
    names: JSON.parse(row.names),
    game: JSON.parse(row.game),
    moves: JSON.parse(row.moves),
    chat: JSON.parse(row.chat),
    spectators: JSON.parse(row.spectators),
  }));
}

export function cleanupStaleActiveRooms(maxAgeMs = 30 * 60 * 1000) {
  open();
  const cutoff = Date.now() - maxAgeMs;
  prepared.cleanupStaleActiveRooms.run(cutoff);
}
