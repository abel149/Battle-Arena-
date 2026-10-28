// Web3 Battle Arena — real-time game server
// Game-agnostic rooms (engine registry), matchmaking, chat, spectators,
// on-chain (simulated) match recording, leaderboard, XP/levels/badges.

import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import crypto from 'crypto';

import { ENGINES, DECKS, dailyDeckId } from './games/index.js';
import { recordMatch, getLedger, isOnchain } from './chain-onchain.js';
import * as store from './store.js';

const PORT = process.env.PORT || 3001;
const BOT = '0xB07000000000000000000000000000000000000B';
const BOT_STEP_MS = 700;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---- In-memory runtime state ----
const rooms = new Map();          // roomId -> room
const queue = [];                 // { socketId, gameType } waiting for a match
const socketPlayer = new Map();   // socketId -> address
const liveListeners = new Set();  // socketIds in the lobby (for rooms:live push)

// ---- REST ----
app.get('/api/leaderboard', (_req, res) => res.json(store.leaderboard()));
app.get('/api/matches', async (_req, res) => {
  try {
    res.json(await getLedger());
  } catch (err) {
    res.status(500).json({ error: 'Failed to load match ledger', detail: err.message });
  }
});
app.get('/api/verify/:matchId', async (req, res) => {
  try {
    const ledger = await getLedger();
    const entry = ledger.find(e => e.matchId === req.params.matchId);
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
  const { address, username, name, email, password } = req.body || {};
  if (!address) return res.status(400).json({ error: 'address is required' });
  const usernameErr = store.validateUsername(username);
  if (usernameErr) return res.status(400).json({ error: usernameErr });
  const result = await store.registerPlayer(address, { name, username, email, password });
  if (result.error) return res.status(409).json(result);
  res.json(store.withoutPassword(result));
});

app.post('/api/login', async (req, res) => {
  const { address, username, name, password } = req.body || {};
  // Two ways to log in:
  // 1) By credentials: username + password (wallet resolved from username index).
  // 2) By wallet: address + optional password (legacy; password verified if supplied).
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

// ---- Helpers ----
function serializeRoom(room) {
  return {
    roomId: room.id,
    gameType: room.gameType,
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
  const { game } = room;
  const addrX = game.players.X;
  const addrO = game.players.O;
  const winnerAddr = game.winner === 'X' ? addrX : game.winner === 'O' ? addrO : null;

  // Record on-chain (simulated ledger, or real MatchResult.sol via chain-onchain.js)
  const receipt = await recordMatch({
    matchId: room.id,
    gameType: room.gameType,
    players: { X: addrX, O: addrO },
    winner: winnerAddr || 'draw',
    moves: game.moves,
  });

  // Update stats for human players
  for (const addr of [addrX, addrO]) {
    if (addr === BOT) continue;
    const result = winnerAddr === null ? 'draw' : addr === winnerAddr ? 'win' : 'loss';
    const profile = store.applyResult(addr, result, {
      gameType: room.gameType,
      deck: room.game.deck,
      daily: !!room.game.deck && room.game.deck === dailyDeckId(),
    });
    const sid = room.sockets[addr];
    if (sid) io.to(sid).emit('player:update', profile);
  }

  io.to(room.id).emit('match:end', {
    roomId: room.id,
    winner: winnerAddr,
    result: game.winner,
    receipt, // { matchId, winner, timestamp, resultHash, txHash }
  });
  broadcastLiveRooms();
}

// Advance game flow after any move: resolve pending state, then run the bot
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
  const room = {
    id,
    gameType,
    engine,
    game: engine.createGame(addrX, addrO, opts),
    sockets: {},
    names: { [BOT]: 'ArenaBot' },
    spectators: new Set(),
    chat: [],
  };
  rooms.set(id, room);
  for (const addr of [addrX, addrO]) {
    const s = getSocket(addr);
    if (s) {
      room.sockets[addr] = s.id;
      room.names[addr] = store.getPlayer(addr)?.name;
      s.join(id);
      s.emit('match:start', serializeRoom(room));
    }
  }
  broadcastLiveRooms();
  return room;
}

// ---- Socket.IO ----
io.on('connection', (socket) => {
  liveListeners.add(socket.id);

  socket.on('identify', ({ address, name }) => {
    if (!address) return;
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
    queue.push({ socketId: socket.id, gameType: type });
    socket.emit('queue:waiting', { gameType: type });

    // Pair the first two players waiting for the same game
    const peers = queue.filter(q => q.gameType === type);
    if (peers.length >= 2) {
      for (const p of peers.slice(0, 2)) {
        queue.splice(queue.indexOf(p), 1);
      }
      const [a, b] = peers;
      const sockA = io.sockets.sockets.get(a.socketId);
      const sockB = io.sockets.sockets.get(b.socketId);
      if (!sockA || !sockB) return;
      createRoom(
        type,
        socketPlayer.get(a.socketId),
        socketPlayer.get(b.socketId),
        addr => [sockA, sockB].find(s => socketPlayer.get(s.id) === addr),
      );
    }
  });

  socket.on('queue:leave', () => {
    const i = queue.findIndex(q => q.socketId === socket.id);
    if (i !== -1) queue.splice(i, 1);
  });

  socket.on('match:bot', ({ gameType, deck, pairs } = {}) => {
    const address = socketPlayer.get(socket.id);
    const type = ENGINES[gameType] ? gameType : 'tic-tac-toe';
    if (!address) return;
    const room = createRoom(type, address, BOT,
      addr => (addr === address ? socket : null), { deck, pairs });
    // If the bot ever has the first turn, drive it
    afterEngineMove(room);
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
  if (isOnchain()) console.log('On-chain match recording ENABLED (MatchResult.sol)');
  else console.log('Match recording: simulated ledger (chain.js)');
});
