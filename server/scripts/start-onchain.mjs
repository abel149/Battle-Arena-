import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const NODE_URL = process.env.NODE_HTTP_URL || 'http://127.0.0.1:8545';
const LOCAL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function checkRpc() {
  try {
    const res = await fetch(NODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const rpcOk = await checkRpc();
  if (!rpcOk) {
    console.error(`\n❌ Could not connect to local Ethereum node at ${NODE_URL}.`);
    console.error('Please start the Hardhat node first in another terminal:');
    console.error('  cd server && npx hardhat node\n');
    process.exit(1);
  }

  console.log(`\n🔗 Connected to local blockchain at ${NODE_URL}`);
  console.log('📦 Compiling contracts...');
  execSync('npx hardhat compile', { cwd: SERVER_DIR, stdio: 'inherit' });

  console.log('🚀 Deploying MatchResult.sol...');
  execSync('node scripts/deploy-match-result.js', {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: { ...process.env, NODE_HTTP_URL: NODE_URL, PRIVATE_KEY: LOCAL_PK },
  });

  console.log('🚀 Deploying ArenaToken.sol + ArenaBadges.sol...');
  execSync('node scripts/deploy-tokens.js', {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env: { ...process.env, NODE_HTTP_URL: NODE_URL, PRIVATE_KEY: LOCAL_PK },
  });

  const matchFile = path.join(SERVER_DIR, 'match-result-address.json');
  const tokenFile = path.join(SERVER_DIR, 'token-address.json');

  const matchResult = JSON.parse(fs.readFileSync(matchFile, 'utf8')).address;
  const tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));

  console.log('\n✅ Contracts deployed:');
  console.log('   MatchResult: ', matchResult);
  console.log('   ArenaToken:  ', tokens.arenaToken);
  console.log('   ArenaBadges: ', tokens.arenaBadges);
  console.log('\n🎮 Starting Battle Arena server in on-chain mode...\n');

  const env = {
    ...process.env,
    NODE_HTTP_URL: NODE_URL,
    PRIVATE_KEY: LOCAL_PK,
    MATCH_RESULT_ADDRESS: matchResult,
    ARENA_TOKEN_ADDRESS: tokens.arenaToken,
    ARENA_BADGES_ADDRESS: tokens.arenaBadges,
    MATCH_RESULT_CHAIN_ID: '31337',
    ARENA_CHAIN_ID: '31337',
  };

  const proc = spawn('node', ['index.js'], {
    cwd: SERVER_DIR,
    stdio: 'inherit',
    env,
  });

  proc.on('exit', (code) => process.exit(code || 0));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
