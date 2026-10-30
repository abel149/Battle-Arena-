# 📐 Battle Arena Architecture & Code Review Guide

This document explains the architecture, layers, data flow, and security mechanisms of **Web3 Battle Arena** for code reviewers, hackathon judges, and developers.

---

## 1. System Layers & Separation of Concerns

The codebase enforces strict separation across 4 distinct layers:

### A. Presentation Layer (`client/src/`)

- Pure React components split by domain (`pages/`, `components/`).
- Presentational components are isolated from raw socket calls. Subcomponents like `ChatAndWatchSection`, `LeaderRow`, `Icons`, `GameArt`, and `BrainQuizModal` handle scoped UI rendering.
- State is managed declaratively; session secrets and burner keys are encapsulated behind `client/src/lib/session.js`.

### B. Transport & Socket Boundary (`server/sockets/`)

- `server/index.js` acts as the server bootstrapper and HTTP boundary.
- Socket event listeners are modularized into domain files:
  - `server/sockets/auth.js`: Session tokens, EIP-191 signatures, brute-force throttling (`LOGIN_MAX_FAILS = 8`).
  - `server/sockets/matchmaking.js`: Random queue, private 5-character rooms, bot duels, spectator subscriptions.
  - `server/sockets/gameplay.js`: Authoritative player moves (`game:move`, `blaster:input`).
  - `server/sockets/chat.js`: Kid-safe chat sanitization, profanity filtering, rate limiting.
  - `server/sockets/progression.js`: Chore verification and skins locker.

### C. Authoritative Pure Game Engines (`server/games/`)

- Every game (`connectfour.js`, `memory.js`, `math-arena.js`, `cyber-blaster.js`) implements a pure functional pattern:
  - `createGame(addrX, addrO, opts)`: Creates initial game state.
  - `applyMove(game, address, move)`: Validates and applies move, returns `{ ok, error, pendingMs }`.
  - `botMove(game, difficulty)`: Computes automated AI opponent move.
  - `serialize(game)`: Sanitizes state for client broadcast (e.g. hides face-down memory cards).
- Game engines have **zero dependencies** on WebSockets, databases, or UI.

### D. Web3 & Persistence Abstraction (`server/`)

- `server/result-recorder.js`: Unified `ResultRecorder` class. Hides whether receipts are committed to `MatchResult.sol` on EVM or `ledger.json` locally.
- `server/store.js`: Embedded SQLite database (`better-sqlite3`) in Write-Ahead Logging (`WAL`) mode. Handles player profiles, matches, chore statuses, and parent PIN lockouts.

---

## 2. Match Lifecycle & Data Flow

```
1. Matchmaking
   Client emits 'queue:join' or 'match:bot'
   -> matchmaking.js checks energy balance
   -> creates room instance with unique roomId ('match_xxxx')
   -> emits 'match:start' with sanitized room state

2. Gameplay Loop
   Client emits 'game:move' { roomId, ...move }
   -> gameplay.js resolves authenticated address
   -> room.engine.applyMove(room.game, address, move)
   -> validates turn, boundaries, and rules
   -> emits 'game:state' to room participants
   -> if move triggers pendingMs (e.g. card reveal), schedules resolve()

3. Resolution & Recording
   Game engine sets game.winner ('X' | 'O' | 'draw')
   -> server calls finishRoom(room)
   -> room.finished flag prevents duplicate execution (Idempotent)
   -> defaultRecorder.recordMatch() generates SHA-256 resultHash
   -> if EVM configured: submits tx to MatchResult.sol
   -> if unconfigured: appends entry to ledger.json
   -> distributeRewards() awards ARENA tokens & achievement badges
   -> store.saveMatch() saves move-by-move replay to SQLite
   -> emits 'match:end' with receipt and rewards breakdown to clients
```

---

## 3. Cryptographic Primitives & Security

### Anti-Replay Authentication (EIP-191)

- Challenge format: `Battle Arena login for <address>\nIssued: <timestamp>`
- Freshness window: ±5 minutes (`AUTH_WINDOW_MS = 300,000ms`).
- Consumed signatures are cached in memory for double the validity window (`usedSignatures`), preventing signature reuse.
- Alternative single-use random nonces available via `/api/auth/nonce`.

### Result Hashing

```javascript
const payload = { matchId, gameType, players, winner, moves, timestamp };
const resultHash = '0x' + crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
```

Any tampering with moves, players, or outcome produces a mismatched hash, exposing manipulation.

### Parent PIN Protection

- Stored as bcrypt hashes (`bcrypt.hash(pin, 10)`).
- 5 consecutive failed attempts trigger a 15-minute lockout persisted in the SQLite database across server restarts.
