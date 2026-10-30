# ⚔️ Web3 Battle Arena

**Web3 Battle Arena** is a real-time multiplayer board and action gaming platform built specifically for kids and families, combining fast-paced tabletop duels with a healthy, family-first Web3 economy. Players compete via server-authoritative game engines, earn non-purchasable Energy by doing real-world chores verified by parents, unlock real-life family Battle Pass vouchers, and anchor tamper-evident match receipts and rewards on-chain (or into a verifiable local ledger).

---

## 💡 The Problem & The Innovation

### The Problem

Traditional kids' mobile and web games are riddled with dark patterns:

- **Predatory Microtransactions:** Games monetize kids by selling virtual currency, gems, and loot boxes with real money.
- **Screen-Time Friction:** Parents struggle to balance screen time with real-world chores and schoolwork, leading to daily conflicts.
- **Black-Box Matchmaking & Opaque Outcomes:** Matches and ranking calculations happen in closed databases with no transparency or provable history.
- **Unsafe Social Spaces:** Unmoderated chat systems expose young children to bullying and inappropriate language.

### The Innovation

1. **The Earned-Energy "Proof-of-Chore" Loop:** Arena Energy **cannot be bought with real money**. Kids earn energy to play matches by completing real-world chores (e.g., homework, cleaning room, reading) approved by parents acting as real-world Oracles, or by completing educational Brain Quizzes with cooldowns.
2. **Verifiable Match Results:** Every match computes a deterministic cryptographic SHA-256 `resultHash` covering the room, game type, players, winner, move count, and timestamp. Results are committed to the blockchain (`MatchResult.sol`) or recorded in a verifiable ledger, creating an immutable, replayable history.
3. **Educational & Pure Game Engines:** Games are educational and tactical (Mental Math, Memory Match, Connect Four, Cyber Blaster) running on pure, authoritative logic completely isolated from rendering and transport.
4. **Kid-Safe Architecture:** Positive preset chat shortcuts, server-side profanity filtering, masked memory card states (no client-side snooping), and bcrypt-hashed Parent PIN portals with brute-force lockout defense.

---

## 🚦 Feature Checklist & Status

| Feature                             | Status                   | Description                                                                                      |
| :---------------------------------- | :----------------------- | :----------------------------------------------------------------------------------------------- |
| **Connect Four**                    | 🟢 **Working**           | Pure server engine, 7x6 gravity grid, 4-in-a-row raycasting, bot AI blocking.                    |
| **Memory Match**                    | 🟢 **Working**           | Server-side card content masking, 4 educational decks, realistic human memory bot.               |
| **Neon Math Arena**                 | 🟢 **Working**           | Simultaneous mental math rounds, 12s authoritative timer, 3-life elimination, AI bot.            |
| **Cyber Blaster**                   | 🟢 **Working**           | 2D top-down action shooter, 40ms physics loop (25 TPS), Circle-AABB collisions, powerups.        |
| **Matchmaking & Private Rooms**     | 🟢 **Working**           | Random pairing queue, 5-char invite codes (`room:join`), live spectator mode.                    |
| **Kid-Safe Chat**                   | 🟢 **Working**           | Preset quick-chats, regex profanity filter (`[friendly]`), 800ms rate limiting.                  |
| **Energy & Proof-of-Chore**         | 🟢 **Working**           | 1 energy/match, chores seeded and custom created, parent verification rewards Energy/Allowance.  |
| **Parent PIN Protection**           | 🟢 **Working**           | Hashed PINs, SQLite lockout tracking (5 consecutive fails trigger 15-min lockout).               |
| **Battle Pass & Vouchers**          | 🟢 **Working**           | 10 reward tiers with real-world family reward vouchers (Pizza Night, Extra Screen Time).         |
| **Result Hashing & Replays**        | 🟢 **Working**           | Deterministic SHA-256 match hash, SQLite move-by-move replay archive (`/api/replay/:id`).        |
| **On-Chain Match Receipts**         | 🟢 **Working / Dual**    | Writes to `MatchResult.sol` when EVM configured; falls back transparently to simulated ledger.   |
| **ERC-20 Tokens & ERC-1155 Badges** | 🟢 **Working / Dual**    | Mints `ARENA` tokens & badges via `chain-tokens.js` on-chain, or records locally when simulated. |
| **ERC-4337 Gas Sponsorship**        | 🟡 **Simulated / Ready** | `ArenaPaymaster.sol` contract implemented and tested; local demo uses relayer minter key.        |
| **Dual-Vault Identity**             | 🟢 **Working**           | Auto-healing dual storage (`IndexedDB` + `localStorage`), BIP-39 mnemonic, optional MetaMask.    |

