# ⚔️ Web3 Battle Arena

**Web3 Battle Arena** is a real-time multiplayer gaming platform engineered specifically for kids and families. It bridges fast, competitive tabletop board and action games with a family-friendly Web3 economy: **Proof-of-Chore Battle Pass**, parent-backed allowance, server-authoritative netcode, on-chain match receipts, ERC-4337 gasless account abstraction, and a tactile physical board game visual design.

---

## 🎮 Four Real-Time Games Included

All games run on **server-authoritative engines** with built-in heuristic AI bots across 3 difficulty tiers (**Easy**, **Medium**, **Hard**):

1. **⚡ Neon Math Arena** — Fast-paced 3D math duel. Both players face identical mental math questions, maneuver across 4 interactive answer tiles, and lock in their answers before the authoritative 12-second round timer expires. Correct answers score points; incorrect answers or timeouts cost hearts.
2. **🧠 Memory Match** — Educational card duel featuring multiple decks (Flags & Countries, Math Pairs, Animals, English ↔ Kiswahili). Cards pair distinct representations (e.g., 🇫🇷 ↔ France). Cards are masked server-side to prevent client snooping; bot AI models realistic human memory retention curves (20%, 65%, 95% recall).
3. **🔴 Connect Four** — Classic 7x6 gravity grid duel. Drop discs into columns with diagonal, horizontal, and vertical raycasting win detection. Includes intelligent bot AI capable of blocking opponent match points.
4. **🚀 Cyber Blaster** — Real-time 2D top-down cyberpunk duel shooter running on a fixed 40ms physics loop (25 TPS). Features obstacle cover (Circle-AABB collision math), randomized powerups (Shield, Overcharge, Speed Boost, Repair), laser projectile physics, dash maneuvers, and dynamic delta state compression.

---

## 🛡️ Parent-Backed Battle Pass & "Proof-of-Chore"

To eliminate predatory real-money micro-transactions and solve the kid screen-time paradox, Battle Arena introduces a parent-oracle incentive economy:

- **⚡ Arena Energy System:** Matches require 1 Arena Energy to enter. **Energy cannot be bought with money**; it is earned by completing real-world tasks or passing the daily 5-question Brain Quiz (with cooldowns).
- **📜 Proof of Chore (`ProofOfChore.sol`):** Kids submit completed real-world tasks (cleaning bedroom, completing homework, reading 30 minutes, doing dishes). Parents act as real-world Oracles, approving tasks on-chain or through a secure local PIN portal.
- **🏆 10-Tier Battle Pass:** Completing chores earns XP and unlocks real-life family reward vouchers (1-Hour Bonus Screen Time, Family Pizza Night Choice, Ice Cream Spree, $25 Toy Store Voucher) and tokenized ARENA allowance.
- **🎨 Armory Skins:** Completing specific chores unlocks cosmetic blaster skins (Crimson Phoenix, Shadow Phantom, Emerald Titan, Solar Sovereign).
- **🔒 Parent PIN Security:** Parent portals are protected by bcrypt-hashed PINs with SQLite-persisted brute-force lockouts (5 failed attempts trigger a 15-minute lock).

---

## 🔐 Web3 Identity & Gasless Account Abstraction

- **🔑 Production-Grade Dual-Vault:** Players are instantly provisioned a local burner wallet with a standard BIP-39 12-word mnemonic. Keys are redundantly mirrored across `localStorage` and `IndexedDB` with auto-healing to prevent loss on browser cache wipes.
- **💼 MetaMask Integration:** Optional standard EIP-1193 connection for web3 wallets.
- **⛽ ERC-4337 Gas Sponsorship (`ArenaPaymaster.sol`):** Players never need ETH or native gas tokens on L2s (Base, Arbitrum, Polygon). The Paymaster sponsors transaction gas with daily safety quotas (max 0.05 ETH/day per child).
- **🛡️ EIP-191 Authentication & Anti-Replay:** Login and registration require cryptographic wallet signatures. The server enforces replay protection supporting both timestamped signatures (`AUTH_WINDOW_MS`) and single-use server nonces (`/api/auth/nonce`).

---

## 🚀 Quick Start (All Operating Systems)

Battle Arena runs seamlessly across **Linux**, **macOS**, and **Windows**.

