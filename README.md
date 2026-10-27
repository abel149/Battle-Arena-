# ⚔️ Web3 Battle Arena

Real-time multiplayer gaming platform with Web3-style player identity, on-chain
match verification (simulated), leaderboards, and collectible achievement badges.

## Games

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

## Tech Stack

| Layer   | Tech                                              |
| ------- | ------------------------------------------------- |
| Client  | React 18, Vite, socket.io-client, plain CSS       |
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
    decks.js          Educational card decks + daily challenge
  data.json           Player DB (runtime-generated, gitignored)
  ledger.json         On-chain match records (runtime-generated, gitignored)
client/
  src/App.jsx         Lobby, game boards, chat, receipt, leaderboard
  src/socket.js       Server connection
  src/styles.css      Styling
  smoke-test.mjs      Plays a full match vs the bot over real sockets
  debug-sock.mjs      Logs every socket event (debugging)
```

## Notes

- `node_modules/` exists in **both** `server/` and `client/` — they are two
  independent npm packages; each needs its own `npm install`.
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
