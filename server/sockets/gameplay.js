/**
 * @file gameplay.js
 * @description WebSocket handlers for authoritative game moves and player inputs.
 * Validates moves through the registered game engine and triggers real-time state broadcasts.
 */

/**
 * Registers active gameplay socket event listeners for a client connection.
 *
 * @function registerGameplayHandlers
 * @param {import('socket.io').Socket} socket - Active client socket.
 * @param {Object} ctx - Server socket context.
 * @param {Map<string, Object>} ctx.rooms - Active rooms map.
 * @param {Map<string, string>} ctx.socketPlayer - Socket to player address map.
 * @param {Function} ctx.broadcastState - Game state broadcaster.
 * @param {Function} ctx.afterEngineMove - Move completion callback.
 */
export function registerGameplayHandlers(socket, ctx) {
  const { rooms, socketPlayer, broadcastState, afterEngineMove } = ctx;

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
}
