# ⚔️ Web3 Battle Arena

Real-time multiplayer gaming platform with Web3-style player identity, on-chain
match verification (simulated), leaderboards, and collectible achievement badges.

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
- **Web3 identity** — auto-generated blockchain-style profile ID per player
  (`0x…`), optional MetaMask connect
- **On-chain results** *(simulated)* — every finished match produces `matchId`,
  winner, timestamp, `resultHash` (sha256 of the match payload) and `txHash`,
  verifiable via `/api/verify/:matchId`
- **Rewards** — ARENA tokens per result, XP + levels, win streaks, and
  learning badges (Flag Master, Math Whiz, Polyglot, Memory King…)
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

## Tech Stack

| Layer   | Tech                                              |
| ------- | ------------------------------------------------- |
| Client  | React 18, Vite, socket.io-client, three.js, plain CSS |
| Server  | Node.js, Express, Socket.IO                       |
| Chain   | Simulated ledger (`server/ledger.json`) — swappable for ethers + a real contract |
| Storage | JSON files (`server/data.json`, `server/ledger.json`) |

## Prerequisites

- **Node.js 18+** (includes npm) — https://nodejs.org

## Setup

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

Open **http://localhost:5173** in your browser.

## How to Play / Demo

- **Solo** — click *🤖 Play vs Bot*
- **Two players** — open http://localhost:5173 in **two browser windows**
  (or normal + incognito, so each gets its own wallet ID), both click
  *⚡ Quick Match*
- **Spectate** — a live match appears under *Live matches* in the other
  window's lobby
- After a match: the *Verified Result* card shows the on-chain receipt,
  *⛓ Verify* opens the raw ledger entry

## Project Structure

```
server/
  index.js            Socket.IO server — matchmaking, rooms, chat, results
  chain.js            Simulated on-chain ledger (swap for ethers later)
  store.js            Player profiles, XP/levels, badges, leaderboard
  games/
    index.js          Game registry (add games here)
    tictactoe.js      Tic Tac Toe engine
    memory.js         Memory Match engine
    math-arena.js     Neon Math Arena engine (questions, lives, scoring)
    decks.js          Educational card decks + daily challenge
  data.json           Player DB (runtime-generated, gitignored)
  ledger.json         On-chain match records (runtime-generated, gitignored)
client/
  src/App.jsx         Classic lobby (#classic): auth, chat, spectate
  src/pages/Hub.jsx   Battle Arena hub (default page)
  src/pages/Arena.jsx Neon Math Arena live match screen
  src/pages/MemoryMatch.jsx  Memory Match live match screen
  src/components/ArenaPreview3D.jsx  three.js arena preview on the hub card
  src/lib/            Hash router + wallet/socket identity hooks
  src/socket.js       Server connection
  src/styles.css      Global styling (each page has its own CSS file)
```

## Notes

- `node_modules/` exists in **both** `server/` and `client/` — they are two
  independent npm packages; each needs its own `npm install`.
- The server imports `ethers` from its devDependencies, so install with plain
  `npm install` (not `--omit=dev`) or it will fail to boot.
- Match stats, tokens and the leaderboard are real server data. Delete
  `server/data.json` and `server/ledger.json` to start from an empty board.
- `data.json` / `ledger.json` are runtime-generated. **Delete them to reset**
  all players and match history for a fresh demo.
- To run the socket smoke test: `cd client && node smoke-test.mjs`

## Roadmap (hackathon next steps)
- login and regestration
- Real on-chain recording: Hardhat + `MatchResult.sol` on a testnet
      (Polygon Amoy / Base Sepolia), swap `chain.js` for an ethers call
- Real wallet signatures for identity
- Tokenized badges (ERC-1155) / ERC-20 ARENA token
- Match replay from recorded move lists
- Weekly-reset leaderboard