### Prerequisites

- **Node.js 18+ or 20+** installed: [https://nodejs.org](https://nodejs.org) (check with `node -v`)
- **Git**: [https://git-scm.com](https://git-scm.com)

### 1. Clone & Install Dependencies

From the repository root directory:

```bash
git clone https://github.com/abel149/Battle-Arena-.git
cd Battle-Arena-

# Automatically installs dependencies for both server and client:
npm install
```

_(Alternatively, you can manually run `npm --prefix server install` and `npm --prefix client install`)._

### 2. Start the Blockchain Node & Game Server

In your first terminal window:

```bash
npm start
```

> **What `npm start` does automatically:**
>
> 1. Detects if a local blockchain node is running on `http://127.0.0.1:8545`. If not, it automatically boots a local **Hardhat node**.
> 2. Automatically compiles and deploys the smart contracts:
>    - `MatchResult.sol` (on-chain immutable match receipts, protected by `onlyOwner`)
>    - `ArenaToken.sol` (ERC-20 ARENA reward token with batch minting)
>    - `ArenaBadges.sol` (ERC-1155 collectible achievement badges)
>    - `ProofOfChore.sol` (parent oracle attestation contract)
> 3. Restores active matches from SQLite (`active_rooms` table) if recovering from a restart.
> 4. Starts the Battle Arena backend server on port `3001` with centralized NonceManager tracking.

### 3. Start the Web Client

In a second terminal window:

```bash
npm run client
```

Now open **http://localhost:5173** in your web browser!

---

## 💻 Operating System Guides

### 🐧 Linux (Ubuntu, Debian, Fedora, Arch)

1. **Install Node.js & C++ Build Tools** (needed for SQLite native addon):
   ```bash
   # Ubuntu / Debian:
   sudo apt update
   sudo apt install -y build-essential python3 nodejs npm

   # Recommended: Node 20 via nvm (Node Version Manager)
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
   nvm install 20 && nvm use 20
   ```
2. **If port 3001 or 8545 is busy (`EADDRINUSE`):**
   ```bash
   fuser -k 3001/tcp 8545/tcp 5173/tcp
   ```
3. **Allow LAN teammates to connect (UFW Firewall):**
   ```bash
   sudo ufw allow 5173/tcp
   sudo ufw allow 3001/tcp
   ```

---

### 🍎 macOS (Apple Silicon M1/M2/M3/M4 & Intel)

1. **Install Xcode Command Line Tools & Node.js**:
   ```bash
   xcode-select --install
   # Using Homebrew:
   brew install node@20
   ```
2. **If port 3001, 8545, or 5173 is already in use:**
   ```bash
   lsof -ti :3001,8545,5173 | xargs kill -9
   ```
3. **Local Network Permission**:
   When macOS prompts _"Node wants to find and connect to devices on your local network"_, click **Allow** so multiplayer works across LAN devices.

---

### 🪟 Windows (Windows 10 / 11, PowerShell, CMD, Git Bash)

1. **Install Node.js 20+**:
   - Download the LTS installer from [nodejs.org](https://nodejs.org).
   - During installation, check the box: **"Automatically install the necessary tools (Chocolatey, Python, Visual Studio Build Tools)"** if prompted. This ensures `better-sqlite3` builds without issues.
   - If `better-sqlite3` shows compilation errors later, open PowerShell as Administrator and run:
     ```powershell
     npm install --global windows-build-tools
     ```

2. **PowerShell Script Execution Policy**:
   If PowerShell throws `File ... cannot be loaded because running scripts is disabled on this system`:

   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

3. **Running the App**:

   ```powershell
   # Terminal 1: Starts blockchain + game server
   npm start

   # Terminal 2: Starts web client
   npm run client
   ```

4. **Kill Stuck Ports on Windows (`EADDRINUSE`)**:
   ```powershell
   npx kill-port 3001 8545 5173
   ```

---

## 🌐 Playing with Teammates Across Devices / LAN

Battle Arena supports playing between two separate laptops, tablets, or phones connected to the same Wi-Fi network:

1. **Find the host machine's Local IP address:**
   - **Linux**: Run `hostname -I` (e.g. `192.168.1.8`)
   - **macOS**: Run `ipconfig getifaddr en0`
   - **Windows**: Run `ipconfig` (look for _IPv4 Address_ under your active Wi-Fi adapter)
2. **Start the server and client on the host machine:**
   ```bash
   npm start        # Terminal 1
   npm run client   # Terminal 2
   ```
3. **On your teammate's device/laptop/phone:**
   Open their browser and navigate to:
   ```
   http://<HOST_IP>:5173     (e.g., http://192.168.1.8:5173)
   ```
   _The client automatically resolves Socket.IO connections to `http://<HOST_IP>:3001`._

---

## 🕹️ How to Play & Test Multiplayer

1. **Authentication**:
   - Register a handle and password, or authenticate with your burner wallet / MetaMask via EIP-191 signature.
   - Sessions are protected with SHA-256 hashed tokens and survive browser reloads.
2. **Solo vs Bot**:
   - Click **Play vs Bot** on any of the 4 games.
   - Select difficulty: **Easy**, **Medium**, or **Hard**. AI accuracy, reaction times, and projectile targeting dynamically scale.
3. **Multiplayer Matchmaking (Quick Match)**:
   - Open `http://localhost:5173` in two browser windows (or normal + incognito).
   - Sign in with two different accounts.
   - Both players click **Quick Match** on the same game to be paired instantly.
4. **Private Game Rooms**:
   - Player 1 clicks **Create Room** and shares the 5-character room code (e.g. `K9X2B`).
   - Player 2 clicks **Join Room** and enters the code.
5. **Live Spectator Mode & Lobby Chat**:
   - Live games appear under **Chat & Watch** on the main Hub. Click **Spectate** to watch real-time gameplay.
   - Chat is moderated with positive preset shortcuts and kid-safe regex profanity filters.
6. **On-Chain Results & Replays**:
   - When a match concludes, the server signs and commits the result hash on-chain (`MatchResult.sol`).
   - Click **Watch Replay** under **Verified Match Records** to inspect the move-by-move replay archive stored in SQLite.

---

## 🧪 Automated Testing Suite

The project includes **49 automated unit and integration tests** verifying smart contracts, authoritative game engines, security rules, and state rehydration:

```bash
# Run the complete test suite (49 passing tests):
npm test

# Run end-to-end matchmaking flow test:
cd server && node --test test/matchmake-flow.test.mjs

# Run full AppSec verification test:
cd server && node --test test/auth-security.test.mjs

# Force compile smart contracts:
cd server && npx hardhat compile --force

# Production frontend build:
cd client && npm run build
```

---

## 🛠️ Project Structure

```
Battle-Arena-/
├── package.json               # Root scripts (start, client, dev, test, build, install:all)
├── README.md                  # Comprehensive project & setup documentation
├── server/
│   ├── index.js               # Authoritative Socket.IO & Express server (matchmaking, rooms, chat, tickers)
│   ├── security.js            # Anti-replay auth, CORS origin guards, security headers, rate limiting
│   ├── store.js               # SQLite database & player profile storage with WAL mode (server/data.sqlite)
│   ├── signer.js              # Centralized NonceManager provider/signer preventing transaction nonce clashes
│   ├── chain-onchain.js       # MatchResult.sol on-chain adapter with batching & simulated fallback
│   ├── chain-tokens.js        # ArenaToken & ArenaBadges minting relayer
│   ├── chain-chore.js         # ProofOfChore oracle attestation recording
│   ├── contracts/
│   │   ├── MatchResult.sol    # On-chain match receipts contract (onlyOwner)
│   │   ├── ArenaToken.sol     # ERC-20 ARENA reward token contract (onlyMinter)
│   │   ├── ArenaBadges.sol    # ERC-1155 collectible achievement badges contract
│   │   ├── ProofOfChore.sol   # Parent Oracle chore attestation contract
│   │   └── ArenaPaymaster.sol # ERC-4337 Account Abstraction gas paymaster
│   ├── games/
│   │   ├── index.js           # Pluggable game engine registry
│   │   ├── math-arena.js      # 3D Math duel engine (authoritative 12s timer)
│   │   ├── memory.js          # Memory Match engine with card masking & human memory simulation
│   │   ├── connectfour.js     # 7x6 gravity grid with win raycasting & minimax bot
│   │   ├── cyber-blaster.js   # 2D duel shooter with 40ms tick physics & powerups
│   │   └── decks.js           # Educational decks (Flags, Animals, Kiswahili, Math)
│   └── test/                  # Node.js native test suite (49 unit & integration tests)
│       ├── auth-security.test.mjs
│       ├── matchmake-flow.test.mjs
│       ├── memory.test.mjs
│       ├── math-arena.test.mjs
│       ├── connectfour.test.mjs
│       ├── cyber-blaster.test.mjs
│       ├── persistence.test.mjs
│       ├── store.test.mjs
│       ├── skins.test.mjs
│       ├── chore.test.mjs
│       └── tokens.test.mjs
└── client/
    ├── vite.config.js         # Vite configuration with 0.0.0.0 host binding & code splitting
    ├── src/
    │   ├── socket.js          # Socket.IO client with session headers & dynamic LAN host resolution
    │   ├── main.jsx           # React root with lazy route code-splitting
    │   ├── lib/
    │   │   ├── session.js     # Production-grade dual-vault (IndexedDB + localStorage auto-healing)
    │   │   ├── chain.js       # Contract readers & balance formatters
    │   │   └── router.js      # Lightweight hash-based router
    │   ├── pages/
    │   │   ├── Hub.jsx        # Tabletop arcade hub with integrated Chat & Watch (#hub)
    │   │   ├── BattlePass.jsx # Proof-of-Chore Battle Pass & Allowance portal (#battlepass)
    │   │   ├── Arena.jsx      # 3D Neon Math Arena match interface (#arena)
    │   │   ├── MemoryMatch.jsx# Memory Match duel interface (#memory)
    │   │   ├── ConnectFour.jsx# Connect Four disc duel interface (#connectfour)
    │   │   └── CyberBlaster.jsx# Cyber Blaster real-time action interface (#blaster)
    │   └── components/
    │       ├── ArenaPreview3D.jsx     # WebGL Three.js arena floor with proper GPU cleanup
    │       ├── ParentApprovalModal.jsx# PIN-protected parent chore oracle approval modal
    │       ├── SkinLockerModal.jsx    # Armory skins locker & chore submit view
    │       ├── ReplayModal.jsx        # Move-by-move match replay viewer
    │       ├── AccountModal.jsx       # BIP-39 mnemonic seed phrase & keystore backup modal
    │       ├── JoinRoomModal.jsx      # 5-character private room code modal
    │       ├── VerifyPanel.jsx        # On-chain transaction ledger verification modal
    │       └── ChainBadge.jsx         # Live blockchain status pill
    └── smoke-test.mjs         # Headless socket match validation script
```

---

## ❓ Troubleshooting & FAQs

### 1. `Error: listen EADDRINUSE: address already in use :::3001` or `8545`

Another instance of the backend or Hardhat is running in the background.

- **Linux/macOS**: `fuser -k 3001/tcp 8545/tcp 5173/tcp`
- **Windows**: `npx kill-port 3001 8545 5173`

### 2. "Arena server offline — start it with 'cd server && npm start'"

Your frontend cannot connect to port 3001. Ensure `npm start` is running in your first terminal.

### 3. Native module compilation errors (`better-sqlite3`)

- **Linux**: Run `sudo apt install build-essential python3`
- **macOS**: Run `xcode-select --install`
- **Windows**: Run `npm install --global windows-build-tools` (or install Visual Studio Community Desktop C++).

### 4. How do I reset player data, tokens, and match history?

Delete the SQLite database file in `server/`:

```bash
# Linux / macOS:
rm server/data.sqlite

# Windows (PowerShell):
Remove-Item server/data.sqlite
```

The server will automatically generate a fresh schema on next boot.

### 5. MetaMask Nonce Desync on Localhost

If you restart the local Hardhat node, transaction nonces reset to 0. In MetaMask:

- Go to **Settings** → **Advanced** → **Clear activity and nonce data** (or Reset Account).
- Ensure your network RPC is set to `http://127.0.0.1:8545` with Chain ID `31337`.

---

## 📄 License

MIT License. Designed and engineered for decentralized, family-friendly competitive gaming at the Swafri Hackathon 2026.
