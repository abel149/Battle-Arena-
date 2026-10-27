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
  return {
    deck: deckId,
    deckLabel: DECKS[deckId].label,
    cards,
    flipped: [],                       // indices currently face-up (max 2)
    scores: { [addrX]: 0, [addrO]: 0 },
    players: { X: addrX, O: addrO },
    turn: 'X',
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

export function botMove(game) {
  const open = game.cards
    .map((c, i) => (!c.matched && !game.flipped.includes(i) ? i : null))
    .filter(v => v !== null);
  return { index: open[Math.floor(Math.random() * open.length)] };
}

// Only reveal card content when face-up — server stays authoritative
export function serialize(game) {
  return {
    deck: game.deck,
    deckLabel: game.deckLabel,
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
