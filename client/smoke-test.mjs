// Smoke test: plays a full Memory Match vs the bot over Socket.IO.
// Run from client/:  node smoke-test.mjs
import { io } from 'socket.io-client';
import { ethers } from 'ethers';

const socket = io(process.env.SERVER_URL || 'http://localhost:3001');
// Real secp256k1 key so the wallet can sign its ownership proof.
const signer = ethers.Wallet.createRandom();
const me = signer.address;
let roomId = null;
let moves = 0;

socket.on('connect', async () => {
  console.log('connected');
  const issuedAt = Date.now();
  const sig = await signer.signMessage(`Battle Arena login for ${me}\nIssued: ${issuedAt}`);
  socket.emit('identify', { address: me, name: 'SmokeTest', signature: sig, issuedAt });
});

socket.on('match:start', (d) => {
  roomId = d.roomId;
  console.log(`match started: ${roomId} game=${d.gameType} deck=${d.deck}`);
  actOn(d.game);
});

socket.on('game:state', ({ game }) => actOn(game));

function actOn(game) {
  if (!game || game.winner) return;
  const scores = Object.values(game.scores || {}).join('-');
  console.log(`state: turn=${game.turn} locked=${game.locked} moves=${game.moveCount} score=${scores}`);
  const myTurn = game.players[game.turn] === me;
  if (!myTurn || game.locked) return;
  // Flip the first available unmatched, unflipped card
  const idx = game.cards.findIndex(c => !c.matched && !c.flipped);
  if (idx === -1) return;
  moves++;
  setTimeout(() => socket.emit('game:move', { roomId, index: idx }), 80);
}

socket.on('game:error', e => console.log('game:error', e));

// Playing needs a registered account: register this throwaway wallet first.
socket.on('player:registered', (yes) => {
  if (!yes) socket.emit('player:register', {
    username: 'smoke_' + Math.random().toString(36).slice(2, 8),
    password: 'password123',
  });
});

socket.on('auth:success', () => {
  if (!roomId) socket.emit('match:bot', { gameType: 'memory', deck: 'flags', pairs: 4 });
});

socket.on('player:error', (e) => { console.log('player:error', e); process.exit(1); });

socket.on('match:end', (d) => {
  console.log(`match end: result=${d.result} winner=${d.winner}`);
  console.log(`receipt: matchId=${d.receipt.matchId}`);
  console.log(`  txHash=${d.receipt.txHash.slice(0, 18)}…  hash=${d.receipt.resultHash.slice(0, 18)}…`);
  console.log(`human flips made: ${moves}`);
  socket.disconnect();
  process.exit(0);
});

setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 120000);
