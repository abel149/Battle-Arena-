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
  const nodeUrl = process.env.NODE_HTTP_URL
    || process.env.BASE_SEPOLIA_RPC_URL
    || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(nodeUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const isLocalChain = chainId === 31337;
  if (process.env.DEPLOYMENT_NETWORK === 'base-sepolia' && chainId !== 84532) {
    throw new Error(`Base Sepolia deployment requested, but RPC chain ID is ${chainId}`);
  }
  const networkName = process.env.DEPLOYMENT_NETWORK || (isLocalChain ? 'hardhat-local' : null);
  if (!networkName) {
    throw new Error('Set DEPLOYMENT_NETWORK to label this deployment (for example base-sepolia)');
  }

  const privateKey = process.env.PRIVATE_KEY || process.env.BASE_SEPOLIA_PRIVATE_KEY;
  if (!privateKey && !isLocalChain) {
    throw new Error('PRIVATE_KEY is required for non-local deployments');
  }
  const signer = new ethers.Wallet(
    privateKey || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    provider,
  );

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

  const outPath = process.env.MATCH_RESULT_DEPLOYMENT_FILE
    || path.join(__dirname, '..', 'match-result-address.json');
  fs.writeFileSync(outPath, JSON.stringify({
    address,
    network: networkName,
    chainId,
    timestamp: Date.now(),
  }, null, 2));
  console.log('Wrote', outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
