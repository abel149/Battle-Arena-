// Memory Match game engine — pluggable module.
// Turn-based: flip two cards; a match scores a point and keeps the turn,
// a mismatch flips both back and passes the turn.
// Interface: createGame(pX, pO, opts), applyMove(game, address, move),
//            resolve(game), botMove(game), serialize(game)

import { DECKS } from './decks.js';

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const REVEAL_MS = 900; // how long a mismatched pair stays face-up

export function createGame(addrX, addrO, opts = {}) {
  const deckId = DECKS[opts.deck] ? opts.deck : 'flags';
  const n = Math.min(opts.pairs || 8, DECKS[deckId].pairs.length);
  const picked = shuffle([...DECKS[deckId].pairs]).slice(0, n);
  const cards = shuffle(picked.flatMap((p, i) => [
    { pairId: i, content: p.a, matched: false },
    { pairId: i, content: p.b, matched: false },
  ]));
  const difficulty = ['easy', 'medium', 'hard'].includes(opts?.difficulty)
    ? opts.difficulty
    : 'medium';
  return {
    deck: deckId,
    deckLabel: DECKS[deckId].label,
    cards,
    flipped: [],                       // indices currently face-up (max 2)
    scores: { [addrX]: 0, [addrO]: 0 },
    players: { X: addrX, O: addrO },
    turn: 'X',
    difficulty,
    seen: {},                          // index -> pairId of cards revealed during game
    moves: [],
    winner: null,
    resolving: false,                  // a pair is face-up waiting to resolve
  };
}

export function applyMove(game, address, move) {
  if (game.winner) return { error: 'Game is over' };
  if (game.resolving || game.flipped.length >= 2) return { error: 'Wait for cards to resolve' };
  const seat =
    game.players.X === address ? 'X' :
    game.players.O === address ? 'O' : null;
  if (!seat) return { error: 'Not a player in this game' };
  if (seat !== game.turn) return { error: 'Not your turn' };
  const index = move?.index;
  const card = game.cards[index];
  if (!card || card.matched || game.flipped.includes(index)) return { error: 'Invalid card' };

  game.flipped.push(index);
  game.seen[index] = card.pairId;
  game.moves.push({ index, address, t: Date.now() });

  if (game.flipped.length === 2) {
    game.resolving = true;
    return { ok: true, pendingMs: REVEAL_MS };
  }
  return { ok: true };
}

// Called by the server `pendingMs` after a second card was flipped
export function resolve(game) {
  if (game.flipped.length !== 2) { game.resolving = false; return; }
  const [i, j] = game.flipped;
  const a = game.cards[i], b = game.cards[j];
  if (a.pairId === b.pairId) {
    a.matched = b.matched = true;
    game.scores[game.players[game.turn]] += 1;
    // matching keeps the turn
  } else {
    game.turn = game.turn === 'X' ? 'O' : 'X';
  }
  game.flipped = [];
  game.resolving = false;

  const totalPairs = game.cards.length / 2;
  const sX = game.scores[game.players.X];
  const sO = game.scores[game.players.O];
  if (sX + sO === totalPairs) {
    game.winner = sX === sO ? 'draw' : sX > sO ? 'X' : 'O';
  }
}

export function botMove(game, difficulty = game.difficulty || 'medium') {
  const open = game.cards
    .map((c, i) => (!c.matched && !game.flipped.includes(i) ? i : null))
    .filter(v => v !== null);
  if (open.length === 0) return { index: 0 };

  const unseen = open.filter(i => game.seen[i] === undefined);

  // Group open cards that have already been seen by pairId
  const seenByPair = {};
  for (const i of open) {
    if (game.seen[i] !== undefined) {
      const pid = game.seen[i];
      (seenByPair[pid] ??= []).push(i);
    }
  }

  // Case 1: First card is already face-up on this turn
  if (game.flipped.length === 1) {
    const firstIdx = game.flipped[0];
    const targetPairId = game.cards[firstIdx].pairId;
    const matchIdx = open.find(i => game.seen[i] === targetPairId);

    // Recall rate: easy 20%, medium 65%, hard 95%
    const recallRate =
      difficulty === 'easy' ? 0.20 :
      difficulty === 'hard' ? 0.95 : 0.65;

    if (matchIdx !== undefined && Math.random() < recallRate) {
      return { index: matchIdx };
    }

    // When not recalling or match unknown, prefer exploring unseen cards (except on easy)
    if (unseen.length > 0 && difficulty !== 'easy') {
      return { index: unseen[Math.floor(Math.random() * unseen.length)] };
    }
    return { index: open[Math.floor(Math.random() * open.length)] };
  }

  // Case 2: Opening pick of the turn
  const knownPairs = Object.values(seenByPair).filter(arr => arr.length === 2);
  const pairRecallRate =
    difficulty === 'easy' ? 0.15 :
    difficulty === 'hard' ? 0.95 : 0.60;

  if (knownPairs.length > 0 && Math.random() < pairRecallRate) {
    const chosenPair = knownPairs[Math.floor(Math.random() * knownPairs.length)];
    return { index: chosenPair[0] };
  }

  // Explore unseen cards to build knowledge
  if (unseen.length > 0 && (difficulty === 'hard' || Math.random() < 0.70)) {
    return { index: unseen[Math.floor(Math.random() * unseen.length)] };
  }

  return { index: open[Math.floor(Math.random() * open.length)] };
}

// Only reveal card content when face-up — server stays authoritative
export function serialize(game) {
  return {
    deck: game.deck,
    deckLabel: game.deckLabel,
    difficulty: game.difficulty,
    cards: game.cards.map((c, i) => ({
      matched: c.matched,
      flipped: game.flipped.includes(i),
      content: c.matched || game.flipped.includes(i) ? c.content : null,
    })),
    scores: game.scores,
    players: game.players,
    turn: game.turn,
    winner: game.winner,
    locked: game.resolving || game.flipped.length >= 2,
    moveCount: game.moves.length,
  };
}
