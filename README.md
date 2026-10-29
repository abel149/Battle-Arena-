# ⚔️ Web3 Battle Arena

Real-time multiplayer gaming platform with Web3 player identity, real on-chain
match recording + rewards, leaderboards, match replays and collectible
achievement badges.

## Games

- **⚡ Neon Math Arena** — 3D arena duel. Both players get the same question,
  move across the four answer tiles and lock in before the 10s clock runs
  out. Correct answer scores, a wrong one costs a life.
- **🧠 Memory Match** — educational decks (Flags & Countries, Math Pairs,
  Animals, English↔Kiswahili). Cards pair two *different* representations
  (e.g. 🇫🇷 ↔ France), so players learn while competing.
- **⭕ Tic Tac Toe** — classic real-time duel.

## Features

- **Real-time multiplayer** — Socket.IO matchmaking queue, authoritative
  server-side game state, spectator mode, live chat + kid-safe preset phrases
- **Web3 identity** — every player wallet signs an EIP-191 "ownership proof"
  (`Battle Arena login for 0x…`): MetaMask users sign with `personal_sign`,
  while demo wallets ship a real, randomly generated secp256k1 key stored in
  the browser. The server recovers the signer with `ethers.verifyMessage`.
- **On-chain results** — every finished match is written to `MatchResult.sol`
  (matchId, winner, players, move count, timestamp) and returns a receipt with
  the real `txHash`, verifiable via `/api/verify/:matchId`
- **ERC-20 ARENA token** — winners/draw/loss payouts (10 / 3 / 1 ARENA) are
  minted on-chain to both human players by `ArenaToken.sol` at match end
- **ERC-1155 badges** — achievements (First Blood, Flag Master, Memory King…)
  are minted as 1-of-1 `ArenaBadges.sol` tokens with deterministic ids
- **Match replay** — every finished match stores its full move list + final
  board layout; the lobby has a ▶ Replay player that steps through the match
  (auto-play, ⏪/⏩ scrubbing). Endpoint: `/api/replay/:matchId`
- **Weekly leaderboard** — points mirror ARENA earned per match, bucketed by
  ISO week; a new week starts a fresh board. `/api/leaderboard/weekly`
- **Rewards** — ARENA tokens, XP + levels, win streaks, learning badges
- **Daily Challenge deck** — one deck gets +15 bonus XP each day
- **Pluggable games** — add a game = one engine file in `server/games/` +
  one line in `server/games/index.js`

## Frontend pages

The new interface is a blue-neon hub; every game can be played against a real
matched player or a bot, and the leaderboard / on-chain panels read live
server data (no mock rows).

| Route | Page | File |
| ----- | ---- | ---- |
| `#hub` (default) | Battle Arena hub — game cards, leaderboard, on-chain results | `client/src/pages/Hub.jsx` |
| `#arena?mode=match\|bot` | Neon Math Arena match | `client/src/pages/Arena.jsx` |
| `#memory?mode=match\|bot&deck=flags` | Memory Match table | `client/src/pages/MemoryMatch.jsx` |
| `#classic` | Earlier lobby (register / login / chat / spectate) | `client/src/App.jsx` |

Quick Match puts you in the Socket.IO queue for that game and drops you into
the match as soon as a second player joins. Play vs Bot starts an immediate
match against `ArenaBot`. Both games produce the same verified result receipt.

Everything degrades gracefully: without chain env vars the server falls back
to a simulated ledger / simulated rewards, so dev works with no blockchain.

## Tech Stack

| Layer    | Tech                                                                 |
| -------- | -------------------------------------------------------------------- |
| Client   | React 18, Vite, ethers v6, socket.io-client, three.js, plain CSS     |
| Server   | Node.js, Express, Socket.IO, SQLite (better-sqlite3)                 |
| Storage  | SQLite (`server/data.sqlite`), simulated ledger fallback             |
| Chain    | Hardhat 3 + ethers v6 — `MatchResult.sol`, `ArenaToken.sol` (ERC-20), `ArenaBadges.sol` (ERC-1155) / simulated fallback |

## Prerequisites

- **Node.js 20+** — https://nodejs.org

## Setup (local dev, no blockchain needed)

Two terminal windows — the app is two separate packages:

```bash
# Terminal 1 — game server (port 3001)
cd server
npm install
npm start

# Terminal 2 — web client (port 5173)
cd client
npm install
npm run dev
```

Open **http://localhost:5173** in your browser. Demo wallets are generated
with real keys and sign automatically; click *MetaMask* to use your own wallet.

## Full on-chain mode (local Hardhat)

