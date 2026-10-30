/**
 * @file chat.js
 * @description WebSocket handlers for lobby and match chat messaging.
 * Enforces message sanitization, profanity filtering, length caps, and rate limits to ensure safe, kid-friendly chat.
 */

import * as store from '../store.js';

// Kid safety: profanity filtering & preset moderation pattern
export const PROFANITY_PATTERN =
  /\b(fuck|shit|bitch|ass|asshole|dick|pussy|cunt|bastard|damn|crap|whore|slut|nigger|nigga|faggot|retard|idiot|stupid|kill|die)\b/i;

/**
 * Moderates user chat text:
 * - Strips leading/trailing whitespace
 * - Replaces profanity with family friendly placeholders
 * - Caps maximum character length to 100 characters
 *
 * @function sanitizeChatMessage
 * @param {*} raw - Unsanitized input from socket event.
 * @returns {string | null} Sanitized clean message or null if invalid.
 */
export function sanitizeChatMessage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.replace(/[<>]/g, '').trim();
  if (!trimmed) return null;
  if (PROFANITY_PATTERN.test(trimmed)) {
    return '🎮 [Family Friendly Message]';
  }
  return trimmed.slice(0, 100);
}

/**
 * Registers chat socket event listeners for a client connection.
 *
 * @function registerChatHandlers
 * @param {import('socket.io').Socket} socket - Active client socket.
 * @param {Object} ctx - Server socket context.
 * @param {import('socket.io').Server} ctx.io - Socket.IO server instance.
 * @param {Map<string, Object>} ctx.rooms - Active rooms map.
 * @param {Map<string, string>} ctx.socketPlayer - Socket to player address map.
 * @param {Array<Object>} ctx.lobbyChat - In-memory lobby chat log.
 * @param {Function} ctx.isChatRateLimited - Per-socket rate limiter.
 */
export function registerChatHandlers(socket, ctx) {
  const { io, rooms, socketPlayer, lobbyChat, isChatRateLimited } = ctx;

  socket.on('lobby:chat:history', () => {
    socket.emit('lobby:chat:history', lobbyChat.slice(-30));
  });

  socket.on('lobby:chat:send', (payload = {}) => {
    const { text } = payload || {};
    const address = socketPlayer.get(socket.id);
    if (!address || !text?.trim()) return;
    if (isChatRateLimited(socket.id)) {
      return socket.emit('chat:rate_limited', {
        error: 'Please wait a moment before sending another message.',
      });
    }
    const cleanText = sanitizeChatMessage(text);
    if (!cleanText) return;
    const p = store.getPlayer(address);
    const msg = {
      from: p?.name || address.slice(0, 8),
      address,
      text: cleanText,
      t: Date.now(),
      time: Date.now(),
    };
    lobbyChat.push(msg);
    if (lobbyChat.length > 50) lobbyChat.shift();
    io.emit('lobby:chat:message', msg);
  });

  socket.on('chat:send', (payload = {}) => {
    const { roomId, text } = payload || {};
    const address = socketPlayer.get(socket.id);
    if (!address || !text?.trim()) return;
    if (isChatRateLimited(socket.id)) {
      return socket.emit('chat:rate_limited', {
        error: 'Please wait a moment before sending another message.',
      });
    }
    const cleanText = sanitizeChatMessage(text);
    if (!cleanText) return;

    if (!roomId || roomId === 'lobby') {
      const p = store.getPlayer(address);
      const msg = {
        from: p?.name || address.slice(0, 8),
        address,
        text: cleanText,
        t: Date.now(),
        time: Date.now(),
      };
      lobbyChat.push(msg);
      if (lobbyChat.length > 50) lobbyChat.shift();
      io.emit('lobby:chat:message', msg);
      return;
    }

    const room = rooms.get(roomId);
    if (!room) return;
    // Only players and spectators of this room may post to its chat.
    const member = room.sockets[address] === socket.id || room.spectators.has(socket.id);
    if (!member) return;
    const msg = {
      from: store.getPlayer(address)?.name || address.slice(0, 8),
      address,
      text: cleanText,
      t: Date.now(),
    };
    room.chat.push(msg);
    store.saveActiveRoom(room);
    io.to(roomId).emit('chat:message', msg);
  });
}
