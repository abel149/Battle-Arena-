# ⚔️ Web3 Battle Arena

Real-time multiplayer gaming platform featuring Web3 player identity, real on-chain
match verification + token rewards, leaderboards, match replays, and collectible
achievement badges.

---

## 🎮 Games Included

- **⚡ Neon Math Arena** — 3D arena duel. Both players face identical timed questions, move across 4 answer tiles, and lock in before the 10-second timer expires. Correct answers score points; wrong answers cost lives. Playable in 3 bot difficulty tiers (**Easy**, **Medium**, **Hard**) or live multiplayer.
- **🧠 Memory Match** — Educational card duel (Flags & Countries, Math Pairs, Animals, English ↔ Kiswahili). Cards pair distinct representations (e.g., 🇫🇷 ↔ France), testing recall and skill.

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

*(Alternatively, you can manually run `npm --prefix server install` and `npm --prefix client install`).*

### 2. Start the Blockchain Node & Game Server

In your first terminal window:

```bash
npm start
```

> **What `npm start` does automatically:**
> 1. Detects if a local blockchain node is running on `http://127.0.0.1:8545`. If not, it automatically boots a local **Hardhat node**.
> 2. Automatically compiles and deploys the smart contracts:
>    - `MatchResult.sol` (on-chain match receipts)
>    - `ArenaToken.sol` (ERC-20 ARENA reward token)
>    - `ArenaBadges.sol` (ERC-1155 achievement badges)
> 3. Starts the Battle Arena backend server on port `3001` in on-chain mode.

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
   When macOS prompts *"Node wants to find and connect to devices on your local network"*, click **Allow** so multiplayer works across LAN devices.

---

### 🪟 Windows (Windows 10 / 11, PowerShell, CMD, Git Bash)

