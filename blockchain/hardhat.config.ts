import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from root of the monorepo (two levels up from blockchain/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? '';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // Local Hardhat network (default — no config needed)
    hardhat: {},

    // Sepolia testnet — requires SEPOLIA_RPC_URL and PRIVATE_KEY in .env
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },
};

export default config;
