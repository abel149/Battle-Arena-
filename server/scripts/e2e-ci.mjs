import { io } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

const pk =
  process.env.WALLET_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const walletAddress = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

const issuedAt = Date.now();
const MATCH_MESSAGE = `Battle Arena login for ${walletAddress}\nIssued: ${issuedAt}`;

let socket;
let matchId;

function actOn(game) {
  if (!game || game.winner) return;
  const myTurn = game.players?.[game.turn]?.toLowerCase() === walletAddress.toLowerCase();
  if (!myTurn || game.locked) return;
  const available = (game.cards || [])
    .map((card, i) => (!card.matched && !card.flipped ? i : null))
    .filter((i) => i !== null);
  if (!available.length) return;
  const idx = available[0];
  setTimeout(() => socket.emit('game:move', { roomId: matchId, index: idx }), 80);
}

async function main() {
  console.log('[ci:e2e] connecting socket...');
  socket = io(SERVER_URL, { autoConnect: true });
  socket.on('connect', async () => {
    console.log(`[ci:e2e] connected as ${socket.id}`);
    // Identify with a real signed message
    const sig = await signMessage(pk, MATCH_MESSAGE);
    socket.emit('identify', {
      address: walletAddress,
      name: 'CI Runner',
      signature: sig,
      issuedAt,
    });
  });

  socket.on('player:registered', async () => {
    console.log('[ci:e2e] registered');
    // create a bot match
    socket.emit('match:bot', { gameType: 'memory' });
  });

  socket.on('match:start', (d) => {
    console.log(`[ci:e2e] match created room ${d.roomId}`);
    matchId = d.roomId;
    actOn(d.game);
  });

  socket.on('game:state', (payload) => {
    const g = payload.game;
    actOn(g);
  });

  socket.on('match:end', async (matchData) => {
    console.log(`[ci:e2e] match ended, winner=${matchData.winner}`);
    console.log('[ci:e2e] verifying on-chain record...');
    // verify via REST
    const matchIdStr = matchId;
    const r = await fetch(`${SERVER_URL}/api/matches/${matchIdStr}`);
    if (!r.ok) throw new Error(`match lookup failed: ${r.status}`);
    const match = await r.json();
    console.log('[ci:e2e] match on-chain:', JSON.stringify(match, null, 2));
    if (!match.txHash) throw new Error('no txHash on match');
    if (!match.resultHash) throw new Error('no resultHash on match');
    console.log('[ci:e2e] token + badge verification...');
    const t = await fetch(`${SERVER_URL}/api/wallet/${walletAddress}/tokens`);
    if (!t.ok) throw new Error(`tokens lookup failed: ${t.status}`);
    const tok = await t.json();
    console.log('[ci:e2e] tokens:', JSON.stringify(tok, null, 2));
    if (!tok.balance) throw new Error('no balance');
    if (tok.balance < 10) throw new Error('token balance too low');
    // replay
    const rep = await fetch(`${SERVER_URL}/api/replay/${matchIdStr}`);
    if (!rep.ok) throw new Error(`replay lookup failed: ${rep.status}`);
    const replay = await rep.json();
    console.log('[ci:e2e] replay moves:', replay.moves?.length);
    if (!replay.moves || replay.moves.length === 0) throw new Error('empty replay');
    // weekly leaderboard
    const lb = await fetch(`${SERVER_URL}/api/leaderboard/weekly`);
    if (!lb.ok) throw new Error(`leaderboard lookup failed: ${lb.status}`);
    const board = await lb.json();
    const me = board.find((p) => p.address === walletAddress);
    if (!me) throw new Error('player not in weekly leaderboard');
    console.log('[ci:e2e] weekly rank:', me.rank, 'pts:', me.points);
    console.log('[ci:e2e] ALL CHECKS PASSED');
    socket.disconnect();
    process.exit(0);
  });

  await new Promise((r) => setTimeout(r, 8000));
  console.log('[ci:e2e] timeout waiting for match end');
  process.exit(1);
}

async function signMessage(privateKeyHex, message) {
  const { ethers } = await import('ethers');
  const wallet = new ethers.Wallet(privateKeyHex);
  return wallet.signMessage(message);
}

main().catch((e) => {
  console.error('[ci:e2e] error:', e);
  process.exit(1);
});
