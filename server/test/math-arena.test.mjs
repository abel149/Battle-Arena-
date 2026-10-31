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

test('timeoutRound deducts life from unanswered seats and resolves round', () => {
  const g = mathArena.createGame('0xA', '0xB');
  // 0xA answers correctly, 0xB does not answer
  const correct = g.questions[0].correct;
  mathArena.applyMove(g, '0xA', { index: correct });
  assert.equal(g.round, 0);

  const res = mathArena.timeoutRound(g);
  assert.ok(res.ok);
  assert.equal(res.timedOut, true);
  assert.equal(g.round, 1);
  assert.equal(g.scores.X, 20);
  assert.equal(g.lives.O, 2); // 0xB lost life on timeout
});

test('rejects double answers and foreign players in Math Arena', () => {
  const g = mathArena.createGame('0xA', '0xB');
  // First answer locks
  const r1 = mathArena.applyMove(g, '0xA', { index: 1 });
  assert.ok(!r1.error);
  assert.equal(g.answered.X, true);

  // Second answer by same player in same round rejected
  const r2 = mathArena.applyMove(g, '0xA', { index: 2 });
  assert.equal(r2.error, 'Answer already locked');

  // Foreign player rejected
  const r3 = mathArena.applyMove(g, '0xForeign', { index: 0 });
  assert.equal(r3.error, 'Not a player in this game');
});

test('game terminates with winner when a player loses all 3 lives', () => {
  const g = mathArena.createGame('0xA', '0xB');
  // 3 rounds of wrong answers for O, correct for X
  for (let r = 0; r < 3; r++) {
    const q = g.questions[g.round];
    const correct = q.correct;
    const wrong = (correct + 1) % 4;
    mathArena.applyMove(g, '0xA', { index: correct });
    mathArena.applyMove(g, '0xB', { index: wrong });
  }
  assert.equal(g.lives.O, 0);
  assert.equal(g.lives.X, 3);
  assert.equal(g.winner, 'X');

  // Any further move after game over is rejected
  const afterOver = mathArena.applyMove(g, '0xA', { index: 0 });
  assert.equal(afterOver.error, 'Game is over');
});
