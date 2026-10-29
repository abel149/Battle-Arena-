#!/usr/bin/env bash
# End-to-end on-chain verification (single-process, so the node stays alive).
# 1. Start a Hardhat node in the foreground (we background it ourselves).
# 2. Deploy MatchResult.sol.
# 3. Start the Battle Arena server pointed at the contract.
# 4. Register a player, log in by credentials, and play a bot match via socket.io.
# 5. Check that receipt and ledger match IDs and transaction hashes agree.
#
# Run from server/:  bash scripts/e2e-onchain.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PORT=3001
NODE_PORT=8545
NODE_URL="http://127.0.0.1:${NODE_PORT}"
SERVER_URL="http://127.0.0.1:${PORT}"
ADDRESS_FILE=".match-result-e2e-${$}.json"
TOKENS_FILE=".tokens-e2e-${$}.json"
export AUTH_MSG_PREFIX="Battle Arena login for "

cleanup() {
  echo "[cleanup] stopping processes"
  fuser -k ${PORT}/tcp 2>/dev/null || true
  fuser -k ${NODE_PORT}/tcp 2>/dev/null || true
  rm -f "${ADDRESS_FILE}" "${TOKENS_FILE}" /tmp/match-id.txt
  rm -f "${PWD}"/.e2e-arena-*.sqlite "${PWD}"/.e2e-arena-*.sqlite-wal "${PWD}"/.e2e-arena-*.sqlite-shm 2>/dev/null || true
}
trap cleanup EXIT

log() { echo "[$(date +%H:%M:%S)] $*"; }

# ---- 0. Make sure nothing is on our ports already ----
fuser -k ${PORT}/tcp 2>/dev/null || true
fuser -k ${NODE_PORT}/tcp 2>/dev/null || true
sleep 1

# ---- 1. Start Hardhat node (stay alive for the rest of the script) ----
log "node: starting Hardhat node on ${NODE_PORT}"
npx hardhat node --port ${NODE_PORT} --chain-id 31337 > /tmp/hardhat-node.log 2>&1 &
HARDHAT_PID=$!
log "node: PID ${HARDHAT_PID}"

# Wait for RPC to be reachable.
for i in $(seq 1 30); do
  if curl -s -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "${NODE_URL}" >/dev/null 2>&1; then
    log "node: RPC reachable after ${i}s"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[node] Hardhat node did not become reachable"; exit 1
  fi
  sleep 1
done

# ---- 2. Deploy MatchResult (same shell, so env + node connect) ----
log "deploy: deploying MatchResult"
export NODE_HTTP_URL="${NODE_URL}"
export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
MATCH_RESULT_DEPLOYMENT_FILE="${ADDRESS_FILE}" DEPLOYMENT_NETWORK="hardhat-local" node scripts/deploy-match-result.js
CONTRACT_ADDR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('${ADDRESS_FILE}','utf8')).address)")
log "deploy: deployed to ${CONTRACT_ADDR}"

log "deploy: deploying ArenaToken + ArenaBadges"
TOKEN_DEPLOYMENT_FILE="${TOKENS_FILE}" DEPLOYMENT_NETWORK="hardhat-local" node scripts/deploy-tokens.js
read -r TOKEN_ADDR BADGE_ADDR <<< "$(node -e "const d=JSON.parse(require('fs').readFileSync('${TOKENS_FILE}','utf8'));console.log(d.arenaToken+' '+d.arenaBadges)")"
log "deploy: tokens ${TOKEN_ADDR} / badges ${BADGE_ADDR}"

# ---- 3. Start Battle Arena server ----
log "server: starting server on ${PORT}"
export MATCH_RESULT_ADDRESS="${CONTRACT_ADDR}"
export MATCH_RESULT_CHAIN_ID=31337
export ARENA_TOKEN_ADDRESS="${TOKEN_ADDR}"
export ARENA_BADGES_ADDRESS="${BADGE_ADDR}"
export NODE_HTTP_URL="${NODE_URL}"
export PRIVATE_KEY="${PRIVATE_KEY}"
# Fresh throwaway DB per run — e2e wallets register from scratch every time.
E2E_DB="${PWD}/.e2e-arena-${$}.sqlite"
export ARENA_DB_PATH="${E2E_DB}"
export PORT
node index.js > /tmp/battle-arena-server.log 2>&1 &
SERVER_PID=$!
log "server: PID ${SERVER_PID}"

# Wait for HTTP to respond.
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "${SERVER_URL}/" 2>/dev/null || true)
  if [ "$CODE" = "404" ] || [ "$CODE" = "200" ]; then
    log "server: HTTP up (status ${CODE}) after ${i}s"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "[server] server did not become reachable"; exit 1
  fi
  sleep 1
