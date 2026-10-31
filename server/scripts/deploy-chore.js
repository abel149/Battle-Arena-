/**
 * @file deploy-chore.js
 * @description Standalone deployment script for ProofOfChore.sol.
 * Connects to EVM network, deploys ProofOfChore oracle contract, and persists
 * the deployed contract address and deployment parameters to chore-address.json.
 */

import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Main deployment execution for ProofOfChore contract.
 *
 * @async
 * @function main
 * @throws {Error} If connection or deployment transaction fails.
 */
async function main() {
  const nodeUrl = process.env.NODE_HTTP_URL || 'http://127.0.0.1:8545';
  const provider = new ethers.JsonRpcProvider(nodeUrl);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  const isLocalChain = chainId === 31337;

  const privateKey =
    process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const signer = new ethers.Wallet(privateKey, provider);

  const artifactPath = path.join(
    __dirname,
    '..',
    'artifacts',
    'contracts',
    'ProofOfChore.sol',
    'ProofOfChore.json'
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  console.log(`Deploying ProofOfChore to chain ${chainId} via ${signer.address}...`);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`ProofOfChore deployed to: ${address}`);

  const output = {
    address,
    network: isLocalChain ? 'hardhat-local' : 'custom',
    chainId,
    deployer: signer.address,
    timestamp: Date.now(),
  };

  const outFile = path.join(__dirname, '..', 'chore-address.json');
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`Saved deployment info to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
