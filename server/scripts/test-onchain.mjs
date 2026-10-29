// End-to-end verification for the local Hardhat deployment.
// Run from server/: npm run test:onchain
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { io } from 'socket.io-client';
import { ethers } from 'ethers';

const SERVER_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 3001;
const NODE_PORT = 8545;
const NODE_URL = `http://127.0.0.1:${NODE_PORT}`;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const deploymentFile = path.join(SERVER_DIR, `.match-result-test-${process.pid}.json`);
const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
let hardhatProc;
let serverProc;

function log(tag, message) { console.log(`[${tag}] ${message}`); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForHttp(url, expectedStatus, { timeoutMs = 40000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (expectedStatus(response.status)) {
        log('wait', `HTTP ready at ${url} after ${attempts} attempts`);
        return;
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        log('wait', `fetch to ${url} timed out on attempt ${attempts}`);
      } else {
        if (attempts % 20 === 1) log('wait', `fetch to ${url} failed: ${e.message}`);
      }
    }
    await sleep(intervalMs);
  }
  throw new Error(`HTTP service did not become ready: ${url} (waited ${timeoutMs}ms, ${attempts} attempts)`);
}

async function startHardhatNode() {
  hardhatProc = spawn('npx', ['hardhat', 'node', '--port', String(NODE_PORT), '--chain-id', '31337'], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
  });
  await waitForHttp(NODE_URL, status => status === 404 || status === 200);
  const rpc = await fetch(NODE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
  });
  const { result } = await rpc.json();
  if (Number(BigInt(result)) !== 31337) throw new Error(`Expected local chain 31337, got ${result}`);
}

function deployContract() {
  log('deploy', 'deploying MatchResult to ephemeral local chain');
  execFileSync(process.execPath, ['scripts/deploy-match-result.js'], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_HTTP_URL: NODE_URL,
      PRIVATE_KEY: privateKey,
      DEPLOYMENT_NETWORK: 'hardhat-local',
      MATCH_RESULT_DEPLOYMENT_FILE: deploymentFile,
    },
  });
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  if (deployment.chainId !== 31337) throw new Error(`Unexpected deployment chain id ${deployment.chainId}`);
  return deployment.address;
}

async function startServer(contractAddress) {
  serverProc = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(PORT),
      MATCH_RESULT_ADDRESS: contractAddress,
      MATCH_RESULT_CHAIN_ID: '31337',
      NODE_HTTP_URL: NODE_URL,
      PRIVATE_KEY: privateKey,
    },
  });
  await waitForHttp(SERVER_URL, status => status === 404 || status === 200, { timeoutMs: 40000 });
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const listener = value => {
      if (!predicate(value)) return;
      clearTimeout(timeout);
      socket.off(event, listener);
      resolve(value);
    };
    socket.on(event, listener);
  });
}

async function playMatch() {
  // Real secp256k1 key so the wallet can sign its ownership proof.
  const signer = ethers.Wallet.createRandom();
  const wallet = signer.address;
  const socket = io(SERVER_URL, { reconnection: false, timeout: 10000 });
  try {
    await onceConnected(socket);
    const sig = await signer.signMessage(`Battle Arena login for ${wallet}`);
    socket.emit('identify', { address: wallet, name: 'OnchainTest', signature: sig });
    const start = waitFor(socket, 'match:start');
    socket.emit('match:bot', { gameType: 'memory', deck: 'flags', pairs: 2 });
    const match = await start;
    let lastMoveCount = -1;
    socket.on('game:state', ({ roomId, game }) => {
      if (roomId !== match.roomId || game.winner || game.locked
        || game.players[game.turn] !== wallet || game.moveCount === lastMoveCount) return;
      const index = game.cards.findIndex(card => !card.matched && !card.flipped);
      if (index < 0) return;
      lastMoveCount = game.moveCount;
      setTimeout(() => socket.emit('game:move', { roomId, index }), 80);
    });
    const ended = waitFor(socket, 'match:end', () => true, 60000);
    const index = match.game.cards.findIndex(card => !card.matched && !card.flipped);
    socket.emit('game:move', { roomId: match.roomId, index });
    return await ended;
  } finally {
    socket.disconnect();
  }
}

function onceConnected(socket) {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

async function verifyReceipt(matchEnd) {
  const { receipt } = matchEnd;
  if (!receipt?.matchId || !receipt.txHash) throw new Error('Match receipt is missing its ID or transaction hash');
  const response = await fetch(`${SERVER_URL}/api/verify/${encodeURIComponent(receipt.matchId)}`);
  if (!response.ok) throw new Error(`Verify endpoint returned HTTP ${response.status}`);
  const verification = await response.json();
  if (!verification.valid) throw new Error(`Receipt match ID ${receipt.matchId} did not verify`);
  if (verification.entry.matchId !== receipt.matchId) throw new Error('Verified match ID differs from receipt match ID');
  if (verification.entry.txHash !== receipt.txHash) throw new Error('Ledger transaction hash differs from receipt transaction hash');
  const tx = await fetch(`${NODE_URL}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionByHash', params: [receipt.txHash], id: 2 }),
  }).then(response => response.json());
  if (!tx.result) throw new Error(`Transaction ${receipt.txHash} not found on local chain`);
  log('verify', `match ${receipt.matchId} verified with transaction ${receipt.txHash}`);
  return verification.entry;
}

async function cleanup() {
  for (const child of [serverProc, hardhatProc]) {
    if (!child || child.exitCode !== null) continue;
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), sleep(2000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  try { fs.unlinkSync(deploymentFile); } catch { /* no file if deployment failed */ }
}

async function once(child, event) {
  return new Promise(resolve => child.once(event, resolve));
}

try {
  await startHardhatNode();
  const contractAddress = deployContract();
  await startServer(contractAddress);
  const result = await playMatch();
  const verified = await verifyReceipt(result);
  log('RESULT', `PASS: ${verified.matchId} verified with actual chain transaction hash ${verified.txHash}`);
} catch (error) {
  console.error('[ERROR]', error);
  process.exitCode = 1;
} finally {
  await cleanup();
}