done

# ---- 4. Register + login (verify no password leak) ----
log "e2e: registering player"
# Use a deterministic private key for the E2E wallet so we can sign in the test.
export WALLET_PK="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
# Derive the REAL address from the key (string slicing is not how addresses work).
WALLET=$(node -e "console.log(new (require('ethers').Wallet)(process.env.WALLET_PK).address)")
USERNAME="OnchainTest_$(openssl rand -hex 4)"
PASSWORD="securepass123"
export WALLET_PK

REG=$(curl -s -X POST "${SERVER_URL}/api/register" \
  -H 'Content-Type: application/json' \
  -d "{\"address\":\"${WALLET}\",\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")
echo "register response: ${REG}"
if echo "${REG}" | grep -q '"password"'; then
  echo "[e2e] FAIL: password leaked in register response"; exit 1
fi
log "e2e: registered, password not in response"

LOGIN=$(curl -s -X POST "${SERVER_URL}/api/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")
echo "login response: ${LOGIN}"
if echo "${LOGIN}" | grep -q '"password"'; then
  echo "[e2e] FAIL: password leaked in login response"; exit 1
fi
log "e2e: login OK, password not in response"

# ---- 5. Play a bot match via socket.io ----
log "e2e: connecting socket to play a bot match"
node - <<'NODEJS'
import { io } from 'socket.io-client';
import fs from 'fs';
import { ethers } from 'ethers';

console.log('E2E_NODE_IMPORTED OK');
const SERVER_URL = process.env.SERVER_URL;
const WALLET_PK = process.env.WALLET_PK;
const USERNAME = process.env.USERNAME;
const PORT = Number(process.env.PORT);
const WALLET = new ethers.Wallet(WALLET_PK).address;

console.log('E2E_NODE WALLET=' + WALLET + ' PK=' + WALLET_PK);

async function signMessage(privateKeyHex, message) {
  // Standard EIP-191 personal message signature — exactly what MetaMask's
  // personal_sign produces, and what the server verifies.
  return new ethers.Wallet(privateKeyHex).signMessage(message);
}

const socket = io(`http://127.0.0.1:${PORT}`, { reconnection: false, timeout: 25000 });
let roomId = null;
let moves = 0;
const started = Date.now();
socket.on('connect', async () => {
  try {
    const msg = process.env.AUTH_MSG_PREFIX + WALLET;
    const sig = await signMessage(WALLET_PK, msg);
    console.log('identify sig=' + sig.slice(0, 20) + '... msg=' + msg);
    socket.emit('identify', { address: WALLET, name: 'OnchainTest', signature: sig });
    socket.on('player:update', () => {
      if (!roomId) socket.emit('match:bot', { gameType: 'tic-tac-toe' });
    });
  } catch (e) {
    console.log('identify ERROR: ' + e.message + '\n' + (e.stack || ''));
  }
});

socket.on('match:start', (d) => {
  roomId = d.roomId;
  console.log(`match start: ${roomId} game=${d.gameType} deck=${d.deck}`);
  actOn(d.game);
});

socket.on('game:state', ({ game }) => actOn(game));

function actOn(game) {
  if (!game || game.winner) return;
  const myTurn = game.players[game.turn] === WALLET;
  if (!myTurn || game.locked) return;
  // Tic-tac-toe replay loop: take the first open cell (random play finishes fast).
  const idx = (game.board ?? []).findIndex(c => !c);
  if (idx === -1) return;
  moves++;
  setTimeout(() => socket.emit('game:move', { roomId, index: idx }), 80);
}

socket.on('match:end', (d) => {
  const elapsed = Date.now() - started;
  console.log(`match end: result=${d.result} winner=${d.winner} moves=${moves} elapsed=${elapsed}ms`);
  if (!d.receipt || !d.receipt.matchId) {
    console.log('FAIL: no receipt returned');
    process.exit(1);
  }
  console.log('receipt matchId=' + d.receipt.matchId);
  console.log('receipt txHash=' + (d.receipt.txHash ? d.receipt.txHash.slice(0, 24) + '...' : 'none'));
  console.log('receipt resultHash=' + (d.receipt.resultHash ? d.receipt.resultHash.slice(0, 24) + '...' : 'none'));
  if (d.receipt.rewards && d.receipt.rewards[WALLET]) {
    const r = d.receipt.rewards[WALLET];
    console.log('rewards tokens=' + r.tokens + ' tokenTx=' + (r.tokenTx ? r.tokenTx.slice(0, 16) + '...' : 'none'));
    for (const b of r.badges || []) {
      console.log('rewards badge #' + b.id + ' "' + b.label + '" tx=' + (b.tx ? 'yes' : 'none') + (b.error ? ' ERROR=' + b.error : ''));
    }
  }
  socket.disconnect();
  fs.writeFileSync('/tmp/match-id.txt', String(d.receipt.matchId));
  process.exit(0);
});

