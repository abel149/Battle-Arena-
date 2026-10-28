import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MATCH_RESULT_ABI = [
  'function recordMatch(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves) external',
  'function matchCount() external view returns (uint256)',
  'function getMatch(bytes32 matchId) external view returns (tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp))',
  'function getMatchByIndex(uint256 index) external view returns (tuple(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp))',
  'event MatchRecorded(bytes32 matchId, string gameType, address winner, address playerA, address playerB, uint256 moves, uint64 timestamp)',
];

async function main() {
  // Connect to the node. When run via `hardhat run --network hardhat`, Hardhat
  // already started a local in-process network; otherwise fall back to the LAN node.
  const nodeUrl = process.env.NODE_HTTP_URL || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(nodeUrl);

  // Use a signer that can send transactions. Prefer PRIVATE_KEY if set, else
  // fall back to Hardhat local account #0 (the well-known dev account).
  let signer;
  if (process.env.PRIVATE_KEY) {
    signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  } else {
    // Hardhat local default account #0.
    signer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
  }

  // Read bytecode from the compiled artifact.
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'MatchResult.sol', 'MatchResult.json');
  let artifact;
  try { artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8')); }
  catch {
    const alt = path.join(__dirname, '..', 'artifacts', 'MatchResult.sol', 'MatchResult.json');
    artifact = JSON.parse(fs.readFileSync(alt, 'utf8'));
  }

  const MatchResult = new ethers.ContractFactory(MATCH_RESULT_ABI, artifact.bytecode, signer);
  const matchResult = await MatchResult.deploy();
  await matchResult.waitForDeployment();

  const address = await matchResult.getAddress();
  console.log('MatchResult deployed to:', address);
  console.log('deployer:', await signer.getAddress());

  const outPath = path.join(__dirname, '..', 'match-result-address.json');
  fs.writeFileSync(outPath, JSON.stringify({
    address,
    network: process.env.HARDHAT_NETWORK || 'hardhat',
    timestamp: Date.now(),
  }, null, 2));
  console.log('Wrote', outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
