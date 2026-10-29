// Web3 Battle Arena — real-time game server
// Game-agnostic rooms (engine registry), matchmaking, chat, spectators,
// on-chain (simulated) match recording, leaderboard, XP/levels/badges.

import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import crypto from 'crypto';
import { ethers } from 'ethers';

// Wallet signature verification helpers
function verifyAuthSignature(signature, address) {
  if (!signature || typeof signature !== 'string') return false;
  try {
    const recovered = ethers.verifyMessage(AUTH_MESSAGE(address), signature);
    return recovered.toLowerCase() === address.toLowerCase();
  } catch (e) {
    console.log('verifyAuthSignature failed: ' + e.message);
    return false;
  }
}

import { ENGINES, DECKS, dailyDeckId } from './games/index.js';
import { recordMatch, getLedger, isOnchain, normalizeLedgerEntry, ONCHAIN_LABELS } from './chain-onchain.js';
import { distributeRewards, isTokensOnchain, tokenAddresses, tokenBalance } from './chain-tokens.js';
import { recordChoreVerification, verifyParentAttestation, getChoreLedger, isChoreOnchain } from './chain-chore.js';
import * as store from './store.js';

const PORT = process.env.PORT || 3001;
const BOT = '0xB07000000000000000000000000000000000000B';
const BOT_STEP_MS = 700;

// Shared auth message: client (MetaMask personal_sign or local key) must sign
// exactly this string; verification is standard EIP-191 via ethers.verifyMessage.
const AUTH_MESSAGE = a => `Battle Arena login for ${a}`;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---- In-memory runtime state ----
const rooms = new Map();          // roomId -> room
const queue = [];                 // { socketId, gameType } waiting for a match
const socketPlayer = new Map();   // socketId -> address

function notifyPlayer(address, event, payload) {
  if (!address) return;
  for (const [sId, addr] of socketPlayer.entries()) {
    if (addr?.toLowerCase() === address.toLowerCase()) {
      const s = io.sockets.sockets.get(sId);
      if (s) s.emit(event, payload);
    }
  }
}
const liveListeners = new Set();  // socketIds in the lobby (for rooms:live push)

// The server uses room ids as match ids. On-chain, those are stored as bytes32.
// The on-chain module normalizes them back to strings where possible.

// ---- REST ----
app.get('/api/leaderboard', (_req, res) => res.json(store.leaderboard()));
app.get('/api/leaderboard/weekly', (_req, res) => res.json(store.leaderboardWeekly()));

// Match ledger and verification expose the normalized on-chain shape.
// matchId is the stable lookup key used by the game flow; matchIdRaw is the
// exact on-chain bytes32 for proof/debugging when it differs from matchId.

app.get('/api/replay/:matchId', (req, res) => {
  const replay = store.getReplay(req.params.matchId);
  replay ? res.json(replay) : res.status(404).json({ error: 'Match not found' });
});