socket.on('game:error', (e) => console.log('game:error', JSON.stringify(e)));
socket.on('player:error', (e) => console.log('player:error', JSON.stringify(e)));

setTimeout(() => {
  console.log('TIMEOUT: match did not finish');
  socket.disconnect();
  process.exit(1);
}, 70000);
NODEJS

MATCH_ID=$(cat /tmp/match-id.txt)
log "e2e: match finished, matchId=${MATCH_ID}"

# ---- 6. Read the on-chain ledger and assert ----
log "verify: querying on-chain match endpoint"
VERIFY=$(curl -s "${SERVER_URL}/api/verify/${MATCH_ID}")
echo "verification: ${VERIFY}"
VERIFIED_TX=$(echo "${VERIFY}" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const r=JSON.parse(d); if (!r.valid) process.exit(1); console.log(r.entry.txHash); })")
if [ -z "${VERIFIED_TX}" ]; then
  echo "[verify] FAIL: match not found by original room id"; exit 1
fi
LEDGER=$(curl -s "${SERVER_URL}/api/matches")
echo "ledger: ${LEDGER}"
COUNT=$(echo "${LEDGER}" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).length))")
log "verify: on-chain matches count = ${COUNT}"

if [ "${COUNT}" -lt 1 ]; then
  echo "[verify] FAIL: no matches on-chain"
  exit 1
fi

FOUND=$(echo "${LEDGER}" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const ledger=JSON.parse(d); const e=ledger.find(x=>x.matchId==='${MATCH_ID}'); console.log(e ? JSON.stringify(e) : 'null'); })")
echo "on-chain entry: ${FOUND}"

if echo "${FOUND}" | grep -q '"matchId":"'${MATCH_ID}
then
  log "verify: match found on-chain"
else
  echo "[verify] FAIL: matchId ${MATCH_ID} not found on-chain"
  exit 1
fi

LEDGER_TX=$(echo "${FOUND}" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d).txHash))")
if [ "${VERIFIED_TX}" != "${LEDGER_TX}" ]; then
  echo "[verify] FAIL: transaction hash differs between verify endpoint and ledger"; exit 1
fi

# ---- 7. Replay endpoint must return the recorded move list ----
REPLAY=$(curl -s "${SERVER_URL}/api/replay/${MATCH_ID}")
echo "replay: ${REPLAY}"
MOVE_COUNT=$(echo "${REPLAY}" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const r=JSON.parse(d); if (!r.moves) process.exit(1); console.log(r.moves.length); })")
if [ "$MOVE_COUNT" -lt 1 ]; then
  echo "[replay] FAIL: no moves recorded for replay"; exit 1
fi
log "replay: ${MOVE_COUNT} stored moves for match"

# ---- 8. Weekly leaderboard must contain the e2e player ----
WEEKLY=$(curl -s "${SERVER_URL}/api/leaderboard/weekly")
echo "weekly: ${WEEKLY}"
if echo "${WEEKLY}" | grep -q "${WALLET}"; then
  log "weekly: player present in this week's leaderboard"
else
  echo "[weekly] FAIL: player missing from weekly leaderboard"; exit 1
fi

# ---- 9. On-chain ARENA rewards were minted to the player ----
BAL=$(curl -s "${SERVER_URL}/api/wallet/${WALLET}/tokens")
echo "wallet tokens: ${BAL}"
ONCHAIN_BAL=$(echo "${BAL}" | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const r=JSON.parse(d); if (!r.onchain) process.exit(1); console.log(r.balance); })")
if [ -z "${ONCHAIN_BAL}" ]; then
  echo "[tokens] FAIL: wallet token balance check failed"; exit 1
fi
grep -q "On-chain rewards ENABLED" /tmp/battle-arena-server.log || (echo "[tokens] FAIL: server did not enable on-chain rewards"; exit 1)
log "tokens: on-chain ARENA balance = ${ONCHAIN_BAL}"

log "RESULT: ON-CHAIN E2E PASSED"
echo "=========================="
echo "matchId: ${MATCH_ID}"
echo "on-chain entry: ${FOUND}"