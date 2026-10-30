// Web3 Battle Arena — real-time game server
// Game-agnostic rooms (engine registry), matchmaking, chat, spectators,
// on-chain (simulated) match recording, leaderboard, XP/levels/badges.

import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import crypto from 'crypto';
import {
  verifyAuthSignature,
  generateAuthNonce,
  requireSession,
  same,
  canAdminister,
  isParentUnlocked,
  unlockParent,
  corsOptions,
  isAllowedOrigin,
  securityHeaders,
  rateLimit,
} from './security.js';
import { ENGINES, DECKS, dailyDeckId } from './games/index.js';
import { defaultRecorder } from './result-recorder.js';
import { registerChatHandlers } from './sockets/chat.js';
import {
  distributeRewards,
  isTokensOnchain,
  tokenAddresses,
  tokenBalance,
} from './chain-tokens.js';
import { recordChoreVerification, verifyParentAttestation } from './chain-chore.js';
import * as store from './store.js';
import { SOCKET_EVENTS, GAME_TYPES, ENERGY_CONFIG } from '../shared/constants.js';

const PORT = process.env.PORT || 3001;
const BOT = '0xB07000000000000000000000000000000000000B';
const BOT_STEP_MS = 700;
const ROOM_RETENTION_MS = 10 * 60 * 1000; // finished rooms expire after 10 min

const app = express();
app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors(corsOptions));
app.use('/api', rateLimit({ windowMs: 60_000, max: 300 }));
app.use(express.json({ limit: '100kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  allowRequest: (req, cb) => cb(null, isAllowedOrigin(req.headers.origin)),
});

// ---- In-memory runtime state ----
const rooms = new Map(); // roomId -> room
const queue = []; // { socketId, gameType } waiting for a match
const socketPlayer = new Map(); // socketId -> address

/**
 * Broadcasts an event and payload to all connected sockets belonging to an Ethereum wallet address.
 *
 * @function notifyPlayer
 * @param {string} address - Target player wallet address.
 * @param {string} event - WebSocket event name.
 * @param {*} payload - Event payload data.
 */
function notifyPlayer(address, event, payload) {
  if (!address) return;
  for (const [sId, addr] of socketPlayer.entries()) {
    if (addr?.toLowerCase() === address.toLowerCase()) {
      const s = io.sockets.sockets.get(sId);
      if (s) s.emit(event, payload);
    }
  }
}
const liveListeners = new Set(); // socketIds in the lobby (for rooms:live push)
const pendingRooms = new Map(); // room code -> host waiting for a friend to join
const lobbyChat = [
  {
    from: 'ArenaBot',
    address: '0xB07000000000000000000000000000000000000B',
    text: '👋 Welcome to Battle Arena! Challenge a rival or cheer on live matches.',
    t: Date.now() - 30000,
    time: Date.now() - 30000,
  },
];

const PENDING_ROOM_MS = 10 * 60 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I lookalikes

/**
 * Generates an unambiguous 5-character room invitation code excluding confusing characters (0/O/1/I).
 *
 * @function makeRoomCode
 * @returns {string} Unique uppercase room code.
 */
function makeRoomCode() {
  let code;
  do {
    code = Array.from(
      { length: 5 },
      () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
    ).join('');
  } while (pendingRooms.has(code));
  return code;
}

/**
 * Cancels and deletes a pending private game room by its invitation code.
 *
 * @function dropPendingRoom
 * @param {string} code - Invitation room code.
 */
function dropPendingRoom(code) {
  const p = pendingRooms.get(code);
  if (!p) return;
  clearTimeout(p.timer);
  pendingRooms.delete(code);
}

/**
 * Cancels any pending private rooms hosted by a disconnecting socket.
 *
 * @function dropPendingFor
 * @param {string} socketId - Host socket ID.
 */
function dropPendingFor(socketId) {
  for (const [code, p] of pendingRooms) {
    if (p.hostSocketId === socketId) dropPendingRoom(code);
  }
}

// The server uses room ids as match ids. On-chain, those are stored as bytes32.
// The on-chain module normalizes them back to strings where possible.

// ---- REST ----
app.get('/api/leaderboard', (_req, res) => res.json(store.leaderboard()));
app.get('/api/leaderboard/weekly', (_req, res) => res.json(store.leaderboardWeekly()));

app.get('/api/tournament', (_req, res) => {
  const standings = store.leaderboardWeekly();
  const topPlayers = standings.slice(0, 3);
  res.json({
    title: 'Weekly Arena Championship',
    season: 'Season 1',
    status: 'active',
    prizePoolArena: 500,
    prizes: [
      { rank: 1, arenaReward: 250, badge: 'Gold Arena Champion', xp: 500 },
      { rank: 2, arenaReward: 150, badge: 'Silver Arena Duelist', xp: 300 },
      { rank: 3, arenaReward: 100, badge: 'Bronze Arena Contender', xp: 150 },
    ],
    rules:
      'Top 3 players on the weekly leaderboard at Sunday 23:59 UTC receive ARENA token mints and exclusive on-chain championship badges.',
    standings: topPlayers,
    totalContenders: standings.length,
  });
});

// Match ledger and verification expose the normalized on-chain shape.
// matchId is the stable lookup key used by the game flow; matchIdRaw is the
// exact on-chain bytes32 for proof/debugging when it differs from matchId.

app.get('/api/replay/:matchId', (req, res) => {
  const replay = store.getReplay(req.params.matchId);
  replay ? res.json(replay) : res.status(404).json({ error: 'Match not found' });
});

app.get('/api/wallet/:address/tokens', async (req, res) => {
  try {
    if (!isTokensOnchain())
      return res.json({
        onchain: false,
        symbol: 'ARENA',
        balance: store.safeProfile(req.params.address)?.tokens ?? 0,
      });
    const balance = await tokenBalance(req.params.address);
    res.json({ onchain: true, symbol: 'ARENA', balance, addresses: tokenAddresses() });
  } catch (err) {
    console.error('Failed to read token balance:', err);
    res.status(500).json({ error: 'Failed to read token balance' });
  }
});

app.get('/api/chain/status', async (_req, res) => {
  const info = await defaultRecorder.chainInfo();
  res.json({ ...info, tokens: { onchain: isTokensOnchain(), addresses: tokenAddresses() } });
});

app.get('/api/matches', async (_req, res) => {
  try {
    res.json(await defaultRecorder.getLedger());
  } catch (err) {
    console.error('Failed to load match ledger:', err);
    res.status(500).json({ error: 'Failed to load match ledger' });
  }
});

// On-chain match recording is the immutable receipt layer. The operational
// store (SQLite) keeps stats, weekly leaderboards, and the replay archive.
//
// matchId is the stable lookup key used by the game flow and REST APIs.
// matchIdRaw is the exact bytes32 stored on-chain, surfaced when on-chain
// proof details matter (for example, when a deployment cannot recover the
// original matchId from the stored bytes32).
app.get('/api/verify/:matchId', async (req, res) => {
  try {
    const ledger = await defaultRecorder.getLedger();
    const requestedMatchId = req.params.matchId;
    // The contract stores match IDs as original room IDs (bytes32 = encoded room ID).
    // Do NOT hash the matchId here; look up the original value directly.
    // On-chain entries are normalized by chain-onchain.js; when a deployment cannot
    // recover the original matchId, matchIdRaw is the exact bytes32 stored on-chain.
    const entry = ledger.find(
      (e) => e.matchId === requestedMatchId || e.matchIdRaw === requestedMatchId
    );
    entry ? res.json({ valid: true, entry }) : res.status(404).json({ valid: false });
  } catch (err) {
    console.error('Failed to load match verification:', err);
    res.status(500).json({ error: 'Failed to load match' });
  }
});
app.get('/api/decks', (_req, res) => {
  const daily = dailyDeckId();
  res.json(
    Object.entries(DECKS).map(([id, d]) => ({
      id,
      label: d.label,
      pairs: d.pairs.length,
      daily: id === daily,
    }))
  );
});

app.get('/api/auth/nonce', (req, res) => {
  const address = req.query.address;
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address query parameter required' });
  }
  const nonce = generateAuthNonce(address);
  res.json({ nonce, message: `Battle Arena login for ${address} [nonce: ${nonce}]` });
});

