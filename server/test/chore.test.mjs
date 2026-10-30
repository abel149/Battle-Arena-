import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../store.js';

test('getChores seeds default chores for a kid', () => {
  const kid = '0xKid' + Math.random().toString(36).slice(2, 8);
  const chores = store.getChores(kid);
  assert.ok(chores.length >= 5);
  const titles = chores.map((c) => c.title);
  assert.ok(titles.some((t) => t.includes('bedroom')));
  assert.ok(titles.some((t) => t.includes('homework')));
});

test('kid submits chore and parent verifies it on-chain/ledger', () => {
  const kid = '0xKid' + Math.random().toString(36).slice(2, 8);
  const parent = '0xParent' + Math.random().toString(36).slice(2, 8);
  store.linkParent(kid, parent);

  const playerBefore = store.getPlayer(kid);
  const startingEnergy = playerBefore?.energy ?? 5;

  const chores = store.getChores(kid);
  const chore = chores[0];

  const submitted = store.submitChore(kid, chore.id, 'Cleaned my room completely!');
  assert.equal(submitted.status, 'pending_approval');
  assert.equal(submitted.notes, 'Cleaned my room completely!');

  const verified = store.verifyChore(chore.id, parent, '0xProofHash123');
  assert.ok(verified.ok);
  assert.equal(verified.chore.status, 'verified');

  const playerAfter = store.getPlayer(kid);
  assert.equal(playerAfter.energy, startingEnergy + chore.energyReward);
  assert.ok(playerAfter.battlePassXp >= chore.xpReward);
  assert.ok(playerAfter.allowanceBalance >= chore.allowanceReward);
});

test('energy consumption gates match entry', () => {
  const kid = '0xKid' + Math.random().toString(36).slice(2, 8);
  store.upsertPlayer(kid, 'EnergyTester');
  const p = store.getPlayer(kid);
  // drain energy
  store.consumeEnergy(kid, p.energy);
  assert.equal(store.getPlayer(kid).energy, 0);

  // attempt to consume energy with 0
  const failed = store.consumeEnergy(kid, 1);
  assert.ok(failed.error);
  assert.equal(failed.error, 'Insufficient energy');

  // complete brain quiz gives energy
  const quizRes = store.completeBrainQuiz(kid);
  assert.equal(quizRes.ok, true);
  assert.equal(quizRes.energy, 2);

  // now can consume 1 energy
  const success = store.consumeEnergy(kid, 1);
  assert.equal(success.ok, true);
  assert.equal(success.energy, 1);
});

test('Battle Pass vouchers unlock and parent can redeem them', () => {
  const kid = '0xKid' + Math.random().toString(36).slice(2, 8);
  const parent = '0xParent' + Math.random().toString(36).slice(2, 8);
  store.linkParent(kid, parent);
  const p = store.getPlayer(kid);
  p.battlePassXp = 450; // Reaches tier 5 (Pizza Night pass!)
  p.battlePassTier = 5;
  store.syncBattlePassVouchers(kid, 5, parent);

  const vouchers = store.getVouchers(kid);
  assert.ok(vouchers.length >= 2); // tier 3 and tier 5 vouchers
  const pizzaVoucher = vouchers.find((v) => v.type === 'pizza');
  assert.ok(pizzaVoucher);
  assert.equal(pizzaVoucher.status, 'unlocked');

  const redeemed = store.redeemVoucher(pizzaVoucher.id, parent);
  assert.equal(redeemed.status, 'redeemed');
  assert.ok(redeemed.redeemedAt);
});

test('parent can create custom chore and view kid dashboard', () => {
  const kid = '0xKid' + Math.random().toString(36).slice(2, 8);
  const parent = '0xParent' + Math.random().toString(36).slice(2, 8);
  store.linkParent(kid, parent);

  const customChore = store.createCustomChore({
    kidAddress: kid,
    parentAddress: parent,
    title: 'Mow front lawn and water plants',
    category: 'cleaning',
    energyReward: 3,
    xpReward: 100,
    allowanceReward: 5.0,
  });

  assert.ok(customChore.id);
  assert.equal(customChore.title, 'Mow front lawn and water plants');
  assert.equal(customChore.energyReward, 3);
  assert.equal(customChore.allowanceReward, 5.0);

  // Kid submits it
  store.submitChore(kid, customChore.id, 'Finished mowing!');

  // Parent dashboard should show it in pending
  const dashboard = store.getParentKids(parent);
  assert.ok(dashboard.kids.length >= 1);
  assert.ok(dashboard.pendingChores.some((p) => p.id === customChore.id));

  // Parent verifies
  const v = store.verifyChore(customChore.id, parent);
  assert.ok(v.ok);
  assert.equal(v.chore.status, 'verified');

  // Check kid received allowance & energy
  const kidAfter = store.getPlayer(kid);
  assert.ok(kidAfter.allowanceBalance >= 5.0);
});
