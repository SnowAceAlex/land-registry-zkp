import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
// Explicit re-import on top of the toolbox: pnpm keeps two physical copies of
// chai on disk (hoisted root + .pnpm). The toolbox pulls hardhat-chai-matchers
// through its .pnpm path, which patches the .pnpm chai copy — while tests
// resolve the hoisted root copy, so matchers like `revertedWithCustomError`
// never appear on the chai instance tests actually use. Importing the plugin
// from this package's own context patches the right copy; chai.use() is
// idempotent, so this is harmless where the two copies unify.
import '@nomicfoundation/hardhat-chai-matchers';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the monorepo root — blockchain/ sits one level below it.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? '';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? '';

const config: HardhatUserConfig = {
  solidity: {
    // 0.8.36 clears both known-bug warnings Etherscan reports for 0.8.24:
    // LostStorageArrayWriteOnSlotOverflow (fixed 0.8.32) and
    // UnsoundSpillInMutualRecursion (fixed 0.8.36). Neither could affect these
    // contracts — no storage arrays, no mutual recursion, viaIR off — so this
    // is about a clean verified-source page, not a defect fix.
    version: '0.8.36',
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
  // Source verification on Sepolia (`npx hardhat verify`). hardhat-verify 2.1.x
  // talks to the Etherscan V2 API, where one key covers every supported chain.
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
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
  mocha: {
    // Circuit tests compile their .circom file via circom_tester before running,
    // which blows past mocha's 20s default. Poseidon-heavy circuits (transfer
    // builds two 20-level Merkle paths) are the slow ones.
    timeout: 300_000,
  },
};

export default config;