// Registration / login over REST (address = wallet, passed in body)
app.post('/api/register', async (req, res) => {
  const { address, username, name, email, password, signature, issuedAt } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address is required' });
  // Wallet ownership must be proven with a valid signature.
  if (!signature) {
    return res
      .status(401)
      .json({ error: 'Signature required: prove wallet ownership to register' });
  }
  if (!verifyAuthSignature(signature, address, issuedAt)) {
    return res.status(401).json({ error: 'Invalid or expired wallet signature' });
  }
  const usernameErr = store.validateUsername(username);
  if (usernameErr) return res.status(400).json({ error: usernameErr });
  const result = await store.registerPlayer(address, { name, username, email, password });
  if (result.error) return res.status(409).json(result);
  const token = store.createSession(result.address);
  res.json({ ...store.withoutPassword(result), token });
});

app.post('/api/login', async (req, res) => {
  const { address, username, name, password, signature, issuedAt } = req.body || {};
  // 1) By credentials: username + password (wallet resolved from username index).
  if (username && password) {
    const result = await store.loginPlayerByCredentials({ username, password });
    if (result.error) return res.status(401).json(result);
    const token = store.createSession(result.address);
    res.json({ ...store.withoutPassword(result), token });
    return;
  }

  // 2) By wallet address: require signature verification OR password
  if (!address)
    return res.status(400).json({ error: 'address is required when not using username+password' });

  let signatureVerified = false;
  if (signature) {
    if (!verifyAuthSignature(signature, address, issuedAt)) {
      return res.status(401).json({ error: 'Invalid or expired wallet signature' });
    }
    signatureVerified = true;
  }

  // If neither valid signature nor password is provided, reject immediately
  if (!signatureVerified && !password) {
    return res
      .status(401)
      .json({ error: 'Authentication required: provide a valid wallet signature or password' });
  }

  const result = await store.loginPlayer(address, { username, name, password, signatureVerified });
  if (result.error) return res.status(401).json(result);
  const token = store.createSession(result.address);
  res.json({ ...store.withoutPassword(result), token });
});

app.get('/api/player/:address', (req, res) => {
  const p = store.safeProfile(req.params.address);
  if (!p) return res.status(404).json({ error: 'Unknown player' });
  res.json(p);
});

app.get('/api/me', (_req, res) => {
  res.json({ note: 'Use /api/player/:address or socket identify to get a profile' });
});

// ---- Proof-of-Chore & Battle Pass Endpoints ----
app.get('/api/battlepass/tiers', (_req, res) => {
  res.json(store.BATTLE_PASS_TIERS);
});

app.get('/api/chores/:address', requireSession, (req, res) => {
  const address = req.params.address;
  const isParentOf = same(store.getPlayer(address)?.parentAddress, req.auth.address);
  if (!same(address, req.auth.address) && !isParentOf)
    return res.status(403).json({ error: 'Not your account' });
  const p = store.getPlayer(address) || store.upsertPlayer(address);
  const chores = store.getChores(address);
  const vouchers = store.getVouchers(address);
  res.json({
    kidAddress: address,
    energy: p.energy ?? 5,
    battlePassXp: p.battlePassXp ?? 0,
    battlePassTier: p.battlePassTier ?? 1,
    allowanceBalance: p.allowanceBalance ?? 0,
    parentAddress: p.parentAddress,
    tiers: store.BATTLE_PASS_TIERS,
    chores,
    vouchers,
  });
});

app.post('/api/chores/submit', requireSession, (req, res) => {
  const { kidAddress, choreId, notes } = req.body || {};
  if (!kidAddress || !choreId)
    return res.status(400).json({ error: 'kidAddress and choreId required' });
  if (!same(kidAddress, req.auth.address))
    return res.status(403).json({ error: 'You can only submit your own chores' });
  const result = store.submitChore(kidAddress, choreId, notes);
  if (result.error) return res.status(400).json(result);
  const p = store.getPlayer(kidAddress);
  if (p?.parentAddress) {
    notifyPlayer(p.parentAddress, 'chore:submitted', result);
  }
  notifyPlayer(kidAddress, 'chore:updated', result);
  res.json(result);
});