app.get('/api/wallet/:address/tokens', async (req, res) => {
  try {
    if (!isTokensOnchain()) return res.json({ onchain: false, symbol: 'ARENA', balance: store.safeProfile(req.params.address)?.tokens ?? 0 });
    const balance = await tokenBalance(req.params.address);
    res.json({ onchain: true, symbol: 'ARENA', balance, addresses: tokenAddresses() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read token balance', detail: err.message });
  }
});
app.get('/api/matches', async (_req, res) => {
  try {
    res.json(await getLedger());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load match ledger', detail: err.message });
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
    const ledger = await getLedger();
    const requestedMatchId = req.params.matchId;
    // The contract stores match IDs as original room IDs (bytes32 = encoded room ID).
    // Do NOT hash the matchId here; look up the original value directly.
    // On-chain entries are normalized by chain-onchain.js; when a deployment cannot
    // recover the original matchId, matchIdRaw is the exact bytes32 stored on-chain.
    const entry = ledger.find(
      e => e.matchId === requestedMatchId || e.matchIdRaw === requestedMatchId
    );
    entry ? res.json({ valid: true, entry }) : res.status(404).json({ valid: false });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load match', detail: err.message });
  }
});
app.get('/api/decks', (_req, res) => {
  const daily = dailyDeckId();
  res.json(Object.entries(DECKS).map(([id, d]) => ({
    id,
    label: d.label,
    pairs: d.pairs.length,
    daily: id === daily,
  })));
});

// Registration / login over REST (address = wallet, passed in body)
app.post('/api/register', async (req, res) => {
  const { address, username, name, email, password, signature } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address is required' });
  // Verify wallet ownership via signed message
  if (signature) {
    if (!verifyAuthSignature(signature, address)) return res.status(401).json({ error: 'Invalid wallet signature' });
  } else {
    // Fallback: if no signature, still allow but note it's unauthenticated
    console.warn('Register without signature verification — address not cryptographically verified');
  }
  const usernameErr = store.validateUsername(username);
  if (usernameErr) return res.status(400).json({ error: usernameErr });
  const result = await store.registerPlayer(address, { name, username, email, password });
  if (result.error) return res.status(409).json(result);
  res.json(store.withoutPassword(result));
});

app.post('/api/login', async (req, res) => {
  const { address, username, name, password, signature } = req.body || {};
  // Verify wallet ownership via signed message when address is provided
  if (address && signature) {
    if (!verifyAuthSignature(signature, address)) return res.status(401).json({ error: 'Invalid wallet signature' });
  }
  // Two ways to log in:
  // 1) By credentials: username + password (wallet resolved from username index).
  if (username && password) {
    const result = await store.loginPlayerByCredentials({ username, password });
    if (result.error) return res.status(401).json(result);
    res.json(store.withoutPassword(result));
    return;
  }
  if (!address) return res.status(400).json({ error: 'address is required when not using username+password' });
  const result = await store.loginPlayer(address, { username, name, password });
  if (result.error) return res.status(401).json(result);
  res.json(store.withoutPassword(result));
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

app.get('/api/chores/:address', (req, res) => {
  const address = req.params.address;
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

app.post('/api/chores/submit', (req, res) => {
  const { kidAddress, choreId, notes } = req.body || {};
  if (!kidAddress || !choreId) return res.status(400).json({ error: 'kidAddress and choreId required' });
  const result = store.submitChore(kidAddress, choreId, notes);
  if (result.error) return res.status(400).json(result);
  const p = store.getPlayer(kidAddress);
  if (p?.parentAddress) {
    notifyPlayer(p.parentAddress, 'chore:submitted', result);
  }
  notifyPlayer(kidAddress, 'chore:updated', result);
  res.json(result);
});

app.post('/api/chores/verify', async (req, res) => {
  const { choreId, parentAddress, signature, message } = req.body || {};
  if (!choreId || !parentAddress) return res.status(400).json({ error: 'choreId and parentAddress required' });

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

app.post('/api/chores/create', (req, res) => {
  const { kidAddress, parentAddress, title, category, energyReward, xpReward, allowanceReward } = req.body || {};
  if (!kidAddress || !title) return res.status(400).json({ error: 'kidAddress and title required' });
  const chore = store.createCustomChore({
    kidAddress,
    parentAddress,
    title,
    category,
    energyReward,
    xpReward,
    allowanceReward,
  });
  notifyPlayer(kidAddress, 'chore:created', chore);
  res.json(chore);
});

app.post('/api/chores/quiz-complete', (req, res) => {
  const { kidAddress, score } = req.body || {};
  if (!kidAddress) return res.status(400).json({ error: 'kidAddress required' });
  if (score < 4) return res.status(400).json({ error: 'Need at least 4/5 correct answers to pass' });
  const result = store.completeBrainQuiz(kidAddress);
  if (result.error) return res.status(400).json(result);
  const updated = store.getPlayer(kidAddress);
  if (updated) {
    notifyPlayer(kidAddress, 'player:update', store.withoutPassword(updated));
  }
  res.json(result);
});

app.post('/api/parent/link', (req, res) => {
  const { kidAddress, parentAddress } = req.body || {};
  if (!kidAddress || !parentAddress) return res.status(400).json({ error: 'kidAddress and parentAddress required' });
  const kid = store.linkParent(kidAddress, parentAddress);
  res.json(store.withoutPassword(kid));
});

app.get('/api/parent/:parentAddress/dashboard', (req, res) => {
  const parentAddress = req.params.parentAddress;
  const data = store.getParentKids(parentAddress);
  res.json(data);
});

app.post('/api/vouchers/redeem', (req, res) => {
  const { voucherId, parentAddress } = req.body || {};
  if (!voucherId) return res.status(400).json({ error: 'voucherId required' });
  const result = store.redeemVoucher(voucherId, parentAddress);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ---- Skin & Parent PIN Endpoints ----

app.get('/api/skins/:address', (req, res) => {
  const skins = store.getSkins(req.params.address);
  res.json(skins);
});

app.post('/api/skins/equip', (req, res) => {
  const { address, skinId } = req.body || {};
  if (!address || !skinId) return res.status(400).json({ error: 'address and skinId required' });
  const result = store.equipSkin(address, skinId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/parent/verify-pin', (req, res) => {
  const { address, pin } = req.body || {};
  const result = store.verifyParentPin(address, pin);
  res.json(result);
});

app.post('/api/parent/set-pin', (req, res) => {
  const { address, pin } = req.body || {};
  const result = store.setParentPin(address, pin);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ---- Helpers ----
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

function broadcastState(room) {
  io.to(room.id).emit('game:state', { roomId: room.id, game: room.engine.serialize(room.game) });
}

function broadcastLiveRooms() {
  if (!liveListeners.size) return;
  const list = [...rooms.values()]
    .filter(r => !r.game.winner)
    .map(r => ({ roomId: r.id, gameType: r.gameType, players: r.names, spectators: r.spectators.size }));
  for (const sid of liveListeners) io.to(sid).emit('rooms:list', list);
}

async function finishRoom(room) {
  if (room.tickInterval) clearInterval(room.tickInterval);
  const { game } = room;
  const addrX = game.players.X;
  const addrO = game.players.O;
  const winnerAddr = game.winner === 'X' ? addrX : game.winner === 'O' ? addrO : null;

  // Record on-chain (simulated ledger, or real MatchResult.sol via chain-onchain.js)
  // The returned receipt is normalized by chain-onchain.js. When on-chain
  // recording is enabled, it includes matchIdRaw as the exact bytes32 stored
  // on-chain. When recording falls back to the simulated ledger, matchIdRaw is
  // the same as matchId.
  const receipt = await recordMatch({
    matchId: room.id,
    gameType: room.gameType,
    players: { X: addrX, O: addrO },
    winner: winnerAddr || 'draw',
    moves: game.moves,
  });

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
        .filter(b => !beforeBadges.some(x => x.id === b.id))
        .map(b => ({ id: store.badgeNumericId(b.id), label: b.label }))
        .filter(b => b.id != null),
    });
    const sid = room.sockets[addr];
    if (sid)    io.to(sid).emit('player:update', profile);
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
    layout: room.gameType === 'memory'
      ? room.game.cards.map(c => ({ pairId: c.pairId, content: c.content }))
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
    receipt: { ...receipt, rewards: rewardReceipts }, // { matchId, matchIdRaw?, winner, timestamp, resultHash, txHash, rewards? }
  });
  // Note: the on-chain record and the DB writes below are intentionally
  // independent. The chain is the proof layer; SQLite is the operational store.
  // If one fails, the other can still stand on its own.
  broadcastLiveRooms();
}

// Advance game flow after any move: resolve pending state, then run the bot
//
// The on-chain path is called only when the room ends, in finishRoom().
function afterEngineMove(room, res) {
  if (room.game.winner) return finishRoom(room);
  if (res?.pendingMs && room.engine.resolve) {
    setTimeout(() => {
      if (room.game.winner) return;
      room.engine.resolve(room.game);
      broadcastState(room);
      afterEngineMove(room);
    }, res.pendingMs);
    return;
  }
  if (room.game.players[room.game.turn] === BOT) {
    setTimeout(() => botStep(room.id), BOT_STEP_MS);
  }
}

function botStep(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.game.winner) return;
  if (room.game.players[room.game.turn] !== BOT) return;
  const res = room.engine.applyMove(room.game, BOT, room.engine.botMove(room.game));
  broadcastState(room);
  afterEngineMove(room, res);
}

function createRoom(gameType, addrX, addrO, getSocket, opts = {}) {
  const engine = ENGINES[gameType];
  const id = 'match_' + crypto.randomBytes(6).toString('hex');
  const difficulty = ['easy', 'medium', 'hard'].includes(opts?.difficulty)
    ? opts.difficulty
    : 'medium';
  const diffLabel = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
  const botName = `ArenaBot (${diffLabel})`;

  const skinX = store.getEquippedSkin(addrX)?.id || 'neon-striker';
  const skinO = (addrO === BOT) ? (opts?.skinO || 'crimson-phoenix') : (store.getEquippedSkin(addrO)?.id || 'neon-striker');

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
  };
  rooms.set(id, room);
  for (const addr of [addrX, addrO]) {
    if (addr && addr !== BOT) {
      store.consumeEnergy(addr, 1);
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
      io.to(room.id).emit('blaster:tick', room.engine.serialize(room.game));
      if (room.game.winner) {
        clearInterval(room.tickInterval);
        finishRoom(room);
      }
    }, 40);
  }

  broadcastLiveRooms();
  return room;
}

// ---- Socket.IO ----
// The on-chain module is intentionally disconnected from game logic. It only
// records finished matches and distributes rewards. Game state, matchmaking,
// chat, and spectators remain server-side.
io.on('connection', (socket) => {
  liveListeners.add(socket.id);

  socket.on('identify', async ({ address, name, signature } = {}) => {
    if (!address) return socket.emit('player:error', { error: 'Not identified: no address provided' });
    // Require a signed message to prove wallet ownership
    if (!signature || typeof signature !== 'string' || !signature.trim()) return socket.emit('player:error', { error: 'Not identified: signature required (got: ' + JSON.stringify(signature) + ')' });
    if (!verifyAuthSignature(signature, address)) return socket.emit('player:error', { error: 'Not identified: invalid signature' });
    // Address verified via signature — now treat as authenticated
    socketPlayer.set(socket.id, address);
    const profile = store.getPlayer(address) || store.upsertPlayer(address, name);
    socket.emit('player:update', store.withoutPassword(profile));
    socket.emit('player:registered', store.isRegistered(address));
    if (store.isRegistered(address)) {
      socket.emit('player:registered:user', { address, username: profile.username, name: profile.name });
    }
  });

  // Register a new player identity (wallet + username + password + optional email)
  socket.on('player:register', async ({ username, name, email, password }) => {
    const address = socketPlayer.get(socket.id);
    if (!address) return socket.emit('player:error', { error: 'Not identified' });
    const result = await store.registerPlayer(address, { name, username, email, password });
    if (result.error) return socket.emit('player:error', { error: result.error, conflict: result.conflict });
    const safeProfile = store.withoutPassword(result);
    socket.emit('player:update', safeProfile);
    socket.emit('player:registered', true);
    socket.emit('auth:success', { address: result.address, username: result.username, name: result.name });
    socket.emit('player:registered:user', { address: result.address, username: result.username, name: result.name });
  });

  // Log in by username + password (wallet resolved from the username index).
  socket.on('player:loginByCredentials', async ({ username, password } = {}) => {
    const result = await store.loginPlayerByCredentials({ username, password });
    if (result.error) return socket.emit('player:error', { error: result.error });
    socketPlayer.set(socket.id, result.address);
    socket.emit('player:update', store.withoutPassword(result));
    socket.emit('player:registered', true);
    socket.emit('player:registered:user', { address: result.address, username: result.username, name: result.name });
    socket.emit('auth:success', { address: result.address, username: result.username, name: result.name });
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
    socket.emit('player:registered:user', { address: result.address, username: result.username, name: result.name });
  });

  socket.on('queue:join', ({ gameType } = {}) => {
    const address = socketPlayer.get(socket.id);
    const type = ENGINES[gameType] ? gameType : 'tic-tac-toe';
    if (!address || queue.some(q => q.socketId === socket.id)) return;
    const p = store.getPlayer(address) || store.upsertPlayer(address);
    if ((p.energy ?? 5) <= 0) {
      return socket.emit('match:error', {
        error: '⚡ Out of Arena Energy! Complete a chore or pass the Brain Quiz to earn Energy.',
        needsEnergy: true,
      });
    }
    queue.push({ socketId: socket.id, gameType: type });
    socket.emit('queue:waiting', { gameType: type });

    // Pair the first two players waiting for the same game
    const peers = queue.filter(q => q.gameType === type);
    if (peers.length >= 2) {
      const [a, b] = peers;
      const addrA = socketPlayer.get(a.socketId);
      const addrB = socketPlayer.get(b.socketId);
      const pA = store.getPlayer(addrA);
      const pB = store.getPlayer(addrB);
      if ((pA?.energy ?? 5) <= 0) {
        queue.splice(queue.indexOf(a), 1);
        const sockA = io.sockets.sockets.get(a.socketId);
        if (sockA) sockA.emit('match:error', { error: '⚡ Out of Arena Energy!', needsEnergy: true });
        return;
      }
      if ((pB?.energy ?? 5) <= 0) {
        queue.splice(queue.indexOf(b), 1);
        const sockB = io.sockets.sockets.get(b.socketId);
        if (sockB) sockB.emit('match:error', { error: '⚡ Out of Arena Energy!', needsEnergy: true });
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
        addr => [sockA, sockB].find(s => socketPlayer.get(s.id) === addr),
      );
    }
  });

  socket.on('queue:leave', () => {
    const i = queue.findIndex(q => q.socketId === socket.id);
    if (i !== -1) queue.splice(i, 1);
  });

  socket.on('match:bot', ({ gameType, deck, pairs, difficulty } = {}) => {
    const address = socketPlayer.get(socket.id);
    const type = ENGINES[gameType] ? gameType : 'tic-tac-toe';
    if (!address) return;
    const p = store.getPlayer(address) || store.upsertPlayer(address);
    if ((p.energy ?? 5) <= 0) {
      return socket.emit('match:error', {
        error: '⚡ Out of Arena Energy! Complete a chore or pass the Brain Quiz to earn Energy.',
        needsEnergy: true,
      });
    }
    const diff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
    const room = createRoom(type, address, BOT,
      addr => (addr === address ? socket : null), { deck, pairs, difficulty: diff });
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

  socket.on('game:move', ({ roomId, ...move }) => {
    const room = rooms.get(roomId);
    const address = socketPlayer.get(socket.id);
    if (!room || !address) return;
    const res = room.engine.applyMove(room.game, address, move);
    if (res.error) return socket.emit('game:error', res.error);
    broadcastState(room);
    afterEngineMove(room, res);
  });

  socket.on('blaster:input', ({ roomId, ...move }) => {
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

  socket.on('skins:equip', ({ skinId } = {}, ack) => {
    const addr = socketPlayer.get(socket.id);
    if (!addr) return ack && ack({ error: 'Identify required' });
    const res = store.equipSkin(addr, skinId);
    if (ack) ack(res);
    if (res.ok) {
      socket.emit('player:update', store.withoutPassword(res.player));
    }
  });

  socket.on('spectate', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    room.spectators.add(socket.id);
    socket.join(roomId);
    socket.emit('match:start', serializeRoom(room)); // spectator joins mid-game
    broadcastLiveRooms();
  });

  socket.on('chat:send', ({ roomId, text }) => {
    const room = rooms.get(roomId);
    const address = socketPlayer.get(socket.id);
    if (!room || !address || !text?.trim()) return;
    const msg = {
      from: store.getPlayer(address)?.name || address.slice(0, 8),
      address,
      text: text.trim().slice(0, 300),
      t: Date.now(),
    };
    room.chat.push(msg);
    io.to(roomId).emit('chat:message', msg);
  });

  socket.on('match:leave', ({ roomId }) => {
    socket.leave(roomId);
    const room = rooms.get(roomId);
    if (room) room.spectators.delete(socket.id);
    broadcastLiveRooms();
  });

  socket.on('rooms:list', () => broadcastLiveRooms());

  socket.on('disconnect', () => {
    const i = queue.findIndex(q => q.socketId === socket.id);
    if (i !== -1) queue.splice(i, 1);
    socketPlayer.delete(socket.id);
    liveListeners.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Battle Arena server on http://localhost:${PORT}`);
  console.log(isOnchain()
    ? 'On-chain match recording ENABLED (MatchResult.sol)'
    : 'Match recording: simulated ledger (chain.js)');
  if (isTokensOnchain()) {
    const { arenaToken, arenaBadges } = tokenAddresses();
    console.log(`On-chain rewards ENABLED — ArenaToken ${arenaToken}, ArenaBadges ${arenaBadges}`);
  } else {
    console.log('Rewards: simulated only (set ARENA_TOKEN_ADDRESS/ARENA_BADGES_ADDRESS to enable)');
  }
});
