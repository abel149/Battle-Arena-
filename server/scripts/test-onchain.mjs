// End-to-end on-chain verification.
// 1. Start a local Hardhat node.
// 2. Deploy MatchResult (reusing the address if already deployed in this session).
// 3. Start the Battle Arena server with MATCH_RESULT_ADDRESS + NODE_HTTP_URL set.
// 4. Register a player + play a bot match via the REST/socket API.
// 5. Read the on-chain ledger and assert a match was recorded.
//
// Run from server/:  node scripts/test-onchain.mjs

import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = __dirname;
const ADDRESS_FILE = path.join(SERVER_DIR, 'match-result-address.json');

const PORT = 3001;
const NODE_PORT = 8545;
const NODE_URL = `http://127.0.0.1:${NODE_PORT}`;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

let hardhatProc = null;
let serverProc = null;

function log(tag, msg) { console.log(`[${tag}] ${msg}`); }

async function startHardhatNode() {
  log('node', 'starting Hardhat node');
  hardhatProc = spawn('npx', ['hardhat', 'node', '--port', String(NODE_PORT), '--chain-id', '31337'], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_HTTP_URL: NODE_URL },
  });
  // Wait for the RPC to be reachable.
  for (let i = 1; i <= 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      execSync(`curl -s -X POST -H 'Content-Type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' ${NODE_URL}`, { cwd: SERVER_DIR, timeout: 3000 });
      log('node', `RPC reachable after ${i}s`);
      return;
    } catch {
      if (i === 30) throw new Error('Hardhat node did not become reachable');
    }
  }
}

async function deployContract() {
  log('deploy', 'deploying MatchResult');
  execSync('node scripts/deploy-match-result.js', { cwd: SERVER_DIR, stdio: 'inherit', env: { ...process.env, NODE_HTTP_URL: NODE_URL } });
  const raw = fs.readFileSync(ADDRESS_FILE, 'utf8');
  const cfg = JSON.parse(raw);
  log('deploy', `contract at ${cfg.address}`);
  return cfg.address;
}

async function startServer(contractAddress) {
  log('server', 'starting Battle Arena server');
  serverProc = spawn('node', ['index.js'], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: String(PORT),
      MATCH_RESULT_ADDRESS: contractAddress,
      NODE_HTTP_URL: NODE_URL,
      PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    },
  });
  // Wait for the HTTP server to respond.
  for (let i = 1; i <= 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const out = execSync(`curl -s -o /dev/null -w '%{http_code}' ${SERVER_URL}/`, { cwd: SERVER_DIR, timeout: 3000 }).toString().trim();
      if (out === '404' || out === '200') {
        log('server', `HTTP up (status ${out}) after ${i}s`);
        return;
      }
    } catch { /* not ready yet */ }
    if (i === 30) throw new Error('Server did not become reachable');
  }
}

async function registerAndPlay() {
  log('e2e', 'registering player');
  const wallet = '0x' + crypto.randomBytes(20).toString('hex');
  const username = 'OnchainTest_' + crypto.randomBytes(4).toString('hex');
  const password = 'securepass123';

  let body = JSON.stringify({ address: wallet, username, password });
  let r = execSync(`curl -s -X POST ${SERVER_URL}/api/register -H 'Content-Type: application/json' -d '${body.replace(/'/g, "%27")}'`, { cwd: SERVER_DIR, timeout: 10000 });
  const reg = JSON.parse(r.toString());
  if (reg.error) throw new Error('register failed: ' + JSON.stringify(reg));
  log('e2e', `registered ${username} -> ${wallet.slice(0,10)}… (password stripped: ${'password' in reg ? 'NO' : 'YES'})`);

  // Log in by credentials.
  r = execSync(`curl -s -X POST ${SERVER_URL}/api/login -H 'Content-Type: application/json' -d '{"username":"${username}","password":"${password}"}'`, { cwd: SERVER_DIR, timeout: 10000 });
  const login = JSON.parse(r.toString());
  if (login.error) throw new Error('login failed: ' + JSON.stringify(login));
  log('e2e', `login OK (password stripped: ${'password' in login ? 'NO' : 'YES'})`);

  // Play a bot match via socket.io.
  log('e2e', 'connecting socket to play a bot match');
  const { io } = await import('socket.io-client');
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, { reconnection: false, timeout: 20000 });
    let roomId = null;
    let moves = 0;
    const finished = () => socket.disconnect();

    socket.on('connect', () => {
      socket.emit('identify', { address: wallet, name: 'OnchainTest' });
    });

    socket.on('match:start', (d) => {
      roomId = d.roomId;
      log('e2e', `match start: ${roomId} game=${d.gameType} deck=${d.deck}`);
      actOn(d.game);
    });

    socket.on('game:state', ({ game }) => actOn(game));

    function actOn(game) {
      if (!game || game.winner) return;
      const myTurn = game.players[game.turn] === wallet;
      if (!myTurn || game.locked) return;
      const idx = game.cards.findIndex(c => !c.matched && !c.flipped);
      if (idx === -1) return;
      moves++;
      setTimeout(() => socket.emit('game:move', { roomId, index: idx }), 80);
    }

    socket.on('match:end', (d) => {
      log('e2e', `match end: result=${d.result} winner=${d.winner} moves=${d.receipt.matchId ? 'on-chain' : 'NO RECEIPT'}`);
      log('e2e', `receipt matchId=${d.receipt.matchId} txHash=${d.receipt.txHash?.slice(0,24)}…`);
      finished();
      resolve({ roomId, moves, receipt: d.receipt });
    });

    socket.on('game:error', (e) => { log('e2e', 'game:error ' + JSON.stringify(e)); });

    socket.on('player:error', (e) => { log('e2e', 'player:error ' + JSON.stringify(e)); });

    setTimeout(() => { log('e2e', 'TIMEOUT'); finished(); reject(new Error('match did not finish in time')); }, 60000);
  });
}

async function verifyOnChain(matchId) {
  log('verify', 'querying on-chain ledger');
  const r = execSync(`curl -s ${SERVER_URL}/api/matches`, { cwd: SERVER_DIR, timeout: 10000 });
  const ledger = JSON.parse(r.toString());
  log('verify', `on-chain matches: ${ledger.length}`);

  const entry = ledger.find(e => e.matchId === matchId);
  if (!entry) throw new Error('match not found on-chain: ' + matchId);
  log('verify', `found on-chain: matchId=${entry.matchId} winner=${entry.winner} txHash=${entry.txHash?.slice(0,24)}…`);
  return entry;
}

async function cleanup() {
  log('cleanup', 'stopping processes');
  if (serverProc) { serverProc.kill(); await new Promise(r => setTimeout(r, 1000)); }
  if (hardhatProc) { hardhatProc.kill(); await new Promise(r => setTimeout(r, 1000)); }
}

async function main() {
  try {
    await startHardhatNode();
    const contractAddress = await deployContract();
    await startServer(contractAddress);
    const { roomId, moves, receipt } = await registerAndPlay();
    if (!receipt || !receipt.matchId) throw new Error('no receipt returned');
    const entry = await verifyOnChain(receipt.matchId);
    log('RESULT', 'ON-CHAIN E2E PASSED');
    console.log(JSON.stringify({ roomId, moves, receipt, onChainEntry: entry }, null, 2));
  } catch (err) {
    log('ERROR', err.message);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main();