app.post('/api/chores/verify', requireSession, async (req, res) => {
  const { choreId, parentAddress, signature, message } = req.body || {};
  if (!choreId || !parentAddress)
    return res.status(400).json({ error: 'choreId and parentAddress required' });

  // Only the linked parent account, or the kid's session after the Parent PIN, may approve.
  const target = store.getChoreById(choreId);
  if (!target) return res.status(404).json({ error: 'Chore not found' });
  if (!canAdminister(req.auth, target.kidAddress)) {
    return res.status(403).json({
      error: 'Parent approval required (link a parent account or unlock with the Parent PIN)',
    });
  }

  // If signed attestation provided, verify it
  if (signature && message) {
    const valid = verifyParentAttestation(signature, parentAddress, message);
    if (!valid) return res.status(401).json({ error: 'Invalid parent oracle signature' });
  }

  const result = store.verifyChore(choreId, parentAddress);
  if (result.error) return res.status(400).json(result);

  // Record on-chain or to simulated proof ledger
  let onchainRecord = null;
  try {
    onchainRecord = await recordChoreVerification({
      choreId: result.chore.id,
      kidAddress: result.chore.kidAddress,
      parentAddress,
      title: result.chore.title,
      category: result.chore.category,
      energyGranted: result.chore.energyReward,
      allowanceGranted: result.chore.allowanceReward,
    });
  } catch (err) {
    console.warn('Chore verification record warning:', err.message);
  }

  const kid = store.getPlayer(result.chore.kidAddress);
  if (kid) {
    notifyPlayer(result.chore.kidAddress, 'player:update', store.withoutPassword(kid));
    notifyPlayer(result.chore.kidAddress, 'chore:verified', { ...result, onchainRecord });
    if (result.unlockedSkin) {
      notifyPlayer(result.chore.kidAddress, 'skin:unlocked', {
        skin: result.unlockedSkin,
        message: `🎉 Your parent verified your chore! You unlocked the '${result.unlockedSkin.name}' skin!`,
      });
    }
  }
  notifyPlayer(parentAddress, 'chore:verified', { ...result, onchainRecord });

  res.json({ ...result, onchainRecord });
});

app.post('/api/chores/create', requireSession, (req, res) => {
  const { kidAddress, parentAddress, title, category, energyReward, xpReward, allowanceReward } =
    req.body || {};
  if (!kidAddress || !title)
    return res.status(400).json({ error: 'kidAddress and title required' });
  if (!canAdminister(req.auth, kidAddress))
    return res.status(403).json({ error: 'Parent approval required' });
  const cleanTitle = String(title).trim().slice(0, 100);
  if (!cleanTitle) return res.status(400).json({ error: 'Valid title required' });
  const cleanCategory = String(category || 'custom')
    .trim()
    .slice(0, 30);
  const safeEnergy = Math.max(1, Math.min(5, Math.floor(Number(energyReward) || 2)));
  const safeXp = Math.max(10, Math.min(100, Math.floor(Number(xpReward) || 40)));
  const safeAllowance = Math.max(
    0,
    Math.min(20, Math.round((Number(allowanceReward) || 5) * 100) / 100)
  );

  const chore = store.createCustomChore({
    kidAddress,
    parentAddress,
    title: cleanTitle,
    category: cleanCategory,
    energyReward: safeEnergy,
    xpReward: safeXp,
    allowanceReward: safeAllowance,
  });
  notifyPlayer(kidAddress, 'chore:created', chore);
  res.json(chore);
});

app.post('/api/chores/quiz-complete', requireSession, (req, res) => {
  const { kidAddress, score } = req.body || {};
  if (!kidAddress) return res.status(400).json({ error: 'kidAddress required' });
  if (!same(kidAddress, req.auth.address))
    return res.status(403).json({ error: 'Not your account' });
  if (score < 4)
    return res.status(400).json({ error: 'Need at least 4/5 correct answers to pass' });
  const result = store.completeBrainQuiz(kidAddress);
  if (result.error) return res.status(400).json(result);
  const updated = store.getPlayer(kidAddress);
  if (updated) {
    notifyPlayer(kidAddress, 'player:update', store.withoutPassword(updated));
  }
  res.json(result);
});

app.post('/api/parent/link', requireSession, (req, res) => {
  const { kidAddress, parentAddress } = req.body || {};
  if (!kidAddress || !parentAddress)
    return res.status(400).json({ error: 'kidAddress and parentAddress required' });
  // Either the kid links their parent, or a parent claims a kid that has no parent yet.
  const kidSelf = same(kidAddress, req.auth.address);
  const parentSelf = same(parentAddress, req.auth.address);
  const existing = store.getPlayer(kidAddress);
  if (!kidSelf && !(parentSelf && existing && !existing.parentAddress)) {
    return res.status(403).json({ error: 'Cannot link this account' });
  }
  const kid = store.linkParent(kidAddress, parentAddress);
  if (kid) {
    notifyPlayer(kid.address, 'player:update', store.withoutPassword(kid));
    notifyPlayer(kid.address, 'parent:linked', { parentAddress });
  }
  res.json(store.withoutPassword(kid));
});

app.get('/api/parent/:parentAddress/dashboard', requireSession, (req, res) => {
  // Only return kids/chores this session may administer, whatever address was asked for.
  const data = store.getParentKids(req.params.parentAddress);
  res.json({
    kids: data.kids.filter((k) => canAdminister(req.auth, k.address)),
    pendingChores: data.pendingChores.filter((c) => canAdminister(req.auth, c.kidAddress)),
  });
});

