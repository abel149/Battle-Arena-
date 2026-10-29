import test from 'node:test';
import assert from 'node:assert/strict';
import * as mathArena from '../games/math-arena.js';

test('createGame sets up 8 questions, 3 lives each, and stores difficulty', () => {
  const g = mathArena.createGame('0xA', '0xB', { difficulty: 'hard' });
  assert.equal(g.questions.length, 8);
  assert.equal(g.lives.X, 3);
  assert.equal(g.lives.O, 3);
  assert.equal(g.difficulty, 'hard');
  assert.equal(g.scores.X, 0);
  assert.equal(g.scores.O, 0);
});

test('applyMove resolves round when both players answer', () => {
  const g = mathArena.createGame('0xA', '0xB');
  const q = g.questions[0];
  const correct = q.correct;
  const wrong = (correct + 1) % 4;

  const res1 = mathArena.applyMove(g, '0xA', { index: correct });
  assert.ok(!res1.error);
  assert.equal(g.answered.X, true);
  assert.equal(g.round, 0); // not resolved yet

  const res2 = mathArena.applyMove(g, '0xB', { index: wrong });
  assert.ok(!res2.error);
  assert.equal(g.round, 1); // resolved to next round
  assert.equal(g.scores.X, 20);
  assert.equal(g.lives.O, 2);
});

test('botMove accuracy differs between easy and hard difficulty', () => {
  const gEasy = mathArena.createGame('0xA', '0xB', { difficulty: 'easy' });
  let easyCorrect = 0;
  for (let i = 0; i < 100; i++) {
    const mv = mathArena.botMove(gEasy, 'easy');
    if (mv.index === gEasy.questions[0].correct) easyCorrect++;
  }

  const gHard = mathArena.createGame('0xA', '0xB', { difficulty: 'hard' });
  let hardCorrect = 0;
  for (let i = 0; i < 100; i++) {
    const mv = mathArena.botMove(gHard, 'hard');
    if (mv.index === gHard.questions[0].correct) hardCorrect++;
  }

  // Easy accuracy is ~35%, Hard accuracy is ~95%
  assert.ok(easyCorrect < 60, `Easy accuracy should be low (~35%), got ${easyCorrect}/100`);
  assert.ok(hardCorrect >= 85, `Hard accuracy should be high (~95%), got ${hardCorrect}/100`);
  assert.ok(hardCorrect > easyCorrect, 'Hard bot must outperform easy bot');
});