---

## 🏛️ System Architecture

```
                        +---------------------------------------+
                        |      Client (Browser / React 18)      |
                        |   Three.js 3D Viewport / Vite Bundle   |
                        |     Dual-Vault Burner / MetaMask      |
                        +-------------------+-------------------+
                                            |
                         WebSocket (Socket.IO) / HTTP REST
                                            |
                                            v
+-----------------------------------------------------------------------------------+
|                        Server Boundary (Node.js & Express)                        |
|   Rate Limiting, CORS Guards, Security Headers, EIP-191 Signature Verification    |
+-------------------------------------------+---------------------------------------+
                                            |
         +----------------------------------+----------------------------------+
         |                                  |                                  |
         v                                  v                                  v
+--------------------+            +--------------------+            +--------------------+
|  Socket Handlers   |            | Pure Game Engines  |            | Persistence Layer  |
|  - auth.js         |            |  - connectfour.js  |            |  - better-sqlite3  |
|  - matchmaking.js  | <--------> |  - memory.js       | <--------> |  - data.sqlite     |
|  - gameplay.js     |            |  - math-arena.js   |            |    (WAL Mode,      |
|  - chat.js         |            |  - cyber-blaster.js|            |     Replays, Stats)|
|  - progression.js  |            +--------------------+            +--------------------+
+--------------------+                      |
         |                                  v
         |                        +--------------------+
         +----------------------> |   ResultRecorder   |
                                  |  (Interface Layer) |
                                  +---------+----------+
                                            |
                   +------------------------+------------------------+
                   | (configured)                                    | (unconfigured)
                   v                                                 v
      +-------------------------+                       +-------------------------+
      |  On-Chain EVM Adapter   |                       |    Simulated Adapter    |
      |   (chain-onchain.js)    |                       |       (chain.js)        |
      |   - MatchResult.sol     |                       |   - Local ledger.json   |
      |   - ArenaToken.sol      |                       |   - Simulated txHash    |
      |   - ArenaBadges.sol     |                       |   - Instant settlement  |
      +-------------------------+                       +-------------------------+
```

### Folder Map

- `contracts/`: Solidity smart contracts (`MatchResult.sol`, `ArenaToken.sol`, `ArenaBadges.sol`, `ProofOfChore.sol`, `ArenaPaymaster.sol`).
- `server/`: Authoritative game server, APIs, security middleware, and database adapters.
  - `server/games/`: Pure game engines with zero network or database dependencies.
  - `server/sockets/`: Modular socket event handlers (`auth`, `matchmaking`, `gameplay`, `chat`, `progression`).
  - `server/result-recorder.js`: Unified abstraction bridging real on-chain contracts and simulated local recording.
  - `server/store.js`: SQLite schema, prepared statements, and transactional player operations.
  - `server/test/`: 14 automated test suites covering engines, security, persistence, and end-to-end flows.
- `client/`: React 18 single-page application built with Vite.
  - `client/src/pages/`: Game and hub pages (`Hub`, `BattlePass`, `Arena`, `MemoryMatch`, `ConnectFour`, `CyberBlaster`).
  - `client/src/components/`: Modular presentation components and modals.
  - `client/src/lib/`: Dual-vault cryptographic session manager and router.
- `shared/`: Shared protocol constants, socket event schemas, and game configurations.

---

## 🧰 Tech Stack & Design Choices