app.post('/api/vouchers/redeem', requireSession, (req, res) => {
  const { voucherId, parentAddress } = req.body || {};
  if (!voucherId) return res.status(400).json({ error: 'voucherId required' });
  const voucher = store.getVoucherById(voucherId);
  if (!voucher) return res.status(404).json({ error: 'Voucher not found' });
  if (!canAdminister(req.auth, voucher.kidAddress))
    return res.status(403).json({ error: 'Parent approval required' });
  const result = store.redeemVoucher(voucherId, parentAddress);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ---- Skin & Parent PIN Endpoints ----

app.get('/api/skins/:address', (req, res) => {
  const skins = store.getSkins(req.params.address);
  res.json(skins);
});

app.post('/api/skins/equip', requireSession, (req, res) => {
  const { address, skinId } = req.body || {};
  if (!address || !skinId) return res.status(400).json({ error: 'address and skinId required' });
  if (!same(address, req.auth.address)) return res.status(403).json({ error: 'Not your account' });
  const result = store.equipSkin(address, skinId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// The Parent PIN belongs to the logged-in account (never a shared "default"), and a
// correct PIN unlocks parent actions for this login session for 15 minutes.
app.post('/api/parent/verify-pin', requireSession, (req, res) => {
  const result = store.verifyParentPin(req.auth.address, req.body?.pin);
  if (result.ok) unlockParent(req.auth.token);
  res.json(result);
});

app.post('/api/parent/set-pin', (req, res) => {
  const header = req.headers.authorization || '';
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const { address, pin, signature, token, currentPin } = req.body || {};
  const effectiveToken = bearerToken || token;
  const sessionAddress = effectiveToken ? store.addressForSession(effectiveToken) : null;
  const targetAddress = sessionAddress || address;

  if (!targetAddress || !pin) return res.status(400).json({ error: 'address and pin required' });

  // Verify authorization: valid session token, valid wallet signature, or verified current PIN
  let authorized = false;
  if (effectiveToken && sessionAddress && same(sessionAddress, targetAddress)) {
    if (
      !store.hasParentPin(targetAddress) ||
      isParentUnlocked(effectiveToken) ||
      (currentPin && store.verifyParentPin(targetAddress, currentPin).ok)
    ) {
      authorized = true;
    }
  } else if (signature && verifyAuthSignature(signature, targetAddress)) {
    authorized = true;
  } else if (currentPin && store.verifyParentPin(targetAddress, currentPin).ok) {
    authorized = true;
  }

  if (!authorized) {
    return res.status(401).json({
      error:
        'Authentication required: provide correct current PIN, session token, or wallet signature',
    });
  }

  const result = store.setParentPin(targetAddress, pin);
  if (result.error) return res.status(400).json(result);
  if (req.auth?.token) unlockParent(req.auth.token);
  else if (effectiveToken) unlockParent(effectiveToken);
  res.json(result);
});

// ---- Helpers ----

/**
 * Serializes room metadata and active game state for client transmission.
 *
 * @function serializeRoom
 * @param {Object} room - Active room object.
 * @returns {Object} Public sanitized room representation.
 */
function serializeRoom(room) {
  return {
    roomId: room.id,
    gameType: room.gameType,
    difficulty: room.difficulty || room.game.difficulty || 'medium',
    deck: room.game.deck || null,
    names: room.names,
    game: room.engine.serialize(room.game),
  };
}

/**
 * Broadcasts latest game state to all players and spectators subscribed to the room's socket room.
 * Persists room snapshot to SQLite and rearms round deadlines.
 *
 * @function broadcastState
 * @param {Object} room - Active room object.
 */
function broadcastState(room) {
  io.to(room.id).emit('game:state', { roomId: room.id, game: room.engine.serialize(room.game) });
  store.saveActiveRoom(room);
  armRoundTimer(room);
}

/**
 * Server-enforced deadline for timed engines (e.g. Math Arena).
 * Only fires if players idle past the deadline, preventing matches from freezing.
 *
 * @function armRoundTimer
 * @param {Object} room - Active room object.
 */
function armRoundTimer(room) {
  clearTimeout(room.roundTimer);
  if (room.mathTimer) clearTimeout(room.mathTimer);
  room.roundTimer = null;
  const timeoutMs = room.engine.ROUND_MS || (room.gameType === 'math-arena' ? 12000 : null);
  if (!timeoutMs || room.game.winner) return;
  const armedRound = room.game.round;
  room.roundTimer = setTimeout(() => {
    room.roundTimer = null;
    if (room.game.winner || room.game.round !== armedRound) return;
    if (room.engine.timeoutRound) room.engine.timeoutRound(room.game);
    else if (room.engine.timeoutMove) room.engine.timeoutMove(room.game);
    broadcastState(room);
    afterEngineMove(room);
  }, timeoutMs);
  room.mathTimer = room.roundTimer;
}

/**
 * Emits active public matches and spectator counts to connected clients in the lobby.
 *
 * @function broadcastLiveRooms
 */
function broadcastLiveRooms() {
  if (!liveListeners.size) return;
  const list = [...rooms.values()]
    .filter((r) => !r.game.winner && !r.private)
    .map((r) => ({
      roomId: r.id,
      gameType: r.gameType,
      players: r.names,
      spectators: r.spectators.size,
    }));
  for (const sid of liveListeners) io.to(sid).emit('rooms:list', list);
}

/**
 * Finalizes a finished game match:
 * 1. Records match result on blockchain (or simulated ledger).
 * 2. Awards experience points, tokens, and unlocks achievement badges.
 * 3. Mints on-chain ARENA tokens and ERC-1155 badges for human winners.
 * 4. Archives replay data to SQLite and notifies participants via WebSockets.
 *
 * @async
 * @function finishRoom
 * @param {Object} room - Finished room object.
 */
async function finishRoom(room) {
  if (room.tickInterval) clearInterval(room.tickInterval);
  if (room.mathTimer) clearTimeout(room.mathTimer);
  clearTimeout(room.roundTimer);
  room.roundTimer = null;
  const { game } = room;
  const addrX = game.players.X;
  const addrO = game.players.O;
  const winnerAddr = game.winner === 'X' ? addrX : game.winner === 'O' ? addrO : null;

  // Record on-chain (simulated ledger, or real MatchResult.sol via chain-onchain.js)
  // The returned receipt is normalized by chain-onchain.js. When on-chain
  // recording is enabled, it includes matchIdRaw as the exact bytes32 stored
  // on-chain. When recording falls back to the simulated ledger, matchIdRaw is
  // the same as matchId.
  let receipt = null;
  try {
    receipt = await defaultRecorder.recordMatch({
      matchId: room.id,
      gameType: room.gameType,
      players: { X: addrX, O: addrO },
      winner: winnerAddr || 'draw',
      moves: game.moves,
    });
  } catch (err) {
    // Real blockchain only: no simulated fallback. The match still ends for the
    // players, but the receipt carries the error and has no txHash.
    console.error('ON-CHAIN RECORDING FAILED for', room.id, '-', err.shortMessage || err.message);
    receipt = {
      matchId: room.id,
      gameType: room.gameType,
      players: { X: addrX, O: addrO },
      winner: winnerAddr || 'draw',
      timestamp: Date.now(),
      error: err.shortMessage || err.message,
    };
  }

  // Update stats for human players and compute on-chain reward deltas
  const rewards = [];
  for (const addr of [addrX, addrO]) {
    if (addr === BOT) continue;
    const before = store.getPlayer(addr);
    const result = winnerAddr === null ? 'draw' : addr === winnerAddr ? 'win' : 'loss';
    const profile = store.applyResult(addr, result, {
      gameType: room.gameType,
      deck: room.game.deck,
      daily: !!room.game.deck && room.game.deck === dailyDeckId(),
    });
    const beforeBadges = before?.badges || [];
    rewards.push({
      address: addr,
      tokens: profile.tokens - (before?.tokens ?? 0),
      badges: profile.badges
        .filter((b) => !beforeBadges.some((x) => x.id === b.id))
        .map((b) => ({ id: store.badgeNumericId(b.id), label: b.label }))
        .filter((b) => b.id != null),
    });
    const sid = room.sockets[addr];
    if (sid) io.to(sid).emit('player:update', profile);
    // DB-only update: profile, stats, badges. The on-chain reward is handled
    // separately by distributeRewards().
  }

  // Archive the match for replays (full move list + final layout)
  store.saveMatch({
    matchId: room.id,
    gameType: room.gameType,
    deck: room.game.deck || null,
    players: { X: addrX, O: addrO },
    names: room.names,
    layout:
      room.gameType === 'memory'
        ? room.game.cards.map((c) => ({ pairId: c.pairId, content: c.content }))
        : null,
    result: game.winner,
    winner: winnerAddr,
    moves: game.moves,
  });

  // Mint ARENA tokens + newly earned badges on-chain (simulated when not configured,
  // or when mints fail — always fail open so the match result still reaches players).
  // This is the on-chain reward path. It is separate from the DB stats update.
  // The server wallet is the trusted minter in ArenaToken.sol / ArenaBadges.sol.
  let rewardReceipts = null;
  try {
    rewardReceipts = await distributeRewards(rewards);
  } catch (err) {
    console.warn('On-chain reward distribution failed:', err.message);
  }

  io.to(room.id).emit('match:end', {
    roomId: room.id,
    winner: winnerAddr,
    result: game.winner,
    receipt: { ...receipt, onchain: defaultRecorder.isOnchain() && !receipt?.error, rewards: rewardReceipts },
  });
  // Clean up persisted active room and memory
  store.removeActiveRoom(room.id);
  // Free finished rooms after a grace period so the map does not grow forever.
  setTimeout(() => rooms.delete(room.id), ROOM_RETENTION_MS);
  broadcastLiveRooms();
}

/**
 * Schedules round timeout enforcement for Math Arena simultaneous rounds.
 *
 * @function scheduleMathRoundTimer
 * @param {Object} room - Active room object.
 */
function scheduleMathRoundTimer(room) {
  if (room.mathTimer) clearTimeout(room.mathTimer);
  if (room.game.winner) return;
  const currentRound = room.game.round;
  room.mathTimer = setTimeout(() => {
    const r = rooms.get(room.id);
    if (!r || r.game.winner || r.game.round !== currentRound) return;
    if (!r.game.answered.X || !r.game.answered.O) {
      if (r.engine.timeoutRound) {
        r.engine.timeoutRound(r.game);
        broadcastState(r);
        afterEngineMove(r);
      }
    }
  }, 12000);
}

/**
 * Advances game lifecycle following a move: handles transient resolution steps,
 * triggers bot AI responses, and completes finished matches.
 *
 * @function afterEngineMove
 * @param {Object} room - Active room object.
 * @param {Object} [res] - Move result containing optional pendingMs.
 */
function afterEngineMove(room, res) {
  if (room.game.winner) return finishRoom(room);
  if (room.gameType === 'math-arena') {
    scheduleMathRoundTimer(room);
  }
  if (res?.pendingMs && room.engine.resolve) {
    setTimeout(() => {
      if (room.game.winner) return;
      room.engine.resolve(room.game);
      broadcastState(room);
      afterEngineMove(room);
    }, res.pendingMs);
    return;
  }
  // Turn-based games: move when it is the bot's turn. Simultaneous games
  // (Math Arena): the bot can lock its answer at any point in the round.
  const botHasTurn = room.game.players[room.game.turn] === BOT;
  const botUnanswered =
    !!room.game.answered && room.game.players.O === BOT && !room.game.answered.O;
  if (botHasTurn || botUnanswered) {
    setTimeout(() => botStep(room.id), BOT_STEP_MS);
  }
}

/**
 * Executes a calculated bot AI turn step against an active room.
 *
 * @function botStep
 * @param {string} roomId - Room identifier.
 */
function botStep(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.game.winner) return;
  const botHasTurn = room.game.players[room.game.turn] === BOT;
  const botUnanswered =
    !!room.game.answered && room.game.players.O === BOT && !room.game.answered.O;
  if (!botHasTurn && !botUnanswered) return;
  const res = room.engine.applyMove(room.game, BOT, room.engine.botMove(room.game));
  broadcastState(room);
  afterEngineMove(room, res);
}

/**
 * Initializes a new multiplayer or bot game room with the appropriate game engine,
 * registers socket listeners, initializes game physics or timers, and notifies players.
 *
 * @function createRoom
 * @param {string} gameType - Key of selected game engine.
 * @param {string} addrX - Player 1 (X) wallet address.
 * @param {string} addrO - Player 2 (O) wallet address.
 * @param {(addr: string) => Object} getSocket - Callback retrieving active socket for address.
 * @param {Object} [opts={}] - Optional game settings (difficulty, deck, skins).
 * @returns {Object} Created room instance.
 */
function createRoom(gameType, addrX, addrO, getSocket, opts = {}) {
  const engine = ENGINES[gameType];
  const id = 'match_' + crypto.randomBytes(6).toString('hex');
  const difficulty = ['easy', 'medium', 'hard'].includes(opts?.difficulty)
    ? opts.difficulty
    : 'medium';
  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  const botName = `ArenaBot (${diffLabel})`;

  const skinX = store.getEquippedSkin(addrX)?.id || 'neon-striker';
  const skinO =
    addrO === BOT
      ? opts?.skinO || 'crimson-phoenix'
      : store.getEquippedSkin(addrO)?.id || 'neon-striker';

  const room = {
    id,
    gameType,
    difficulty,
    engine,
    game: engine.createGame(addrX, addrO, { ...opts, difficulty, skins: { X: skinX, O: skinO } }),
    sockets: {},
    names: { [BOT]: botName },
    spectators: new Set(),
    chat: [],
    private: !!opts.private,
  };
  rooms.set(id, room);
  store.saveActiveRoom(room);
  for (const addr of [addrX, addrO]) {
    if (addr && addr !== BOT) {
      store.consumeEnergy(addr, ENERGY_CONFIG.MATCH_COST);
    }
    const s = getSocket(addr);
    if (s) {
      room.sockets[addr] = s.id;
      const p = store.getPlayer(addr);
      room.names[addr] = p?.name;
      s.join(id);
      s.emit('match:start', serializeRoom(room));
      if (p) {
        s.emit('player:update', store.withoutPassword(p));
      }
    }
  }

  // Real-time tick loop for Cyber Blaster
  if (gameType === 'cyber-blaster') {
    room.tickInterval = setInterval(() => {
      if (room.game.winner) {
        clearInterval(room.tickInterval);
        return;
      }
      if (room.game.players.O === BOT) {
        const bMove = room.engine.botMove(room.game, room.difficulty);
        if (bMove) room.engine.applyMove(room.game, BOT, bMove);
      }
      room.engine.tick(room.game, 40);
      const tickData = room.engine.serializeTick
        ? room.engine.serializeTick(room.game)
        : room.engine.serialize(room.game);
      io.to(room.id).emit('blaster:tick', tickData);
      if (room.game.winner) {
        clearInterval(room.tickInterval);
        finishRoom(room);
      }
    }, 40);
  }

  // Authoritative round timer for Neon Math Arena
  if (gameType === 'math-arena') {
    scheduleMathRoundTimer(room);
  }

  broadcastLiveRooms();
  armRoundTimer(room); // first round starts now — no broadcastState happened yet
  return room;
}

/**
 * Automatically forfeits any live game match if a participating player leaves or disconnects.
 * Declares the remaining opponent as the winner and finalizes match on-chain.
 *
 * @function maybeForfeit
 * @param {import('socket.io').Socket} socket - Disconnecting player socket.
 */
function maybeForfeit(socket) {
  for (const room of rooms.values()) {
    if (room.game.winner) continue;
    const addr = Object.keys(room.sockets).find((a) => room.sockets[a] === socket.id);
    if (!addr) continue;
    const seat = room.game.players.X === addr ? 'X' : room.game.players.O === addr ? 'O' : null;
    if (!seat) continue;
    room.game.winner = seat === 'X' ? 'O' : 'X';
    broadcastState(room);
    finishRoom(room);
  }
}

// ---- Socket.IO ----
// The on-chain module is intentionally disconnected from game logic. It only
// records finished matches and distributes rewards. Game state, matchmaking,
// chat, and spectators remain server-side.
// Playing requires a registered account. Guests may connect and register/log in,
// but cannot queue, create/join rooms or start bot matches.

/**
 * Validates that a connected socket has authenticated as a registered player.
 * Emits an AUTH_REQUIRED error if the socket is unauthenticated or unregistered.
 *
 * @function accountOf
 * @param {import('socket.io').Socket} socket - Client socket.
 * @returns {string | null} Authenticated player wallet address or null.
 */
function accountOf(socket) {
  const address = socketPlayer.get(socket.id);
  if (address && store.isRegistered(address)) return address;
  socket.emit('player:error', {
    error: 'Log in or create an account to play.',
    code: 'AUTH_REQUIRED',
  });
  return null;
}

/**
 * Binds an authenticated Ethereum wallet address to a socket session,
 * syncing player profile, registration status, and username metadata to the client.
 *
 * @function bindIdentity
 * @param {import('socket.io').Socket} socket - Client socket connection.
 * @param {string} address - Authenticated player address.
 */
function bindIdentity(socket, address) {
  socketPlayer.set(socket.id, address);
  const profile = store.getPlayer(address);
  if (profile) socket.emit('player:update', store.withoutPassword(profile));
  const registered = store.isRegistered(address);
  socket.emit('player:registered', registered);
  if (registered) {
    socket.emit('player:registered:user', {
      address,
      username: profile.username,
      name: profile.name,
    });
  }
}

// Throttle password guessing: 8 failed logins per IP in 10 minutes.
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const loginFails = new Map(); // ip -> { count, resetAt }
const loginBlocked = (ip) => {
  const f = loginFails.get(ip);
  if (!f || Date.now() > f.resetAt) {
    loginFails.delete(ip);
    return false;
  }
  return f.count >= LOGIN_MAX_FAILS;
};
const noteLoginFail = (ip) => {
  const f = loginFails.get(ip);
  if (!f || Date.now() > f.resetAt)
    loginFails.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  else f.count += 1;
};

// Chat rate limiting (max 1 message per 800ms per connection)
const socketChatTimes = new Map(); // socketId -> timestamp

/**
 * Enforces per-socket chat rate limiting (maximum 1 message per 800ms).
 *
 * @function isChatRateLimited
 * @param {string} socketId - Client socket ID.
 * @returns {boolean} True if client is rate-limited.
 */
function isChatRateLimited(socketId) {
  const now = Date.now();
  const last = socketChatTimes.get(socketId) || 0;
  if (now - last < 800) return true;
  socketChatTimes.set(socketId, now);
  return false;
}

// Global crash protection against malformed event unhandled exceptions
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception caught safely:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Rejection caught safely:', reason);
});

io.on('connection', (socket) => {
  liveListeners.add(socket.id);

  // Two ways to identify: a session token (after login/registration, works from
  // any browser) or a wallet signature (guest wallets, MetaMask).
  socket.on('identify', ({ address, signature, issuedAt, token } = {}) => {
    if (token) {
      const sessionAddress = store.addressForSession(token);
      if (!sessionAddress) return socket.emit('auth:expired');
      bindIdentity(socket, sessionAddress);
      // Auto-resume active match on reconnect/refresh/restart
      for (const room of rooms.values()) {
        if (
          !room.game.winner &&
          (room.game.players.X === sessionAddress || room.game.players.O === sessionAddress)
        ) {
          room.sockets[sessionAddress] = socket.id;
          socket.join(room.id);
          socket.emit('match:resumed', serializeRoom(room));
          socket.emit('game:state', { roomId: room.id, game: room.engine.serialize(room.game) });
          break;
        }
      }
      return;
    }
    if (!address)
      return socket.emit('player:error', { error: 'Not identified: no address provided' });
    if (!signature || typeof signature !== 'string' || !signature.trim())
      return socket.emit('player:error', { error: 'Not identified: signature required' });
    if (!verifyAuthSignature(signature, address, issuedAt))
      return socket.emit('player:error', { error: 'Not identified: invalid or expired signature' });
    bindIdentity(socket, address);

    // Auto-resume active match on reconnect/refresh/restart
    for (const room of rooms.values()) {
      if (
        !room.game.winner &&
        (room.game.players.X === address || room.game.players.O === address)
      ) {
        room.sockets[address] = socket.id;
        socket.join(room.id);
        socket.emit('match:resumed', serializeRoom(room));
        socket.emit('game:state', { roomId: room.id, game: room.engine.serialize(room.game) });
        break;
      }
    }
  });

  const authSuccess = (result) => {
    const token = store.createSession(result.address);
    socket.emit('auth:success', {
      address: result.address,
      username: result.username,
      name: result.name,
      token,
    });
  };

  // Register a new player identity (wallet + username + password + optional email)
  socket.on('player:register', async ({ username, name, email, password } = {}) => {
    const address = socketPlayer.get(socket.id);
    if (!address) return socket.emit('player:error', { error: 'Not identified' });
    const result = await store.registerPlayer(address, { name, username, email, password });
    if (result.error)
      return socket.emit('player:error', { error: result.error, conflict: result.conflict });
    bindIdentity(socket, result.address);
    authSuccess(result);
  });

  // Log in by username + password (wallet resolved from the username index).
  socket.on('player:loginByCredentials', async ({ username, password } = {}) => {
    const ip = socket.handshake.address;
    if (loginBlocked(ip))
      return socket.emit('player:error', {
        error: 'Too many failed attempts. Try again in a few minutes.',
      });
    const result = await store.loginPlayerByCredentials({ username, password });
    if (result.error) {
      noteLoginFail(ip);
      return socket.emit('player:error', { error: result.error });
    }
    loginFails.delete(ip);
    bindIdentity(socket, result.address);
    authSuccess(result);
  });

  socket.on('auth:logout', ({ token } = {}) => {
    store.deleteSession(token);
    socketPlayer.delete(socket.id);
    dropPendingFor(socket.id);
    const i = queue.findIndex((q) => q.socketId === socket.id);
    if (i !== -1) queue.splice(i, 1);
    socket.emit('player:registered', false);
  });

  // Log in / claim an existing wallet as a registered identity.
  // - Registered wallet: no-op lookup, returns profile.
  // - Unregistered wallet: requires `username` (+ optional `password`) to claim it.
  //   If `password` is supplied on an already-registered wallet, it is verified.
  socket.on('player:login', async ({ username, name, password } = {}) => {
    const address = socketPlayer.get(socket.id);
    if (!address) return socket.emit('player:error', { error: 'Not identified' });
    const result = await store.loginPlayer(address, { username, name, password });
    if (result.error) return socket.emit('player:error', { error: result.error });
    socket.emit('player:update', store.withoutPassword(result));
    socket.emit('player:registered', !!result.registered);
    socket.emit('player:registered:user', {
      address: result.address,
      username: result.username,
      name: result.name,
    });
  });

  socket.on('queue:join', ({ gameType, deck, inviteCode } = {}) => {
    const address = accountOf(socket);
    if (!address) return;
    const type = ENGINES[gameType] ? gameType : 'memory';
    if (!address || queue.some((q) => q.socketId === socket.id)) return;
    const p = store.getPlayer(address) || store.upsertPlayer(address);
    if ((p.energy ?? 5) <= 0) {
      return socket.emit('match:error', {
        error: '⚡ Out of Arena Energy! Complete a chore or pass the Brain Quiz to earn Energy.',
        needsEnergy: true,
      });
    }
    dropPendingFor(socket.id);
    const cleanInvite = inviteCode ? String(inviteCode).trim().toUpperCase().slice(0, 8) : null;
    queue.push({ socketId: socket.id, gameType: type, deck, inviteCode: cleanInvite });
    socket.emit('queue:waiting', { gameType: type, inviteCode: cleanInvite });

    // Pair the first two players waiting for the same game & invite code
    const peers = queue.filter(
      (q) => q.gameType === type && (cleanInvite ? q.inviteCode === cleanInvite : !q.inviteCode)
    );
    if (peers.length >= 2) {
      const [a, b] = peers;
      const addrA = socketPlayer.get(a.socketId);
      const addrB = socketPlayer.get(b.socketId);
      const pA = store.getPlayer(addrA);
      const pB = store.getPlayer(addrB);
      if ((pA?.energy ?? 5) <= 0) {
        queue.splice(queue.indexOf(a), 1);
        const sockA = io.sockets.sockets.get(a.socketId);
        if (sockA)
          sockA.emit('match:error', { error: '⚡ Out of Arena Energy!', needsEnergy: true });
        return;
      }
      if ((pB?.energy ?? 5) <= 0) {
        queue.splice(queue.indexOf(b), 1);
        const sockB = io.sockets.sockets.get(b.socketId);
        if (sockB)
          sockB.emit('match:error', { error: '⚡ Out of Arena Energy!', needsEnergy: true });
        return;
      }
      for (const p of peers.slice(0, 2)) {
        queue.splice(queue.indexOf(p), 1);
      }
      const sockA = io.sockets.sockets.get(a.socketId);
      const sockB = io.sockets.sockets.get(b.socketId);
      if (!sockA || !sockB) return;
      createRoom(
        type,
        addrA,
        addrB,
        (addr) => [sockA, sockB].find((s) => socketPlayer.get(s.id) === addr),
        { deck: a.deck }
      );
    }
  });

  // Also cancels a waiting private room — pages emit this when the player leaves.
  socket.on('queue:leave', () => {
    const i = queue.findIndex((q) => q.socketId === socket.id);
    if (i !== -1) queue.splice(i, 1);
    dropPendingFor(socket.id);
  });

  // ---- Private rooms: host gets a short code, a friend joins with it ----
  socket.on('room:create', ({ gameType, deck, pairs } = {}) => {
    const address = accountOf(socket);
    if (!address) return;
    const type = ENGINES[gameType] ? gameType : 'memory';
    const qi = queue.findIndex((q) => q.socketId === socket.id);
    if (qi !== -1) queue.splice(qi, 1);
    dropPendingFor(socket.id); // one waiting room per player
    const code = makeRoomCode();
    const timer = setTimeout(() => {
      pendingRooms.delete(code);
      io.to(socket.id).emit('room:expired', { code });
    }, PENDING_ROOM_MS);
    pendingRooms.set(code, {
      code,
      gameType: type,
      deck,
      pairs,
      hostSocketId: socket.id,
      hostAddr: address,
      timer,
    });
    socket.emit('room:waiting', { code, gameType: type });
  });

  socket.on('room:join', ({ code } = {}) => {
    const address = accountOf(socket);
    if (!address) return;
    const key = String(code || '')
      .trim()
      .toUpperCase();
    const pending = pendingRooms.get(key);
    if (!pending)
      return socket.emit('player:error', {
        error: 'Room not found. Check the code and try again.',
      });
    if (pending.hostAddr === address)
      return socket.emit('player:error', {
        error: 'That is your own room — share the code with a friend.',
      });
    const hostSocket = io.sockets.sockets.get(pending.hostSocketId);
    if (!hostSocket) {
      dropPendingRoom(key);
      return socket.emit('player:error', { error: 'The host has left this room.' });
    }
    dropPendingRoom(key);
    const qi = queue.findIndex((q) => q.socketId === socket.id);
    if (qi !== -1) queue.splice(qi, 1);
    dropPendingFor(socket.id);
    createRoom(
      pending.gameType,
      pending.hostAddr,
      address,
      (addr) => [hostSocket, socket].find((s) => socketPlayer.get(s.id) === addr),
      { deck: pending.deck, pairs: pending.pairs, private: true }
    );
  });

  socket.on('match:bot', ({ gameType, deck, pairs, difficulty } = {}) => {
    const address = accountOf(socket);
    const type = ENGINES[gameType] ? gameType : 'memory';
    if (!address) return;
    const p = store.getPlayer(address) || store.upsertPlayer(address);
    if ((p.energy ?? 5) <= 0) {
      return socket.emit('match:error', {
        error: '⚡ Out of Arena Energy! Complete a chore or pass the Brain Quiz to earn Energy.',
        needsEnergy: true,
      });
    }
    const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    const room = createRoom(type, address, BOT, (addr) => (addr === address ? socket : null), {
      deck,
      pairs,
      difficulty: diff,
    });
    // If the bot ever has the first turn, drive it
    afterEngineMove(room);
  });

  socket.on('chores:get', ({ kidAddress } = {}, ack) => {
    const target = kidAddress || socketPlayer.get(socket.id);
    if (!target) return ack?.({ error: 'No address' });
    const p = store.getPlayer(target) || store.upsertPlayer(target);
    const chores = store.getChores(target);
    const vouchers = store.getVouchers(target);
    const payload = {
      kidAddress: target,
      energy: p.energy ?? 5,
      battlePassXp: p.battlePassXp ?? 0,
      battlePassTier: p.battlePassTier ?? 1,
      allowanceBalance: p.allowanceBalance ?? 0,
      parentAddress: p.parentAddress,
      tiers: store.BATTLE_PASS_TIERS,
      chores,
      vouchers,
    };
    if (ack) ack(payload);
    else socket.emit('chores:data', payload);
  });

  socket.on('game:move', (payload = {}) => {
    const { roomId, ...move } = payload || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    const address = socketPlayer.get(socket.id);
    if (!room || !address) return;
    const res = room.engine.applyMove(room.game, address, move);
    if (res.error) return socket.emit('game:error', res.error);
    broadcastState(room);
    afterEngineMove(room, res);
  });

  socket.on('blaster:input', (payload = {}) => {
    const { roomId, ...move } = payload || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    const address = socketPlayer.get(socket.id);
    if (!room || !address || room.game.winner) return;
    room.engine.applyMove(room.game, address, { type: 'input', ...move });
  });

  socket.on('skins:get', ({ address } = {}, ack) => {
    const target = address || socketPlayer.get(socket.id);
    const skins = store.getSkins(target);
    if (typeof ack === 'function') ack(skins);
    else socket.emit('skins:list', skins);
  });

  socket.on('skins:equip', (payload = {}, ack) => {
    const { skinId } = payload || {};
    const addr = socketPlayer.get(socket.id);
    if (!addr) return ack && ack({ error: 'Identify required' });
    const res = store.equipSkin(addr, skinId);
    if (ack) ack(res);
    if (res.ok) {
      socket.emit('player:update', store.withoutPassword(res.player));
    }
  });

  socket.on('spectate', (payload = {}) => {
    const { roomId } = payload || {};
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.private) {
      return socket.emit('player:error', { error: 'Cannot spectate a private match.' });
    }
    room.spectators.add(socket.id);
    socket.join(roomId);
    socket.emit('match:start', serializeRoom(room)); // spectator joins mid-game
    broadcastLiveRooms();
  });

  registerChatHandlers(socket, { io, rooms, socketPlayer, lobbyChat, isChatRateLimited });

  socket.on('room:reconnect', (payload = {}, ack) => {
    const { roomId } = payload || {};
    const room = rooms.get(roomId);
    if (!room) return ack?.({ error: 'Room not found or match already concluded' });
    const address = socketPlayer.get(socket.id);
    if (address && (room.game.players.X === address || room.game.players.O === address)) {
      room.sockets[address] = socket.id;
    }
    socket.join(room.id);
    socket.emit('match:start', serializeRoom(room));
    socket.emit('game:state', { roomId: room.id, game: room.engine.serialize(room.game) });
    ack?.({ ok: true, room: serializeRoom(room) });
  });

  socket.on('match:leave', (payload = {}) => {
    const { roomId } = payload || {};
    if (roomId) socket.leave(roomId);
    const room = rooms.get(roomId);
    if (room) room.spectators.delete(socket.id);
    maybeForfeit(socket); // a player leaving mid-match loses the match
    broadcastLiveRooms();
  });

  socket.on('rooms:list', () => broadcastLiveRooms());

  socket.on('disconnect', () => {
    const i = queue.findIndex((q) => q.socketId === socket.id);
    if (i !== -1) queue.splice(i, 1);
    dropPendingFor(socket.id);
    maybeForfeit(socket);
    socketPlayer.delete(socket.id);
    socketChatTimes.delete(socket.id);
    liveListeners.delete(socket.id);
  });
});

/**
 * Restores in-flight active game rooms and loops from SQLite on server startup,
 * maintaining gameplay continuity across server redeployments or restarts.
 *
 * @function restoreActiveRooms
 */
function restoreActiveRooms() {
  store.cleanupStaleActiveRooms(30 * 60 * 1000);
  const saved = store.listActiveRooms();
  for (const r of saved) {
    const engine = ENGINES[r.gameType];
    if (!engine || r.game.winner) {
      store.removeActiveRoom(r.roomId);
      continue;
    }
    const room = {
      id: r.roomId,
      gameType: r.gameType,
      difficulty: r.game.difficulty || 'medium',
      engine,
      deck: r.deck,
      names: r.names,
      game: r.game,
      sockets: {},
      spectators: new Set(r.spectators || []),
      chat: r.chat || [],
      createdAt: r.createdAt,
    };
    if (r.gameType === 'cyber-blaster') {
      room.tickInterval = setInterval(() => {
        if (room.game.winner) {
          clearInterval(room.tickInterval);
          return;
        }
        if (room.game.players.O === BOT) {
          const bMove = room.engine.botMove(room.game, room.difficulty);
          if (bMove) room.engine.applyMove(room.game, BOT, bMove);
        }
        room.engine.tick(room.game, 40);
        const tickData = room.engine.serializeTick
          ? room.engine.serializeTick(room.game)
          : room.engine.serialize(room.game);
        io.to(room.id).emit('blaster:tick', tickData);
        if (room.game.winner) {
          clearInterval(room.tickInterval);
          finishRoom(room);
        }
      }, 40);
    }
    if (r.gameType === 'math-arena') {
      scheduleMathRoundTimer(room);
    }
    rooms.set(room.id, room);
  }
  if (saved.length > 0) {
    console.log(`[Persistence] Restored ${rooms.size} active room(s) from SQLite on boot.`);
  }
}

restoreActiveRooms();

if (
  process.env.NODE_ENV !== 'test' &&
  process.env.REQUIRE_ONCHAIN === 'true' &&
  (!defaultRecorder.isOnchain() || !isTokensOnchain())
) {
  console.error(
    '\nReal blockchain required. Start with `npm start` (deploys contracts and sets\nMATCH_RESULT_ADDRESS / ARENA_TOKEN_ADDRESS / ARENA_BADGES_ADDRESS / NODE_HTTP_URL / PRIVATE_KEY).\n'
  );
  process.exit(1);
}

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Battle Arena server on http://localhost:${PORT}`);
    if (defaultRecorder.isOnchain()) {
      console.log('On-chain match recording ENABLED (MatchResult.sol)');
    } else {
      console.log('Match recording: simulated ledger (chain.js)');
    }
    if (isTokensOnchain()) {
      const { arenaToken, arenaBadges } = tokenAddresses();
      console.log(
        `On-chain rewards ENABLED — ArenaToken ${arenaToken}, ArenaBadges ${arenaBadges}`
      );
    } else {
      console.log(
        'Rewards: simulated only (set ARENA_TOKEN_ADDRESS/ARENA_BADGES_ADDRESS to enable)'
      );
    }
  });
}

export { server, app, io };
