import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../store.js';

test('getSkins returns 6 skins with neon-striker unlocked by default', () => {
  const kid = '0xKid' + Math.random().toString(36).slice(2, 8);
  store.upsertPlayer(kid, 'SkinKid');
  const skins = store.getSkins(kid);
  assert.equal(skins.length, 6);
  const starter = skins.find((s) => s.id === 'neon-striker');
  assert.ok(starter);
  assert.equal(starter.unlocked, true);
  assert.equal(starter.equipped, true);

  const phoenix = skins.find((s) => s.id === 'crimson-phoenix');
  assert.ok(phoenix);
  assert.equal(phoenix.unlocked, false);
});

test('equipSkin rejects locked skin and allows unlocked skin', () => {
  const kid = '0xKid' + Math.random().toString(36).slice(2, 8);
  store.upsertPlayer(kid, 'SkinKid2');

  const lockedRes = store.equipSkin(kid, 'crimson-phoenix');
  assert.ok(lockedRes.error);

  store.unlockSkin(kid, 'crimson-phoenix');
  const unlockedRes = store.equipSkin(kid, 'crimson-phoenix');
  assert.ok(unlockedRes.ok);
  assert.equal(unlockedRes.equippedSkin, 'crimson-phoenix');

  const p = store.getPlayer(kid);
  assert.equal(p.equippedSkin, 'crimson-phoenix');
});

test('parent chore verification auto-unlocks corresponding skin', () => {
  const kid = '0xKid' + Math.random().toString(36).slice(2, 8);
  const parent = '0xParent' + Math.random().toString(36).slice(2, 8);
  store.upsertPlayer(kid, 'SkinKid3');
  const chores = store.getChores(kid);
  const roomChore = chores.find((c) => c.category === 'room');
  assert.ok(roomChore);

  // Kid submits chore
  store.submitChore(kid, roomChore.id, 'I cleaned the entire room!');

  // Before verification, crimson-phoenix is locked
  assert.equal(store.isSkinUnlocked(kid, 'crimson-phoenix'), false);

  // Parent verifies chore
  const verifyRes = store.verifyChore(roomChore.id, parent);
  assert.ok(verifyRes.ok);
  assert.ok(verifyRes.unlockedSkin);
  assert.equal(verifyRes.unlockedSkin.id, 'crimson-phoenix');

  // After verification, crimson-phoenix is unlocked
  assert.equal(store.isSkinUnlocked(kid, 'crimson-phoenix'), true);
});

test('verifyParentPin checks default PIN and supports setting custom PIN', () => {
  const parent = '0xParent' + Math.random().toString(36).slice(2, 8);
  // Default PIN 1234
  assert.equal(store.verifyParentPin(parent, '1234').ok, true);
  assert.equal(store.verifyParentPin(parent, '9999').ok, false);

  // Set new PIN
  const setRes = store.setParentPin(parent, '5678');
  assert.ok(setRes.ok);

  assert.equal(store.verifyParentPin(parent, '1234').ok, false);
  assert.equal(store.verifyParentPin(parent, '5678').ok, true);
});

test('verifyParentPin locks out after 5 consecutive failed attempts', () => {
  const parent = '0xParentLock' + Math.random().toString(36).slice(2, 8);
  for (let i = 0; i < 4; i++) {
    const res = store.verifyParentPin(parent, '0000');
    assert.equal(res.ok, false);
    assert.equal(res.locked, undefined);
  }
  // 5th attempt triggers lockout
  const lockRes = store.verifyParentPin(parent, '0000');
  assert.equal(lockRes.ok, false);
  assert.equal(lockRes.locked, true);

  // Even the correct PIN is rejected during lockout
  const blockedRes = store.verifyParentPin(parent, '1234');
  assert.equal(blockedRes.ok, false);
  assert.equal(blockedRes.locked, true);

  // Resetting attempts unblocks
  store.resetPinAttempts(parent);
  assert.equal(store.verifyParentPin(parent, '1234').ok, true);
});