| Technology            | Purpose                       | Why This Choice Was Made                                                                                  |
| :-------------------- | :---------------------------- | :-------------------------------------------------------------------------------------------------------- |
| **Node.js + Express** | Backend Server & API Boundary | Lightweight, event-driven HTTP boundary with minimal overhead and vast ecosystem.                         |
| **Socket.IO**         | Real-Time Transport           | Native WebSocket transport with reliable fallback, channel rooms, and clean disconnect detection.         |
| **better-sqlite3**    | Embedded Persistence          | Synchronous, zero-latency SQLite with WAL mode. Zero external daemon setup required for hackathon judges. |
| **React 18 + Vite**   | Frontend Interface            | Instant hot module replacement (HMR), sub-4s production build, clean modular component model.             |
| **Three.js**          | 3D Arena Visualizations       | Lightweight WebGL graphics for Neon Math Arena floor and effects without heavy game engine bloat.         |
| **Ethers.js v6**      | Cryptography & Contracts      | Industry-standard wallet key derivation, EIP-191 personal message signing, and contract ABI encoding.     |
| **Hardhat**           | Local EVM Blockchain          | Deterministic local blockchain node with instant mining for automated smart contract testing.             |

---

## 🔗 "What is Real and What is Simulated?"

Transparency is paramount for hackathon judges:

1. **What is 100% Real:**
   - **All 4 Game Engines:** Real, deterministic, authoritative server physics, card masking, board state tracking, and AI bots.
   - **Authentication & Security:** Real EIP-191 cryptographic wallet signature verification with freshness checks, single-use anti-replay caching, and bcrypt PIN hashing.
   - **SQLite Persistence:** Real embedded database in WAL mode storing players, profiles, weekly leaderboards, active match snapshots, and full move-by-move replays.
   - **Smart Contracts (`contracts/`):** Real, compiled Solidity contracts deployed and executable against any EVM network (Hardhat, Base Sepolia, Ethereum).
   - **The Match Result Hash:** Real SHA-256 cryptographic digest of canonical match outcomes.
   - **End-to-End On-Chain Flow:** When Hardhat runs, transactions actually execute against `MatchResult.sol`, `ArenaToken.sol`, and `ArenaBadges.sol`.

2. **What is Simulated (When Blockchain is Not Configured):**
   - **Simulated Ledger Fallback (`chain.js`):** If no contract address or RPC is provided in `.env`, the server falls back to an internal simulated ledger (`ledger.json`) so the entire game remains 100% playable without requiring a local blockchain node.
   - **Simulated Transaction Hashes:** In simulated mode, `txHash` is generated as random 32-byte hex strings.
   - **Gas Paymaster (`ArenaPaymaster.sol`):** The ERC-4337 paymaster smart contract is fully written and tested. However, during local gameplay, the server acts as a trusted relayer minter using its own private key rather than requiring an external ERC-4337 UserOperation bundler (such as Biconomy or Stackup).

---

## 🔏 Result Hashing & Verification

Every completed match produces an authoritative receipt containing a deterministic `resultHash`.

### 1. Hash Construction

The result hash is computed by taking the SHA-256 digest of the canonical JSON payload:

$$\text{resultHash} = \text{0x} + \text{SHA256}(\text{JSON.stringify}(\{ \text{matchId}, \text{gameType}, \text{players}, \text{winner}, \text{moves}, \text{timestamp} \}))$$

```javascript
const payload = { matchId, gameType, players, winner, moves, timestamp };
const resultHash = '0x' + crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
```

### 2. On-Chain Anchoring

In `MatchResult.sol`, the match is committed with its `bytes32` identifier:

```solidity
function recordMatch(
    bytes32 matchId,
    string calldata gameType,
    address playerA,
    address playerB,
    address winner,
    uint32 moves
) external onlyOwner
```

### 3. Verification & Anti-Tamper Check

Anyone can verify match integrity via the REST endpoint `/api/verify/:matchId`:

- Checks if the match exists in the on-chain or ledger record.
- Any modification to winner, moves count, player addresses, or timestamp results in a completely mismatched hash, alerting clients of tampering immediately.

