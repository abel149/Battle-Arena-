/**
 * @file matchmaking.js
 * @description WebSocket handlers for queue matchmaking, private room invitations, bot matches, and spectator mode.
 */

import * as store from '../store.js';
import { ENGINES } from '../games/index.js';
import { BOT_ADDRESS } from '../../shared/constants.js';

const BOT = BOT_ADDRESS;

/**
 * Registers matchmaking and room lifecycle socket event listeners.
 *
 * @function registerMatchmakingHandlers
 * @param {import('socket.io').Socket} socket - Active client socket.
 * @param {Object} ctx - Server socket context.
 */
export function registerMatchmakingHandlers(socket, ctx) {
  const {
    io,
    rooms,
    queue,
    pendingRooms,
    PENDING_ROOM_MS,
    socketPlayer,
    accountOf,
    makeRoomCode,
    dropPendingFor,
    dropPendingRoom,
    createRoom,
    serializeRoom,
    broadcastLiveRooms,
    afterEngineMove,
    maybeForfeit,
  } = ctx;

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

  socket.on('queue:leave', () => {
    const i = queue.findIndex((q) => q.socketId === socket.id);
    if (i !== -1) queue.splice(i, 1);
    dropPendingFor(socket.id);
  });

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
    afterEngineMove(room);
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
    socket.emit('match:start', serializeRoom(room));
    broadcastLiveRooms();
  });

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
    maybeForfeit(socket);
    broadcastLiveRooms();
  });

  socket.on('rooms:list', () => broadcastLiveRooms());
}
