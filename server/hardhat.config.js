import { defineConfig } from 'hardhat/config';

export default defineConfig({
  solidity: {
    compilers: [{ version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 } } }],
  },
});
