import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Deploy ArenaToken.sol (ERC-20 ARENA) + ArenaBadges.sol (ERC-1155 badges).
// Writes token-address.json so chain-tokens.js can find them, mirroring
// deploy-match-result.js for MatchResult.sol.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ARENA_TOKEN_ABI = [
  'constructor(address minter)',
  'function minter() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address to, uint256 value) external',
];

const ARENA_BADGES_ABI = [
  'constructor(address minter)',
  'function minter() view returns (address)',
  'function ensureBadge(uint256 id, string label) external',
  'function mint(address to, uint256 id) external',
  'function holderOf(uint256 id) view returns (address)',
  'function currentNextId() view returns (uint256)',
  'event BadgeCreated(uint256 indexed id, string label)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
];

const LOCAL_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

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
  const signer = new ethers.Wallet(privateKey || LOCAL_PK, provider);

  const artifactDir = path.join(__dirname, '..', 'artifacts', 'contracts');
  const loadArtifact = (contract) => {
    const p = path.join(artifactDir, `${contract}.sol`, `${contract}.json`);
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  };

  // Pin sequential explicit nonces: with automining nodes, fetching the nonce
  // twice via RPC can race the freshly mined deployment and reject the second tx.
  const baseNonce = Number(await provider.getTransactionCount(signer.address, 'pending'));

  // ---- ArenaToken (ERC-20 ARENA) ----
  const ArenaToken = new ethers.ContractFactory(ARENA_TOKEN_ABI, loadArtifact('ArenaToken').bytecode, signer);
  const arenaToken = await ArenaToken.deploy(signer.address, { nonce: baseNonce });
  await arenaToken.waitForDeployment();
  const tokenAddress = await arenaToken.getAddress();
  console.log('ArenaToken (ARENA) deployed to:', tokenAddress);

  // ---- ArenaBadges (ERC-1155 badges) ----
  const ArenaBadges = new ethers.ContractFactory(ARENA_BADGES_ABI, loadArtifact('ArenaBadges').bytecode, signer);
  const arenaBadges = await ArenaBadges.deploy(signer.address, { nonce: baseNonce + 1 });
  await arenaBadges.waitForDeployment();
  const badgesAddress = await arenaBadges.getAddress();
  console.log('ArenaBadges deployed to:', badgesAddress);
  console.log('deployer (minter):', signer.address);

  const outPath = process.env.TOKEN_DEPLOYMENT_FILE
    || path.join(__dirname, '..', 'token-address.json');
  fs.writeFileSync(outPath, JSON.stringify({
    arenaToken: tokenAddress,
    arenaBadges: badgesAddress,
    minter: signer.address,
    network: networkName,
    chainId,
    timestamp: Date.now(),
  }, null, 2));
  console.log('Wrote', outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
