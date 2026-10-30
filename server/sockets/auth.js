/**
 * @file auth.js
 * @description WebSocket authentication and session identification handlers.
 * Supports EIP-191 cryptographic wallet signature verification and bearer session tokens,
 * alongside brute-force credential protection.
 */

import * as store from '../store.js';
import { verifyAuthSignature } from '../security.js';

// Throttle password guessing: 8 failed logins per IP in 10 minutes.
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILS = 8;
const loginFails = new Map(); // ip -> { count, resetAt }

/**
 * Checks whether an IP address is temporarily blocked due to excessive failed logins.
 *
 * @param {string} ip - Client remote IP address.
 * @returns {boolean} True if blocked.
 */
export const isLoginBlocked = (ip) => {
  const f = loginFails.get(ip);
  if (!f || Date.now() > f.resetAt) {
    loginFails.delete(ip);
    return false;
  }
  return f.count >= LOGIN_MAX_FAILS;
};

/**
 * Records a failed credential login attempt for brute-force tracking.
 *
 * @param {string} ip - Client remote IP address.
 */
export const noteLoginFail = (ip) => {
  const f = loginFails.get(ip);
  if (!f || Date.now() > f.resetAt) {
    loginFails.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  } else {
    f.count += 1;
  }
};

/**
 * Binds an authenticated Ethereum wallet address to a socket session,
 * syncing player profile, registration status, and username metadata to the client.
 *
 * @function bindIdentity
 * @param {import('socket.io').Socket} socket - Client socket connection.
 * @param {string} address - Authenticated player address.
 * @param {Map<string, string>} socketPlayer - Socket to player address map.
 */
export function bindIdentity(socket, address, socketPlayer) {
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

/**
 * Registers authentication event listeners for a client connection.
 *
 * @function registerAuthHandlers
 * @param {import('socket.io').Socket} socket - Active client socket.
 * @param {Object} ctx - Server socket context.
 */
export function registerAuthHandlers(socket, ctx) {
  const {
    rooms,
    socketPlayer,
    queue,
    dropPendingFor,
    serializeRoom,
  } = ctx;

  const authSuccess = (result) => {
    const token = store.createSession(result.address);
    socket.emit('auth:success', {
      address: result.address,
      username: result.username,
      name: result.name,
      token,
    });
  };

  // Two ways to identify: a session token (after login/registration, works from
  // any browser) or a wallet signature (guest wallets, MetaMask).
  socket.on('identify', ({ address, signature, issuedAt, token } = {}) => {
    if (token) {
      const sessionAddress = store.addressForSession(token);
      if (!sessionAddress) return socket.emit('auth:expired');
      bindIdentity(socket, sessionAddress, socketPlayer);
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
    if (!address) {
      return socket.emit('player:error', { error: 'Not identified: no address provided' });
    }
    if (!signature || typeof signature !== 'string' || !signature.trim()) {
      return socket.emit('player:error', { error: 'Not identified: signature required' });
    }
    if (!verifyAuthSignature(signature, address, issuedAt)) {
      return socket.emit('player:error', { error: 'Not identified: invalid or expired signature' });
    }
    bindIdentity(socket, address, socketPlayer);

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

  // Register a new player identity (wallet + username + password + optional email)
  socket.on('player:register', async ({ username, name, email, password } = {}) => {
    const address = socketPlayer.get(socket.id);
    if (!address) return socket.emit('player:error', { error: 'Not identified' });
    const result = await store.registerPlayer(address, { name, username, email, password });
    if (result.error) {
      return socket.emit('player:error', { error: result.error, conflict: result.conflict });
    }
    bindIdentity(socket, result.address, socketPlayer);
    authSuccess(result);
  });

  // Log in by username + password (wallet resolved from the username index).
  socket.on('player:loginByCredentials', async ({ username, password } = {}) => {
    const ip = socket.handshake.address;
    if (isLoginBlocked(ip)) {
      return socket.emit('player:error', {
        error: 'Too many failed attempts. Try again in a few minutes.',
      });
    }
    const result = await store.loginPlayerByCredentials({ username, password });
    if (result.error) {
      noteLoginFail(ip);
      return socket.emit('player:error', { error: result.error });
    }
    loginFails.delete(ip);
    bindIdentity(socket, result.address, socketPlayer);
    authSuccess(result);
  });

  socket.on('auth:logout', ({ token } = {}) => {
    store.deleteSession(token);
    socketPlayer.delete(socket.id);
    if (dropPendingFor) dropPendingFor(socket.id);
    if (queue) {
      const i = queue.findIndex((q) => q.socketId === socket.id);
      if (i !== -1) queue.splice(i, 1);
    }
    socket.emit('player:registered', false);
  });

  // Log in / claim an existing wallet as a registered identity.
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
}