1. **Install Node.js 20+**:
   - Download the LTS installer from [nodejs.org](https://nodejs.org).
   - During installation, check the box: **"Automatically install the necessary tools (Chocolatey, Python, Visual Studio Build Tools)"** if prompted. This ensures `better-sqlite3` builds without issues.
   - If `better-sqlite3` shows compilation errors later, open PowerShell as Administrator and run:
     ```powershell
     npm install --global windows-build-tools
     ```
     *(Or install "Desktop development with C++" via the free Visual Studio Community Installer).*

2. **PowerShell Script Execution Policy**:
   If PowerShell throws `File ... cannot be loaded because running scripts is disabled on this system`:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

3. **Running the App**:
   - Open PowerShell or Git Bash:
     ```powershell
     # Terminal 1: Starts blockchain + game server (cross-platform npx.cmd supported)
     npm start

     # Terminal 2: Starts web client
     npm run client
     ```

4. **Kill Stuck Ports on Windows (`EADDRINUSE`)**:
   ```powershell
   # Quick one-liner via npx:
   npx kill-port 3001 8545 5173

   # Or natively in PowerShell:
   Get-Process -Id (Get-NetTCPConnection -LocalPort 3001).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
   Get-Process -Id (Get-NetTCPConnection -LocalPort 8545).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
   Get-Process -Id (Get-NetTCPConnection -LocalPort 5173).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force
   ```

5. **Windows Firewall Prompt**:
   When prompted by Windows Defender Firewall, check **Private networks** and click **Allow access**.

> 💡 **Tip for Windows Users**: You can also use **WSL2** (Windows Subsystem for Linux with Ubuntu) for an identical Linux terminal experience:
> ```bash
> wsl --install
> ```

---

## 🌐 Playing with Teammates Across Devices / LAN

Battle Arena supports playing between two separate laptops, tablets, or phones connected to the same Wi-Fi network:

1. **Find the host machine's Local IP address:**
   - **Linux**: Run `hostname -I` (e.g. `192.168.1.8`)
   - **macOS**: Run `ipconfig getifaddr en0`
   - **Windows**: Run `ipconfig` (look for *IPv4 Address* under your active Wi-Fi adapter)
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
   *The client automatically resolves Socket.IO connections to `http://<HOST_IP>:3001`!*

---

## 🕹️ How to Play & Test Multiplayer

1. **Authentication**:
   - The app opens on a sign-in screen.
   - Register a username and password (or click *Connect MetaMask* to bind your wallet).
   - Works across browser refreshes and different devices.
2. **Solo vs Bot**:
   - Click **🤖 Play vs Bot** on Math Arena or Memory Match.
   - Select difficulty: **Easy**, **Medium**, or **Hard**. The bot's accuracy and reaction times dynamically adjust.
3. **Multiplayer Matchmaking (Quick Match)**:
   - Open `http://localhost:5173` in two separate browser windows (or normal + incognito).
   - Sign in with two different accounts.
   - Both players click **⚡ Quick Match** on the same game to be paired instantly.
4. **Private Game Rooms**:
   - Player 1 clicks **Create Room** and shares the 5-character room code.
   - Player 2 clicks **Join Room** and enters the code.
5. **Live Spectator Mode**:
   - Ongoing public matches appear under **Live Matches** in the lobby. Click **👁 Spectate** to watch in real-time.
6. **On-Chain Results & Replays**:
   - When a match ends (by knockout or score), the result banner immediately reveals the winner and rematch buttons.
   - The transaction receipt confirms on the local Hardhat blockchain with a real transaction hash.
   - Click **▶ Replay** under **On-Chain Results** in the lobby to scrub through past match moves.

---

## 🧪 Automated Testing

Run the full automated test suite (28 tests covering game engines, EIP-191 verification, reward calculations, and weekly resets):

```bash
# Run unit and integration tests:
npm test

# Run socket smoke test:
cd client && node smoke-test.mjs

# Run full end-to-end on-chain bash verification:
bash server/scripts/e2e-onchain.sh
```

---

## 🛠️ Project Structure

```
Battle-Arena-/
├── package.json               # Root scripts (start, client, dev, test, build, install:all)
├── server/
│   ├── index.js               # Socket.IO & Express server (matchmaking, auth, gameplay, rewards)
│   ├── store.js               # SQLite database & player profile storage (server/data.sqlite)
│   ├── chain-onchain.js       # Hardhat / Ethers integration for MatchResult.sol
│   ├── chain-tokens.js        # ERC-20 ARENA & ERC-1155 Badges minting logic
│   ├── contracts/
│   │   ├── MatchResult.sol    # On-chain match receipts contract
│   │   ├── ArenaToken.sol     # ERC-20 ARENA reward token contract
│   │   └── ArenaBadges.sol    # ERC-1155 collectible achievement badges contract
│   ├── scripts/
│   │   ├── start-onchain.mjs  # One-step auto-runner: boots Hardhat, deploys, starts backend
│   │   ├── deploy-match-result.js
│   │   ├── deploy-tokens.js
│   │   └── e2e-onchain.sh
│   ├── games/
│   │   ├── index.js           # Pluggable game registry
│   │   ├── math-arena.js      # 3D Math Arena duel engine
│   │   ├── memory.js          # Memory Match engine with bot AI
│   │   └── decks.js           # Educational decks (Flags, Animals, Kiswahili, Math)
│   └── test/                  # Node.js native test suite
└── client/
    ├── vite.config.js         # Vite configuration with 0.0.0.0 host binding
    ├── src/
    │   ├── socket.js          # Socket.IO client with dynamic LAN host resolution
    │   ├── App.jsx            # Classic lobby & spectator view (#classic)
    │   ├── pages/
    │   │   ├── Hub.jsx        # Modern neon gaming hub (#hub)
    │   │   ├── Arena.jsx      # 3D Neon Math Arena match interface
    │   │   └── MemoryMatch.jsx# Memory Match duel interface
    │   └── components/
    │       └── ArenaPreview3D.jsx # Three.js interactive 3D preview
    └── smoke-test.mjs         # Headless socket match validation script
```

---

## ❓ Troubleshooting & FAQs

### 1. `Error: listen EADDRINUSE: address already in use :::3001` or `8545`
Another instance of the backend or Hardhat is still running in the background.
- **Linux/Mac**: `fuser -k 3001/tcp 8545/tcp 5173/tcp`
- **Windows**: `npx kill-port 3001 8545 5173`

### 2. "Arena server offline — start it with 'cd server && npm start'"
Your frontend cannot connect to port 3001. Ensure `npm start` is actively running in your first terminal.

### 3. Native module compilation errors (`better-sqlite3`)
- **Linux**: Run `sudo apt install build-essential python3`
- **Mac**: Run `xcode-select --install`
- **Windows**: Run `npm install --global windows-build-tools` (or install Visual Studio Community Desktop C++).

### 4. How do I reset all player data, tokens, and match history?
Delete the SQLite database file in `server/`:
```bash
# Linux / macOS:
rm server/data.sqlite

# Windows (PowerShell):
Remove-Item server/data.sqlite
```
The server will automatically generate a fresh database on next boot.

### 5. MetaMask Nonce Desync on Localhost
If you restart the local Hardhat node, transaction nonces reset to 0. In MetaMask:
- Go to **Settings** → **Advanced** → **Clear activity and nonce data** (or Reset Account).
- Ensure your network RPC is set to `http://127.0.0.1:8545` with Chain ID `31337`.

---

## 📄 License

MIT License. Crafted for decentralized competitive gaming.
