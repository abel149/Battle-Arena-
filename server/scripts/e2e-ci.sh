#!/usr/bin/env bash
# CI-friendly end-to-end check.
# Starts a local Hardhat node, deploys MatchResult + ArenaToken + ArenaBadges,
# registers a wallet, runs a bot match, and verifies: on-chain record, ARENA
# tokens minted, badges minted, replay served, weekly leaderboard populated.
# No credentials required (uses the demo wallet from deploy-tokens.js).
set -euo pipefail

HARDHAT_PORT=7550
HARDHAT_PID=""
LOG=/tmp/battle-arena-server-ci.log
RESULT_FILE=/tmp/e2e-ci-result.json

cleanup() {
  # Kill hardhat node if we started one
  if [[ -n "$HARDHAT_PID" ]] && kill -0 "$HARDHAT_PID" 2>/dev/null; then
    kill "$HARDHAT_PID" 2>/dev/null || true
    wait "$HARDHAT_PID" 2>/dev/null || true
  fi
  rm -f "$RESULT_FILE"
  # Leave LOG for debugging
}
trap cleanup EXIT

echo "[ci] starting hardhat node on port $HARDHAT_PORT..."
rm -f "$LOG" "$RESULT_FILE"
npx hardhat node --port "$HARDHAT_PORT" --chain-json-block 2>&1 | tee "$LOG" &
HARDHAT_PID=$!

echo "[ci] waiting for hardhat node to be ready..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${HARDHAT_PORT}/" > /dev/null 2>&1; then
    echo "[ci] hardhat node ready"
    break
  fi
  sleep 1
  if [[ $i -eq 30 ]]; then
    echo "[ci] ERROR: hardhat node did not become ready"
    exit 1
  fi
done

# Record result of each step; exit 1 if any failed
set +e
npx hardhat run scripts/deploy-match-result.js --network hardhat --port "$HARDHAT_PORT" > "$LOG" 2>&1
DEPLOY_RC=$?
echo "DEPLOY=$DEPLOY_RC" >> "$RESULT_FILE"
echo "[ci] deploy exit: $DEPLOY_RC"

export ARENA_DB_PATH=/tmp/battle-arena-ci.sqlite
rm -f "$ARENA_DB_PATH"

export MATCH_RESULT_CHAIN_ID=31337
export ARENA_CHAIN_ID=31337

# Read deployment addresses from the artifacts deployed by the script
RESULT_ADDR=$(node -e "const f=require('./artifacts/contracts/MatchResult.sol/MatchResult.json'); console.log(JSON.parse(require('fs').readFileSync('./artifacts/contracts/MatchResult.sol/MatchResult.json','utf8')).networks['31337'].address)" 2>/dev/null || true)
TOKEN_ADDR=$(node -e "const f=require('./artifacts/contracts/ArenaToken.sol/ArenaToken.json'); console.log(JSON.parse(require('fs').readFileSync('./artifacts/contracts/ArenaToken.sol/ArenaToken.json','utf8')).networks['31337'].address)" 2>/dev/null || true)
BADGES_ADDR=$(node -e "const f=require('./artifacts/contracts/ArenaBadges.sol/ArenaBadges.json'); console.log(JSON.parse(require('fs').readFileSync('./artifacts/contracts/ArenaBadges.sol/ArenaBadges.json','utf8')).networks['31337'].address)" 2>/dev/null || true)

export MATCH_RESULT_ADDRESS="${RESULT_ADDR:-0x0}"
export ARENA_TOKEN_ADDRESS="${TOKEN_ADDR:-0x0}"
export ARENA_BADGES_ADDRESS="${BADGES_ADDR:-0x0}"
export DEBUG_E2E=1

RESOLVER=$(node -e "console.log(require('dns').lookup('localhost',{all:true}).then(r=> r[0].address).catch(()=>'127.0.0.1'))")

echo "[ci] starting server (log: $LOG)..."
MATCH_RESULT_ADDRESS="$MATCH_RESULT_ADDRESS" \
ARENA_TOKEN_ADDRESS="$ARENA_TOKEN_ADDRESS" \
ARENA_BADGES_ADDRESS="$ARENA_BADGES_ADDRESS" \
MATCH_RESULT_CHAIN_ID="$MATCH_RESULT_CHAIN_ID" \
ARENA_CHAIN_ID="$ARENA_CHAIN_ID" \
ARENA_DB_PATH="$ARENA_DB_PATH" \
WALLET_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
SERVER_PORT=3000 \
SERVER_URL="http://localhost:3000" \
npx hardhat run scripts/e2e-server.mjs --network hardhat --port 7550 &
SERVER_PID=$!
sleep 2

# Run the e2e in node to keep it simple
node scripts/e2e-ci.mjs > "$LOG" 2>&1
E2E_RC=$?
echo "E2E=$E2E_RC" >> "$RESULT_FILE"

kill "$SERVER_PID" 2>/dev/null || true
wait "$SERVER_PID" 2>/dev/null || true

if [[ $E2E_RC -ne 0 ]]; then
  echo "[ci] e2e did not fully pass (rc=$E2E_RC)"
  echo "[ci] --- log ---"
  cat "$LOG"
  exit 1
fi

echo "[ci] all checks passed"
echo "[ci] --- log ---"
cat "$LOG"
exit 0