```bash
cd server
npm run node                          # Terminal 1: Hardhat node (8545)

# Terminal 2: deploy + run the server against the node
NODE_HTTP_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
npm run deploy:local                  # MatchResult.sol
NODE_HTTP_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac09...2ff80 \
npm run deploy:tokens:local           # ArenaToken.sol + ArenaBadges.sol

NODE_HTTP_URL=http://127.0.0.1:8545 \
PRIVATE_KEY=0xac09...2ff80 \
MATCH_RESULT_ADDRESS=<printed address> \
npm start
```

The token deployer is the contracts' `minter`; the server wallet (`PRIVATE_KEY`)
must be the same account (or call `setMinter`) so it can mint rewards.

### Base Sepolia (real testnet)

Set these env vars before `deploy:*:base-sepolia` and `npm start`:

```bash
NODE_HTTP_URL=<SEPOLIA_VIA_BASE_RPC_URL>      # e.g. https://sepolia.base.org or a provider URL
BASE_SEPOLIA_PRIVATE_KEY=<funded wallet key>  # needs Base Sepolia ETH for gas
```

Or use the equivalent `PRIVATE_KEY` / `MATCH_RESULT_ADDRESS` /
`ARENA_TOKEN_ADDRESS` + `ARENA_BADGES_ADDRESS` form.

## How to Play / Demo

- **Solo** — click *🤖 Play vs Bot*
- **Two players** — open http://localhost:5173 in **two browser windows**
  (or normal + incognito), both click *⚡ Quick Match*
- **Spectate** — a live match appears under *Live matches* in the other window's lobby
- After a match: the *Verified Result* card shows the on-chain receipt with the
  real `txHash`, minted ARENA + badge token transactions, and *⛓ Verify* opens
  the raw ledger entry
- **▶ Replay** — under *On-Chain Results* in the lobby, step through any past match

## Tests

```bash
cd server
npm test          # node:test: game engines, store/weekly/replay, reward fallbacks
npm run test:local   # full-stack E2E (Hardhat note: use scripts/e2e-onchain.sh)
bash scripts/e2e-onchain.sh   # deploys on a Hardhat node, plays a bot match,
                              # verifies receipt, replay, weekly board, token balance
```

## Project Structure

```
server/
  index.js                  Socket.IO server — matchmaking, rooms, chat, results, rewards
  store.js                  Player profiles, weekly points, match archive, SQLite
  chain-onchain.js          MatchResult.sol integration (simulated fallback)
  chain-tokens.js           ArenaToken/ArenaBadges reward distribution (simulated fallback)
  contracts/
    MatchResult.sol         On-chain match receipts
    ArenaToken.sol          ERC-20 ARENA reward token
    ArenaBadges.sol         ERC-1155 collectible badges
  scripts/
    deploy-match-result.js  Deploy the receipt contract, write match-result-address.json
    deploy-tokens.js         Deploy token + badges, write token-address.json
    test-onchain.mjs        Full-stack on-chain E2E
    e2e-onchain.sh          Shell E2E incl. replay/weekly/token assertions
    debug-match.mjs         Debug runthrough with verbose socket logs
  games/
    index.js                 Game registry (add games here)
    tictactoe.js             Tic Tac Toe engine
    memory.js                Memory Match engine
    math-arena.js            Neon Math Arena engine (questions, lives, scoring)
    decks.js                 Educational card decks + daily challenge
  test/                      node:test unit suite (engines, store, tokens)
  data.sqlite                Player DB (runtime-generated, gitignored)
client/
  src/App.jsx                Classic lobby (#classic): auth, chat, spectate, replay viewer
  src/pages/Hub.jsx          Battle Arena hub (default page)
  src/pages/Arena.jsx        Neon Math Arena live match screen
  src/pages/MemoryMatch.jsx  Memory Match live match screen
  src/components/ArenaPreview3D.jsx  three.js arena preview on the hub card
  src/lib/                   Hash router + wallet/socket identity hooks
  src/socket.js              Server connection + wallet signing (MetaMask / demo key)
  src/styles.css             Global styling (each page has its own CSS file)
  smoke-test.mjs             Plays a full match vs the bot over real sockets
  debug-sock.mjs             Logs every socket event (debugging)
```

## Notes

- `node_modules/` exists in **both** `server/` and `client/` — they are two
  independent npm packages; each needs its own `npm install`.
- The server imports `ethers` from its devDependencies, so install with plain
  `npm install` (not `--omit=dev`) or it will fail to boot.
- `data.sqlite` is runtime-generated. **Delete it to reset** all players,
  weekly points and match history for a fresh demo.
- Bot matches (`ArenaBot`) do not earn tokens/badges; only human wallets are
  minted to.
- To run the socket smoke test: `cd client && node smoke-test.mjs`
