// Inline debug: Hardhat node + MatchResult deploy + server + register + memory bot match + ledger dump
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { io } from 'socket.io-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = __dirname.replace('/scripts', '');
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
  execSync('node scripts/deploy-match-result.js', { cwd: SERVER_DIR, stdio: 'inherit', timeout: 30000, env: { ...process.env, NODE_HTTP_URL: NODE_URL, PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' } });
  if (!fs.existsSync(ADDRESS_FILE)) throw new Error('deploy did not write ' + ADDRESS_FILE);
  const raw = fs.readFileSync(ADDRESS_FILE, 'utf8');
  const cfg = JSON.parse(raw);
  log('deploy', `contract at ${cfg.address}`);
  return cfg.address;
}

async function startServer(contractAddress) {
  log('server', 'starting Battle Arena server');
  serverProc = spawn('node', ['index.js'], {
    cwd: SERVER_DIR,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      PORT: String(PORT),
      MATCH_RESULT_ADDRESS: contractAddress,
      NODE_HTTP_URL: NODE_URL,
      PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    },
  });
  for (let i = 1; i <= 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const out = execSync(`curl -s -o /dev/null -w '%{http_code}' ${SERVER_URL}/`, { cwd: SERVER_DIR, timeout: 3000 }).toString().trim();
      if (out === '404' || out === '200') {
        log('server', `HTTP up (status ${out}) after ${i}s`);
        return;
      }
    } catch { /* not ready yet */ }
    if (i === 30) {
      const err = new Error('Server did not become reachable after 30s');
      console.error('server stderr:', serverProc.stderr ? serverProc.stderr.read() : 'n/a');
      throw err;
    }
  }
}

async function registerPlayer() {
  log('register', 'registering player');
  // Real secp256k1 key so the wallet can sign its ownership proof.
  const signer = ethers.Wallet.createRandom();
  const wallet = signer.address;
  const username = 'OnchainTest_' + crypto.randomBytes(4).toString('hex');
  const password = 'securepass123';
  const body = JSON.stringify({ address: wallet, username, password });
  const r = execSync(`curl -s -X POST ${SERVER_URL}/api/register -H 'Content-Type: application/json' -d '${body.replace(/'/g, "%27")}'`, { cwd: SERVER_DIR, timeout: 10000 });
  const reg = JSON.parse(r.toString());
  if (reg.error) throw new Error('register failed: ' + JSON.stringify(reg));
  log('register', `registered ${username} -> ${wallet.slice(0,10)}…`);
  log('register', `password stripped: ${'password' in reg ? 'NO' : 'YES'}`);
  return { wallet, username, password, signer };
}

async function loginPlayer({ username, password }) {
  log('login', 'logging in by credentials');
  const r = execSync(`curl -s -X POST ${SERVER_URL}/api/login -H 'Content-Type: application/json' -d '{"username":"${username}","password":"${password}"}'`, { cwd: SERVER_DIR, timeout: 10000 });
  const login = JSON.parse(r.toString());
  if (login.error) throw new Error('login failed: ' + JSON.stringify(login));
  log('login', `login OK, password stripped: ${'password' in login ? 'NO' : 'YES'}`);
  return login;
}

async function playBotMatch({ wallet, signer }) {
  log('match', 'connecting socket to play a bot match');
  return new Promise((resolve, reject) => {
    const socket = io(SERVER_URL, { reconnection: false, timeout: 25000 });
    let roomId = null;
    let moves = 0;
    const started = Date.now();

    socket.on('connect', async () => {
      log('match', 'socket connected, identifying');
      const issuedAt = Date.now();
      const sig = await signer.signMessage(`Battle Arena login for ${wallet}\nIssued: ${issuedAt}`);
      socket.emit('identify', { address: wallet, name: 'OnchainTest', signature: sig, issuedAt });
    });

    socket.on('identify', () => {}); // no-op listener, just in case

    socket.on('match:start', (d) => {
      roomId = d.roomId;
      log('match', `match start: ${roomId} game=${d.gameType} deck=${d.deck}`);
      log('match', `game state: ${JSON.stringify(d.game).slice(0, 300)}`);
      actOn(d.game);
    });

    socket.on('game:state', ({ game }) => {
      log('match', `game:state turn=${game.turn} locked=${game.locked} winner=${game.winner} moveCount=${game.moveCount}`);
      actOn(game);
    });

    function actOn(game) {
      if (!game || game.winner) return;
      const myTurn = game.players[game.turn] === wallet;
      log('match', `actOn: myTurn=${myTurn} turn=${game.turn} players=${JSON.stringify(game.players)}`);
      if (!myTurn || game.locked) return;
      const idx = game.cards.findIndex(c => !c.matched && !c.flipped);
      log('match', `actOn: available card index=${idx}`);
      if (idx === -1) return;
      moves++;
      setTimeout(() => socket.emit('game:move', { roomId, index: idx }), 80);
    }

    socket.on('match:end', (d) => {
      log('match', `match end: result=${d.result} winner=${d.winner}`);
      log('match', `receipt: ${JSON.stringify(d.receipt)}`);
      socket.disconnect();
      resolve({ roomId, moves, receipt: d.receipt });
    });

    socket.on('game:error', (e) => { log('match', 'game:error ' + JSON.stringify(e)); });
    socket.on('player:error', (e) => { log('match', 'player:error ' + JSON.stringify(e)); });
    socket.on('connect_error', (e) => { log('match', 'connect_error ' + e.message); });

    setTimeout(() => {
      log('match', 'TIMEOUT: match did not finish');
      socket.disconnect();
      reject(new Error('match did not finish in time'));
    }, 70000);
  });
}

async function verifyLedger(matchId) {
  log('verify', 'querying on-chain ledger');
  const r = execSync(`curl -s ${SERVER_URL}/api/matches`, { cwd: SERVER_DIR, timeout: 10000 });
  const ledger = JSON.parse(r.toString());
  log('verify', `on-chain matches count: ${ledger.length}`);
  log('verify', `ledger: ${JSON.stringify(ledger, null, 2).slice(0, 1000)}`);
  const entry = ledger.find(e => e.matchId === matchId);
  if (!entry) throw new Error('match not found on-chain: ' + matchId);
  log('verify', `found on-chain: ${JSON.stringify(entry)}`);
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
    const { wallet, username, password, signer } = await registerPlayer();
    await loginPlayer({ username, password });
    const { roomId, moves, receipt } = await playBotMatch({ wallet, signer });
    if (!receipt || !receipt.matchId) throw new Error('no receipt returned');
    const entry = await verifyLedger(receipt.matchId);
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
