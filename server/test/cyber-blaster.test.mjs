import test from 'node:test';
import assert from 'node:assert/strict';
import * as cb from '../games/cyber-blaster.js';

test('createGame initializes player positions, 100 HP, and obstacles', () => {
  const g = cb.createGame('0xA', '0xB', { difficulty: 'hard', skinX: 'crimson-phoenix' });
  assert.equal(g.pState.X.hp, 100);
  assert.equal(g.pState.O.hp, 100);
  assert.equal(g.pState.X.x, 100);
  assert.equal(g.pState.O.x, 700);
  assert.equal(g.skins.X, 'crimson-phoenix');
  assert.equal(g.skins.O, 'neon-striker');
  assert.equal(g.difficulty, 'hard');
  assert.equal(g.winner, null);
  assert.ok(cb.OBSTACLES.length >= 4);
});

test('applyMove updates input velocity and spawns bullets when shooting', () => {
  const g = cb.createGame('0xA', '0xB');
  const res = cb.applyMove(g, '0xA', {
    type: 'input',
    vx: 1,
    vy: 0,
    angle: 0,
    shoot: true,
  });
  assert.ok(res.ok);
  assert.equal(g.bullets.length, 1);
  assert.equal(g.bullets[0].seat, 'X');
  assert.ok(g.bullets[0].vx > 0);
});

test('tick detects bullet hit on player and reduces HP', () => {
  const g = cb.createGame('0xA', '0xB');
  // Spawn a bullet right next to player O
  g.bullets.push({
    id: 'test_bullet',
    seat: 'X',
    x: 690,
    y: 300,
    vx: 12,
    vy: 0,
    skinId: 'neon-striker',
    bornAt: Date.now(),
    lifeTicks: 0,
  });

  const tickRes = cb.tick(g, 40);
  assert.equal(g.pState.O.hp, 80); // Took 20 damage
  assert.equal(g.bullets.length, 0); // Bullet consumed
  const hitEvent = tickRes.events.find((e) => e.type === 'player_hit');
  assert.ok(hitEvent);
  assert.equal(hitEvent.targetSeat, 'O');
});

test('shield absorbs bullet damage without reducing HP', () => {
  const g = cb.createGame('0xA', '0xB');
  g.pState.O.shield = 1;
  g.bullets.push({
    id: 'test_bullet_shield',
    seat: 'X',
    x: 690,
    y: 300,
    vx: 12,
    vy: 0,
    skinId: 'neon-striker',
    bornAt: Date.now(),
    lifeTicks: 0,
  });

  cb.tick(g, 40);
  assert.equal(g.pState.O.hp, 100); // Shield absorbed it
  assert.equal(g.pState.O.shield, 0);
});

test('reaching 0 HP wins round and resets positions or wins match', () => {
  const g = cb.createGame('0xA', '0xB', { targetWins: 1 });
  g.pState.O.hp = 20;
  g.bullets.push({
    id: 'finishing_bullet',
    seat: 'X',
    x: 695,
    y: 300,
    vx: 10,
    vy: 0,
    skinId: 'neon-striker',
    bornAt: Date.now(),
    lifeTicks: 0,
  });

  cb.tick(g, 40);
  assert.equal(g.pState.O.hp, 0);
  assert.equal(g.score.X, 1);
  assert.equal(g.winner, 'X');
});

test('botMove generates valid input move', () => {
  const g = cb.createGame('0xA', '0xB', { difficulty: 'hard' });
  const bMove = cb.botMove(g, 'hard');
  assert.equal(bMove.type, 'input');
  assert.equal(typeof bMove.angle, 'number');
  assert.equal(typeof bMove.shoot, 'boolean');
});

test('serializeTick returns dynamic state while omitting static arena & obstacles', () => {
  const g = cb.createGame('0xA', '0xB');
  const full = cb.serialize(g);
  assert.ok(full.arena);
  assert.ok(full.obstacles);

  const tick = cb.serializeTick(g);
  assert.equal(tick.arena, undefined);
  assert.equal(tick.obstacles, undefined);
  assert.ok(tick.pState);
  assert.ok(tick.bullets);
  assert.ok(tick.score);
});
