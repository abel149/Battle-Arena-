import { defineConfig } from 'hardhat/config';

export default defineConfig({
  solidity: {
    compilers: [{ version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 } } }],
  },
  networks: {
    baseSepolia: {
      type: 'http',
      chainType: 'op',
      url: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      chainId: 84532,
      accounts: process.env.BASE_SEPOLIA_PRIVATE_KEY ? [process.env.BASE_SEPOLIA_PRIVATE_KEY] : [],
    },
  },
});
