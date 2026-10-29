import test from 'node:test';
import assert from 'node:assert/strict';
import * as memory from '../games/memory.js';

function playMatch(deck = 'flags', pairs = 4) {
  const g = memory.createGame('0xA', '0xB', { deck, pairs });
  // Flip cards until the game ends. Strategy: first open of a matched pair's
  // twin is always remembered, so every two flips resolve deterministically.
  const known = new Map(); // pairId -> first-seen index
  let moves = 0;
  while (!g.winner && moves < 1000) {
    const addr = g.players[g.turn];
    const open = g.cards
      .map((c, i) => (!c.matched && !g.flipped.includes(i) ? i : null))
      .filter(v => v !== null);
    if (!open.length) break;
    // Try to complete a known pair; otherwise reveal the first unknown card.
    let pick = open.find(i => known.has(g.cards[i].pairId) && known.get(g.cards[i].pairId) !== i);
    if (pick === undefined) pick = open.find(i => !known.has(g.cards[i].pairId)) ?? open[0];
    const res = memory.applyMove(g, addr, { index: pick });
    if (res.error) break;
    if (g.flipped.length === 1 && !known.has(g.cards[pick].pairId)) {
      known.set(g.cards[pick].pairId, pick);
    }
    moves++;
    if (res.pendingMs) memory.resolve(g); // settle immediately in tests
  }
  return { game: g, moves };
}

test('createGame builds a shuffled 2n-card board from a deck', () => {
  const g = memory.createGame('0xA', '0xB', { deck: 'flags', pairs: 4 });
  assert.equal(g.cards.length, 8);
  const pairIds = g.cards.map(c => c.pairId);
  for (let id = 0; id < 4; id++) {
    assert.equal(pairIds.filter(p => p === id).length, 2);
  }
  assert.equal(g.turn, 'X');
  assert.equal(g.winner, null);
});

test('matching a pair scores and keeps the turn', () => {
  const g = memory.createGame('0xA', '0xB', { deck: 'flags', pairs: 4 });
  // Find an actual matching pair of indices by pairId.
  const ids = {};
  g.cards.forEach((c, i) => { (ids[c.pairId] ??= []).push(i); });
  const pairId = Object.keys(ids)[0];
  const [i, j] = ids[pairId];
  const seat = g.players.X;
  assert.ok(!memory.applyMove(g, seat, { index: i }).error);
  const res = memory.applyMove(g, seat, { index: j });
  assert.ok(!res.error);
  assert.ok(res.pendingMs > 0);
  memory.resolve(g);
  assert.equal(g.scores[seat], 1);
  assert.equal(g.turn, 'X'); // match keeps the turn
  assert.ok(g.cards[i].matched && g.cards[j].matched);
});

test('a mismatch passes the turn', () => {
  const g = memory.createGame('0xA', '0xB', { deck: 'flags', pairs: 4 });
  const ids = {};
  g.cards.forEach((c, i) => { (ids[c.pairId] ??= []).push(i); });
  const pairIds = Object.keys(ids);
  const [i] = ids[pairIds[0]];
  const [j] = ids[pairIds[1]]; // different pairIds
  const seat = g.players.X;
  memory.applyMove(g, seat, { index: i });
  memory.applyMove(g, seat, { index: j });
  memory.resolve(g);
  assert.equal(g.scores[seat], 0);
  assert.equal(g.turn, 'O');
  assert.ok(!g.cards[i].matched);
});

test('full first-seat win: perfect play wins every pair for seat X', () => {
  const { game, moves } = playMatch();
  assert.equal(game.winner, 'X');
  assert.equal(game.scores[game.players.X], 4);
  assert.equal(game.scores[game.players.O], 0);
  assert.ok(game.moves.length > 0);
  assert.ok(moves > 0);
});

test('rejects invalid flips: out of turn, foreign, after resolve lock', () => {
  const g = memory.createGame('0xA', '0xB', { deck: 'flags', pairs: 4 });
  assert.ok(memory.applyMove(g, '0xB', { index: 0 }).error);        // not their turn
  assert.ok(memory.applyMove(g, '0xEE', { index: 0 }).error);       // not a player
  assert.ok(!memory.applyMove(g, '0xA', { index: 0 }).error);        // X flips card 0
  g.resolving = true;                                               // simulate the reveal lock
  assert.ok(memory.applyMove(g, '0xA', { index: 1 }).error);        // locked while resolving
  memory.resolve(g);
});

test('serialize hides face-down card contents', () => {
  const g = memory.createGame('0xA', '0xB', { deck: 'flags', pairs: 4 });
  const s = memory.serialize(g);
  for (const c of s.cards) {
    if (!c.matched && !c.flipped) assert.equal(c.content, null);
  }
  assert.equal(s.locked, false);
});

test('botMove returns a legal open card', () => {
  const g = memory.createGame('0xA', '0xB', { deck: 'flags', pairs: 4 });
  const mv = memory.botMove(g);
  assert.ok(mv.index >= 0 && mv.index < g.cards.length);
});
