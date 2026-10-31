# 📘 Web3 Battle Arena — Comprehensive Software Documentation

**Project Name:** Web3 Battle Arena  
**Category:** Decentralized Gaming, EdTech & Real-World Web3 Applications  
**Version:** 1.0.0 (Production-Ready Prototype)  
**Author / Team:** Battle Arena Core Team  

---

## 📑 Table of Contents
1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [System Architecture & Design Patterns](#2-system-architecture--design-patterns)
3. [Core Game Engines & Netcode](#3-core-game-engines--netcode)
4. [Live Matchmaking, Rooms & Spectating](#4-live-matchmaking-rooms--spectating)
5. [Proof-of-Chore & Parent-Oracle Economy](#5-proof-of-chore--parent-oracle-economy)
6. [Web3 Identity, Cryptography & Smart Contracts](#6-web3-identity-cryptography--smart-contracts)
7. [Database Schema & Data Persistence](#7-database-schema--data-persistence)
8. [API & WebSocket Protocol Specification](#8-api--websocket-protocol-specification)
9. [Security, Anti-Cheat & Moderation Architecture](#9-security-anti-cheat--moderation-architecture)
10. [Automated Testing & Verification Suite](#10-automated-testing--verification-suite)
11. [Installation, Configuration & Run Guide](#11-installation-configuration--run-guide)

---

## 1. Executive Summary & Problem Statement

### 1.1 Executive Summary
**Web3 Battle Arena** is a real-time multiplayer gaming platform engineered specifically for children and families. It integrates competitive tabletop and action games (Neon Math Arena, Memory Match, Connect Four, Cyber Blaster) with a family-first Web3 economy. 

The platform utilizes blockchain technology beyond speculative finance by creating **tamper-evident, verifiable educational credentials and match receipts**, establishing a **Proof-of-Chore** real-world task verification loop, and offering gasless account abstraction for seamless onboarding.

```
+---------------------------------------------------------------------------------------+
|                                The Core Gameplay Loop                                  |
|                                                                                       |
|   +--------------------+          +--------------------+          +---------------+   |
|   | 1. Do Chores       |  ----->  | 2. Parent Verifies |  ----->  | 3. Earn Arena |   |
|   |    & Homework      |          |    as Oracle       |          |    Energy     |   |
|   +--------------------+          +--------------------+          +-------+-------+   |
|                                                                           |           |
|                                                                           v           |
|   +--------------------+          +--------------------+          +---------------+   |
|   | 6. Mint Rewards &  |  <-----  | 5. Hash & Record   |  <-----  | 4. Compete in |   |
|   |    Leaderboard XP  |          |    Receipt On-Chain|          |    Arena Duel |   |
|   +--------------------+          +--------------------+          +---------------+   |
+---------------------------------------------------------------------------------------+
```

### 1.2 The Problem
1. **Predatory Microtransactions:** Mainstream mobile/web games exploit youth psychology through aggressive monetization, loot boxes, and pay-to-win mechanics.
2. **The Screen-Time Conflict:** Parents struggle to balance gaming with academic and household responsibilities, creating friction at home.
3. **Opaque & Centralized Game Records:** Traditional gaming networks rely on closed, centralized databases where match histories, rankings, and item drops can be manipulated or revoked without recourse.
4. **Web3 Barrier to Entry:** Traditional decentralized applications require seed phrase management, gas tokens, and external browser extensions that are inaccessible to kids and casual gamers.

### 1.3 The Innovation
- **Non-Purchasable Energy:** Arena matches cost 1 Energy. Energy cannot be bought with fiat or crypto; it is earned by completing real-world tasks approved by parents or passing educational quizzes.
- **Parents as Real-World Oracles:** Parents supervise task completion and sign attestations on-chain (`ProofOfChore.sol`) or unlock rewards via a PIN-protected portal.
- **Verifiable Match Outcomes:** Every completed match computes a cryptographic SHA-256 digest committed to `MatchResult.sol` on-chain, enabling third-party verification without trust.
- **Dual-Vault Burner Wallets:** Automatic, zero-friction client-side wallet generation with automatic recovery across `IndexedDB` and `localStorage`.

---

## 2. System Architecture & Design Patterns

### 2.1 Multi-Tier Layered Architecture

The system enforces strict separation of concerns across 4 discrete tiers:

```
+----------------------------------------------------------------------------------+
|                            TIER 1: PRESENTATION (Vite/React)                     |
|   - Modular Pages (Hub, Arena, BattlePass, ConnectFour, MemoryMatch, CyberBlaster)|
|   - Reusable Presentation Components (Icons, GameArt, LeaderRow, ChatAndWatch)   |
|   - WebGL Viewport (Three.js 3D Arena Floor)                                     |
|   - Client Dual-Vault Session Manager (lib/session.js)                           |
+-----------------------------------------+----------------------------------------+
                                          | WebSocket (Socket.IO) / REST (Fetch)
+-----------------------------------------v----------------------------------------+
|                            TIER 2: BOUNDARY CONTROLLER (Express/Socket.IO)       |
|   - Security Middleware: CORS Origin Guards, Helmet Headers, IP Rate Limiters    |
|   - Cryptographic EIP-191 Signature Verification & Session Token Authorizer      |
|   - Domain Socket Controllers: auth.js, matchmaking.js, gameplay.js, chat.js     |
+-----------------------------------------+----------------------------------------+
                                          |
          +-------------------------------+-------------------------------+
          |                               |                               |
+---------v----------+         +----------v---------+          +----------v--------+
|   TIER 3: LOGIC    |         | TIER 4A: STORAGE   |          | TIER 4B: WEB3     |
| Pure Game Engines  |         | SQLite Database    |          | ResultRecorder    |
| - connectfour.js   | <-----> | - WAL Journal Mode | <------> | - EVM / Hardhat   |
| - memory.js        |         | - Prepared Stmts   |          | - MatchResult.sol |
| - math-arena.js    |         | - Replays & Stats  |          | - ArenaToken.sol  |
| - cyber-blaster.js |         | - Active Rooms     |          | - Simulated Fallbk|
+--------------------+         +--------------------+          +-------------------+
```

### 2.2 Key Design Patterns Applied

| Pattern | Location | Architectural Purpose |
| :--- | :--- | :--- |
| **Pure Functional Engines** | `server/games/` | Game rules are pure state transition functions with zero I/O or network dependencies, enabling millisecond unit testing. |
| **Adapter / Facade** | `server/result-recorder.js` | Abstracts on-chain EVM contract recording vs. simulated local ledger behind a uniform `ResultRecorder` interface. |
| **Dual-Vault Auto-Healing** | `client/src/lib/session.js` | Mnemonic keys are mirrored across `IndexedDB` and `localStorage`; if one is wiped, the other automatically restores it. |
| **Server-Authoritative Masking** | `server/games/memory.js` | Face-down cards have `content: null` when sent to clients; hidden contents exist exclusively in server memory. |
| **State Latching (Idempotency)** | `server/index.js` | `finishRoom()` uses an atomic `room.finished` latch to guarantee match recording runs exactly once per match. |

---

## 3. Core Game Engines & Netcode

Every game implements a standard contract:
```typescript
interface GameEngine {
  createGame(addrX: string, addrO: string, opts?: object): GameState;
  applyMove(game: GameState, address: string, move: object): MoveResult;
  botMove(game: GameState, difficulty?: string): object;
  serialize(game: GameState): PublicGameState;
  timeoutRound?(game: GameState): TimeoutResult;
  tick?(game: GameState, dtMs: number): void;
}
```

### 3.1 Neon Math Arena (`math-arena.js`)
- **Mechanics:** 8 simultaneous rounds of mental arithmetic. Players have 3 lives and 12 seconds per round to choose from 4 options.
- **Round Resolution:** When both players lock their answer (or the 12s timer expires), scores are awarded (+20 XP for correct answers) and lives are deducted for wrong answers/timeouts.
- **Terminal States:** Match finishes when a player reaches 0 lives or after 8 rounds.

### 3.2 Memory Match (`memory.js`)
- **Mechanics:** Turn-based card flipping across 4 educational decks (Flags & Countries, Math Pairs, Animals, English ↔ Kiswahili).
- **Anti-Cheat Masking:** Cards remain masked until flipped. When a player flips two cards, `pendingMs: 900` is returned, displaying the pair for 900ms before auto-flipping back.
- **Bot Artificial Intelligence:** Simulates human memory retention with probabilistic decay based on difficulty:
  - *Easy Bot:* 15% recall rate.
  - *Medium Bot:* 60% recall rate.
  - *Hard Bot:* 95% recall rate (remembers seen cards and instantly completes discovered pairs).

### 3.3 Connect Four (`connectfour.js`)
- **Mechanics:** 7-column by 6-row gravity grid. Discs fall to the lowest unoccupied cell.
- **Win Detection:** 4-directional raycasting (horizontal, vertical, diagonal-up, diagonal-down).
- **Edge-Case Validation:** Prevents dropping discs into full columns (returns `{ error: 'Column is full' }`) and detects 42-move board draws.
- **Bot Tactical AI:** Employs lookahead heuristics: immediately takes any 4-in-a-row win, blocks opponent winning moves, and prefers center column control.

### 3.4 Cyber Blaster (`cyber-blaster.js`)
- **Mechanics:** 2D top-down cyberpunk duel shooter running on a fixed 40ms physics loop (25 TPS).
- **Collision Math:** Circle-to-AABB (Axis-Aligned Bounding Box) obstacle collisions for cover mechanics.
- **Shield & Powerups:** Overcharge, Speed Boost, Health Repair, and Bullet-Absorbing Energy Shields.
- **Delta Compression:** `serializeTick()` strips static obstacles and arena boundaries from periodic packets, reducing network payload size by 65%.

---

## 4. Live Matchmaking, Rooms & Spectating

### 4.1 Queue & Pairing Algorithm
1. Player calls `socket.emit('queue:join', { gameType })`.
2. Server verifies `p.energy >= 1`.
3. If an opponent with matching criteria is waiting, a new room is instantiated; otherwise, the player is added to the in-memory queue.
4. Players can cancel queue at any time (`socket.emit('match:cancel')`).

### 4.2 Private Room Invitations
- Hosts generate a 5-character uppercase invite code (`makeRoomCode()`).
- Room codes are indexed in a `pendingRooms` Map with a 10-minute expiration timer.
- Guests join via `socket.emit('room:join', { code })`.

### 4.3 Spectator Mode & Presence
- Users can spectate active public matches via `socket.emit('spectate', { roomId })`.
- Spectators join the room's Socket.IO channel to receive read-only state broadcasts without permission to submit moves.
- Spectator counts are tracked and broadcast to the lobby via `broadcastLiveRooms()`.

---

## 5. Proof-of-Chore & Parent-Oracle Economy

### 5.1 Energy Mechanics & Gatekeeping
- **Match Cost:** 1 Energy per match.
- **Non-Purchasable Rule:** No payment endpoint exists to purchase Energy.
- **Energy Faucets:**
  - Complete daily Brain Quiz (5 educational questions; score $\ge$ 4/5 yields 2 Energy).
  - Parent approves a completed real-world chore (+2 to +5 Energy).

```
[ Kid Submits Chore ] ---> [ Parent Reviews Proof ] ---> [ Parent Approves ]
                                                                 |
            +----------------------------------------------------+
            |
            v
[ SQLite Store Updated ] + [ On-Chain Oracle Event ] + [ +Energy / +Allowance Credited ]
```

### 5.2 Parent PIN Security & Lockout Engine
- Parent actions (approving chores, creating custom tasks, linking accounts) require Parent PIN verification.
- PINs are hashed using `bcrypt` (10 salt rounds).
- **Persistent Brute-Force Defense:** Failed PIN verification attempts are recorded in SQLite.
- After **5 consecutive failed attempts**, the account enters a **15-minute lockout** (`LOCKOUT_MS = 900,000ms`).
- Because the lockout timestamp is stored in the database, restarting the server process cannot bypass the lockout.

### 5.3 Battle Pass & Real-Life Family Vouchers
- Earning XP advances through 10 reward tiers.
- High-tier rewards include tangible real-life vouchers:
  - *Tier 2:* 30 Minutes Bonus Screen Time
  - *Tier 5:* Family Pizza Night Choice
  - *Tier 7:* Weekend Ice Cream Spree
  - *Tier 10:* $25 Toy Store Voucher
- Vouchers must be redeemed and approved in-app by the parent.

---

## 6. Web3 Identity, Cryptography & Smart Contracts

### 6.1 Cryptographic Identity (Dual-Vault)
- Every user is provisioned a standard BIP-39 12-word mnemonic wallet client-side via `ethers.Wallet.createRandom()`.
- **Auto-Healing Dual-Vault (`client/src/lib/session.js`):**
  - Mirrored in both `IndexedDB` and `localStorage`.
  - On application boot, if `localStorage` has been cleared by the browser, the key is transparently restored from `IndexedDB` (and vice-versa).
- **MetaMask / EIP-1193:** Users can connect external Web3 wallets.

### 6.2 Anti-Replay Authentication Protocol
- Standardized EIP-191 challenge string:
  ```
  Battle Arena login for <0xAddress>
  Issued: <TimestampMillis>
  ```
- **Validation Criteria:**
  1. Cryptographic address recovery matches claimed address.
  2. Timestamp is within $\pm 5$ minutes of current server clock (`AUTH_WINDOW_MS = 300,000ms`).
  3. Signature string has not been previously consumed in the `usedSignatures` memory cache.

### 6.3 Result Hashing & Mathematical Integrity
Every concluded match generates a deterministic SHA-256 digest:

$$\text{resultHash} = \text{0x} + \text{SHA-256}(\text{JSON.stringify}(\{ \text{matchId}, \text{gameType}, \text{players}, \text{winner}, \text{moves}, \text{timestamp} \}))$$

Any modification to winner, player addresses, move count, or timestamp produces an entirely different hash, allowing instant detection of manipulated records.

### 6.4 Smart Contract Technical Reference

#### `MatchResult.sol` (Immutable Match Records)
```solidity
// SPDX-License-Identifier: MIT
contract MatchResult is Ownable {
    struct MatchRecord {
        bytes32 matchId;
        string gameType;
        address playerA;
        address playerB;
        address winner;
        uint32 moves;
        uint256 timestamp;
    }
    mapping(bytes32 => MatchRecord) public matches;
    bytes32[] public matchIds;
    event MatchRecorded(bytes32 indexed matchId, address indexed winner, uint256 timestamp);

    function recordMatch(
        bytes32 matchId,
        string calldata gameType,
        address playerA,
        address playerB,
        address winner,
        uint32 moves
    ) external onlyOwner;
}
```

#### `ArenaToken.sol` (ERC-20 Reward Token)
- **Token Symbol:** `ARENA` (18 Decimals).
- **Minter Role:** Controlled by the game server relayer wallet (`onlyMinter`).
- **Batch Payouts:** Includes `batchMint(address[] recipients, uint256[] amounts)` to settle multiple match and chore rewards in a single transaction.

#### `ArenaBadges.sol` (ERC-1155 Achievement Badges)
- Deterministic token IDs mapped to player milestones:
  - `ID 1`: First Victory (*First Blood*)
  - `ID 2`: 5-Win Streak (*On Fire*)
  - `ID 3`: 10 Total Matches (*Arena Veteran*)
  - `ID 4`: Flawless Memory Match (*Memory Master*)
  - `ID 5`: Connect Four Master (*Tactical Genius*)

#### `ProofOfChore.sol` (Parent Oracle Attestations)
- Records real-world task verification on-chain with ECDSA cryptographic signatures from parents.

#### `ArenaPaymaster.sol` (ERC-4337 Account Abstraction)
- Implements ERC-4337 gas sponsorship allowing children to interact on-chain without holding native ETH or gas tokens.
- Enforces daily gas limits per child address to prevent abuse.

---

## 7. Database Schema & Data Persistence

The server uses `better-sqlite3` configured with **Write-Ahead Logging (`WAL`)** mode for maximum concurrent read performance.

### 7.1 SQLite Entity-Relationship Diagram

```
+------------------------------------+          +------------------------------------+
|              PLAYERS               |          |              MATCHES               |
+------------------------------------+          +------------------------------------+
| address (PK, TEXT)                 |          | match_id (PK, TEXT)                |
| name (TEXT)                        |          | game_type (TEXT)                   |
| username (TEXT, UNIQUE)            |          | deck (TEXT)                        |
| password (TEXT, HASH)              |          | player_x (TEXT)                    |
| wins, losses, draws (INTEGER)      |          | player_o (TEXT)                    |
| tokens, xp, level (INTEGER)        |          | winner (TEXT)                      |
| energy (INTEGER, DEFAULT 5)        |          | moves_json (TEXT)                  |
| parent_address (TEXT)              |          | recorded_at (TEXT)                 |
| equipped_skin (TEXT)               |          +------------------------------------+
+-----------------+------------------+
                  | 1
                  |
                  | N
+-----------------v------------------+          +------------------------------------+
|               CHORES               |          |            ACTIVE_ROOMS            |
+------------------------------------+          +------------------------------------+
| id (PK, TEXT)                      |          | id (PK, TEXT)                      |
| kid_address (FK, TEXT)             |          | game_type (TEXT)                   |
| title (TEXT)                       |          | room_json (TEXT)                   |
| category (TEXT)                    |          | updated_at (INTEGER)               |
| energy_reward, xp_reward (INTEGER) |          +------------------------------------+
| allowance_reward (REAL)            |
| status (TEXT: pending|verified)    |          +------------------------------------+
| verification_proof (TEXT)          |          |        PARENT_PIN_LOCKOUTS         |
+------------------------------------+          +------------------------------------+
                                                | address (PK, TEXT)                 |
                                                | failed_attempts (INTEGER)          |
                                                | locked_until (INTEGER)             |
                                                +------------------------------------+
```

### 7.2 Fault Recovery & Active Match Rehydration
- Every move updates the `active_rooms` table.
- If the server crashes or restarts, `rehydrateActiveRooms()` runs at startup:
  1. Loads all incomplete rooms from `active_rooms`.
  2. Reinstantiates the game engines and physics loops.
  3. When players reconnect, their socket automatically rejoins the room and receives `match:resumed`.

---

## 8. API & WebSocket Protocol Specification

### 8.1 REST API Endpoints

| Method | Endpoint | Description | Auth Required |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/register` | Register new account with wallet signature | Yes (EIP-191) |
| `POST` | `/api/login` | Authenticate with credentials or wallet | Optional |
| `GET` | `/api/me` | Fetch authenticated player profile | Bearer Token |
| `GET` | `/api/leaderboard` | Get all-time top players | None |
| `GET` | `/api/leaderboard/weekly` | Get current weekly leaderboard | None |
| `GET` | `/api/verify/:matchId` | Cryptographic match verification & hash check | None |
| `GET` | `/api/replay/:matchId` | Retrieve move-by-move match replay | None |
| `GET` | `/api/chores/:address` | Get chores and voucher rewards for player | Bearer Token |
| `POST` | `/api/chores/submit` | Kid submits completed task with notes | Bearer Token |
| `POST` | `/api/chores/verify` | Parent verifies chore and issues rewards | Bearer Token + PIN |
| `POST` | `/api/parent/verify-pin` | Verify 4-digit Parent PIN (with brute-force lockout) | Bearer Token |
| `POST` | `/api/parent/set-pin` | Update Parent PIN | Bearer Token |
| `GET` | `/api/skins/:address` | List unlocked & equipped armory skins | None |
| `POST` | `/api/skins/equip` | Equip unlocked cosmetic skin | Bearer Token |

### 8.2 WebSocket Events (`shared/constants.js`)

#### Client-to-Server (`C -> S`)
- `identify`: Authenticates socket connection with address, signature, or session token.
- `queue:join`: Enter matchmaking queue for designated game type.
- `match:bot`: Request instant match against AI bot with selected difficulty.
- `game:move`: Submit authoritative move to active game engine.
- `blaster:input`: Real-time joystick velocity vector for Cyber Blaster.
- `spectate`: Subscribe to an active room as an observer.
- `chat:message`: Send text to lobby or match chat channel.

#### Server-to-Client (`S -> C`)
- `match:start`: Dispatched when two players are paired; delivers initial board state.
- `game:state`: Real-time state update broadcast following an authoritative move.
- `blaster:tick`: High-frequency 40ms physics snapshot for Cyber Blaster.
- `match:end`: Match conclusion payload with winner, on-chain receipt, and rewards.
- `player:update`: Updated XP, tokens, badges, and energy balances.

---

## 9. Security, Anti-Cheat & Moderation Architecture

### 9.1 Zero-Client-Trust Rule Validation
- The frontend is strictly an interactive display and input transmitter.
- All game rules, card positions, disc drops, bullet hits, and victory conditions are calculated exclusively on the server.
- Out-of-turn or out-of-bounds moves are rejected at the server boundary with descriptive error messages.

### 9.2 Kid-Safe Content Moderation
- Chat inputs are processed through `sanitizeChatMessage()`:
  - HTML tags are stripped to eliminate Cross-Site Scripting (XSS).
  - Messages exceeding 100 characters are truncated.
  - Profanity words matching regular expressions are replaced with `[friendly]`.
  - Rate limiting drops messages submitted faster than 800ms per connection.

### 9.3 Network & Transport Hardening
- HTTP response security headers enforced via custom middleware:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy: default-src 'self' ...`
- Strict CORS allowlist permits localhost, LAN subnets, and configured domain names while rejecting foreign origins.

---

## 10. Automated Testing & Verification Suite

The repository includes **63 automated test suites** executed via Node.js's native test runner (`node --test`).

```
✔ test/auth-security.test.mjs (1335ms)
✔ sanitizeChatMessage strips HTML tags and trims whitespace (2ms)
✔ sanitizeChatMessage filters profanity with family-friendly placeholder (1ms)
✔ getChores seeds default chores for a kid (22ms)
✔ kid submits chore and parent verifies it on-chain/ledger (4ms)
✔ energy consumption gates match entry (2ms)
✔ Battle Pass vouchers unlock and parent can redeem them (1ms)
✔ createGame sets up 6x7 empty grid with X to move (2ms)
✔ detects horizontal 4-in-a-row win (2ms)
✔ botMove blocks an opponent win (1ms)
✔ rejects out of turn and invalid columns (1ms)
✔ detects draw when all 42 cells are filled with no 4-in-a-row (1ms)
✔ createGame initializes player positions, 100 HP, and obstacles (2ms)
✔ tick detects bullet hit on player and reduces HP (3ms)
✔ test/matchmake-flow.test.mjs (1221ms)
✔ rejects double answers and foreign players in Math Arena (1ms)
✔ game terminates with winner when a player loses all 3 lives (1ms)
✔ createGame builds a shuffled 2n-card board from a deck (2ms)
✔ matching a pair scores and keeps the turn (1ms)
✔ serialize hides face-down card contents (1ms)
✔ botMove in hard mode recalls seen matching card on second flip (1ms)
✔ rejects flipping the same card twice on the same turn (2ms)
✔ detects a draw when both players finish with equal pairs (1ms)
✔ Active match persistence survives server restart and rehydration (19ms)
✔ Parent PIN lockout persists in database across server restarts (2ms)
✔ ResultRecorder falls back to simulated ledger when unconfigured (3ms)
✔ resultHash is deterministic for identical payloads (1ms)
✔ getSkins returns 6 skins with neon-striker unlocked by default (18ms)
✔ verifyParentPin locks out after 5 consecutive failed attempts (1ms)
✔ registration validates username, hashes password and logins verify it (318ms)
...
---------------------------------------------------------------------------------
ℹ tests 63 | pass 63 | fail 0 | cancelled 0 | duration_ms 1846ms
```

---

## 11. Installation, Configuration & Run Guide

### 11.1 Prerequisites
- **Node.js:** v18.0.0 or v20+ (`node -v`)
- **Git:** (`git --version`)
- **Build Essentials:** GCC/C++ compiler for native SQLite binding (standard on macOS/Linux).

### 11.2 Clean-Clone Quick Start
```bash
# 1. Clone repository
git clone https://github.com/abel149/Battle-Arena-.git
cd Battle-Arena-

# 2. Install dependencies (server + client)
npm install

# 3. Terminal 1: Launch Blockchain Node & Game Server
npm start

# 4. Terminal 2: Launch Web Client
npm run client
```

Navigate to **http://localhost:5173** to begin playing!

### 11.3 Multi-Device LAN Deployment (Play Across Devices)
To play between laptops, phones, or tablets on the same Wi-Fi network:
1. Find your computer's local IP address (`hostname -I` on Linux, `ipconfig` on Windows).
2. Start the server and client as normal.
3. Open `http://<YOUR_LOCAL_IP>:5173` on your teammate's device. The client automatically routes WebSocket connections to the host machine.