---

## 🚀 Step-by-Step Setup & Run Instructions

Runs on **Linux**, **macOS**, and **Windows**.

### Prerequisites

- **Node.js 18+ or 20+** installed (`node -v`)
- **Git**

### 1. Clone & Install

```bash
git clone https://github.com/abel149/Battle-Arena-.git
cd Battle-Arena-
npm install
```

### 2. Start Blockchain & Game Server (Terminal 1)

```bash
npm start
```

_Automatically boots a local Hardhat node (port 8545), compiles and deploys smart contracts, and launches the game server on port 3001._

### 3. Start Web Client (Terminal 2)

```bash
npm run client
```

_Launches the Vite dev server at **http://localhost:5173**._

---

## ⚙️ Environment Variables Explained

Copy `.env.example` to `.env` or `server/.env` to configure custom networks:

| Variable                | Default Value           | Description                                                                        |
| :---------------------- | :---------------------- | :--------------------------------------------------------------------------------- |
| `PORT`                  | `3001`                  | Express & Socket.IO backend port.                                                  |
| `ARENA_DB_PATH`         | `./data.sqlite`         | Path to SQLite database file.                                                      |
| `NODE_HTTP_URL`         | `http://127.0.0.1:8545` | EVM RPC node URL (Hardhat local, Base Sepolia, etc.).                              |
| `PRIVATE_KEY`           | `0xac0974b...`          | Deployer & minter private key (Hardhat test key #0).                               |
| `MATCH_RESULT_ADDRESS`  | _(empty)_               | Deployed `MatchResult.sol` contract address. Unset falls back to simulated ledger. |
| `MATCH_RESULT_CHAIN_ID` | `31337`                 | EVM chain ID for match receipts.                                                   |
| `ARENA_TOKEN_ADDRESS`   | _(empty)_               | Deployed ERC-20 `ArenaToken.sol` contract address.                                 |
| `ARENA_BADGES_ADDRESS`  | _(empty)_               | Deployed ERC-1155 `ArenaBadges.sol` contract address.                              |
| `ARENA_CHAIN_ID`        | `31337`                 | EVM chain ID for tokens and badges.                                                |
| `CHORE_ORACLE_ADDRESS`  | _(empty)_               | Deployed `ProofOfChore.sol` contract address.                                      |

---

## 🧪 Testing, Linting & Build

```bash
# 1. Run all 63 automated tests (unit, security, persistence, flow):
npm test

# 2. Run ESLint code quality audit:
npm run lint

# 3. Check Prettier formatting consistency:
npm run format:check

# 4. Run full On-Chain End-to-End Test (Hardhat node + deploy + bot duel + receipts):
bash server/scripts/e2e-onchain.sh

# 5. Production frontend bundle build:
npm run build
```

---

## ⚠️ Known Limitations & Next Steps

### Known Limitations

- **Turn Timers in Tabletop Games:** Connect Four and Memory Match rely on player turn completion without turn countdown timers (unlike Math Arena which has a strict 12s round timer). If a player abandons mid-game, their opponent currently wins by leaving the room.
- **Local Hardhat Nonce Reset:** Restarting a local Hardhat node resets EVM state and nonces to 0. If testing with MetaMask, users must clear activity/nonces in MetaMask settings.
- **Single-Server In-Memory Rooms:** Active room objects live in memory backed by SQLite persistence. In a distributed multi-instance deployment, a Redis adapter for Socket.IO would be needed.

### Next Steps

1. **Public Testnet Deployment:** Deploy contracts to Base Sepolia or Arbitrum Sepolia with an active public RPC.
2. **ERC-4337 Live Bundler Integration:** Integrate Biconomy or Pimlico bundler SDK on the frontend for production gasless account abstraction.
3. **Turn Timeout Clocks:** Add 30-second chess clocks to Connect Four and Memory Match.
4. **Mobile Native Shell:** Wrap the responsive React client in Capacitor for iOS and Android app store distribution.

---

## 📄 License

MIT License. Created for the Swafri Hackathon 2026.
