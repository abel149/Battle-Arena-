// Smoke test: plays a full Memory Match vs the bot over Socket.IO.
// Run from client/:  node smoke-test.mjs
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001');
const me = '0x' + 'ab'.repeat(20);
let roomId = null;
let moves = 0;

socket.on('connect', () => {
  console.log('connected');
  socket.emit('identify', { address: me, name: 'SmokeTest' });
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

socket.on('player:update', () => {
  if (!roomId) socket.emit('match:bot', { gameType: 'memory', deck: 'flags', pairs: 4 });
});

socket.on('match:end', (d) => {
  console.log(`match end: result=${d.result} winner=${d.winner}`);
  console.log(`receipt: matchId=${d.receipt.matchId}`);
  console.log(`  txHash=${d.receipt.txHash.slice(0, 18)}…  hash=${d.receipt.resultHash.slice(0, 18)}…`);
  console.log(`human flips made: ${moves}`);
  socket.disconnect();
  process.exit(0);
});

setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 120000);
