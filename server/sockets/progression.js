/**
 * @file progression.js
 * @description WebSocket handlers for player progression: chores, battle pass, and skin unlocks.
 */

import * as store from '../store.js';

/**
 * Registers player progression and inventory socket event listeners.
 *
 * @function registerProgressionHandlers
 * @param {import('socket.io').Socket} socket - Active client socket.
 * @param {Object} ctx - Server socket context.
 * @param {Map<string, string>} ctx.socketPlayer - Socket to player address map.
 */
export function registerProgressionHandlers(socket, ctx) {
  const { socketPlayer } = ctx;

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
}
