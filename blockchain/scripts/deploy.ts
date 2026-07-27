/**
 * scripts/deploy.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Hardhat deploy script for RootRegistry contract.
 *
 * Usage:
 *   pnpm --filter blockchain hardhat run scripts/deploy.ts --network hardhat
 *   pnpm --filter blockchain hardhat run scripts/deploy.ts --network sepolia
 *
 * TODO:
 *  1. Deploy RootRegistry with the deployer wallet as the initial admin
 *  2. Grant STATE_AUTHORITY_ROLE to one or more authority accounts
 *  3. Log the deployed contract address (save to .env or a deployments/ file)
 *  4. Optionally verify on Etherscan: npx hardhat verify --network sepolia <address> <args>
 */

import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log('Deploying RootRegistry with account:', deployer.address);
  console.log('Account balance:', (await deployer.provider.getBalance(deployer.address)).toString());

  // TODO: Deploy RootRegistry
  // const RootRegistry = await ethers.getContractFactory('RootRegistry');
  // const rootRegistry = await RootRegistry.deploy(deployer.address);
  // await rootRegistry.waitForDeployment();
  //
  // const address = await rootRegistry.getAddress();
  // console.log('RootRegistry deployed to:', address);
  //
  // TODO: Grant STATE_AUTHORITY_ROLE to authority accounts
  // const STATE_AUTHORITY_ROLE = await rootRegistry.STATE_AUTHORITY_ROLE();
  // await rootRegistry.grantRole(STATE_AUTHORITY_ROLE, authorityAddress);
  // console.log('STATE_AUTHORITY_ROLE granted to:', authorityAddress);
  //
  // TODO (D30, Phase 4): when granting STATE_AUTHORITY_ROLE, ALSO set the
  //   authority's on-chain identity anchor, e.g.:
  //     const institute = ethers.keccak256(ethers.toUtf8Bytes(orgName)); // X.509 Subject "O"
  //     await rootRegistry.setAuthorityInstitute(authorityAddress, institute);
  //   (or fold grant + anchor into one function). The constructor stays
  //   deploy(admin) — the institute is per-authority (mapping), not a single
  //   immutable. See CODING_ROADMAP.md §0 (D30).

  console.log('TODO: implement deploy logic');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
