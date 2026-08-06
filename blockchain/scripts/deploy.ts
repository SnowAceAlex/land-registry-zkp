/**
 * scripts/deploy.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 4 — deploy the full on-chain stack (D12):
 *   RootRegistry
 *   Groth16Verifier{Ownership,Mortgage,Transfer}   (generated — needs
 *     `pnpm --filter blockchain run circuits:setup` to have been run)
 *   LandRegistryVerifier                            (dispatcher)
 * then register the state authority: STATE_AUTHORITY_ROLE grant + the D30
 * identity anchor (keccak256 of the X.509 Subject "O" organization name) in one
 * registerAuthority() call.
 *
 * Usage:
 *   pnpm --filter blockchain run deploy:local     (--network hardhat)
 *   pnpm --filter blockchain run deploy:sepolia   (--network sepolia)
 *
 * Env (see .env.example): PRIVATE_KEY / SEPOLIA_RPC_URL for sepolia, plus
 *   AUTHORITY_ADDRESS   authority account (default: deployer — fine for PoC)
 *   AUTHORITY_ORG_NAME  X.509 Subject "O" to anchor (default below; must match
 *                       the self-signed certificate used by Phase 9)
 *
 * Addresses are written to deployments/<network>.json (committed — it is the
 * record of where the thesis contracts live, esp. on Sepolia).
 */

import * as fs from 'fs';
import * as path from 'path';
import { ethers, network } from 'hardhat';

/** Default mock organization for the PoC — X.509 Subject "O" (D30). */
const DEFAULT_ORG_NAME = 'So Tai nguyen va Moi truong TP.HCM';

const VERIFIER_CONTRACTS = [
  'Groth16VerifierOwnership',
  'Groth16VerifierMortgage',
  'Groth16VerifierTransfer',
] as const;

async function main() {
  const [deployer] = await ethers.getSigners();
  // `||` not `??`: an unset var in .env arrives as an empty string, which `??`
  // would happily pass through as the authority address.
  const authorityAddress = process.env.AUTHORITY_ADDRESS?.trim() || deployer.address;
  const orgName = process.env.AUTHORITY_ORG_NAME?.trim() || DEFAULT_ORG_NAME;
  const instituteHash = ethers.keccak256(ethers.toUtf8Bytes(orgName));

  // Validate BEFORE deploying anything — a bad address should not surface as an
  // opaque ENS-resolution failure after five contracts have already cost gas.
  if (!ethers.isAddress(authorityAddress) || authorityAddress === ethers.ZeroAddress) {
    throw new Error(
      `AUTHORITY_ADDRESS must be a valid non-zero address: "${authorityAddress}". ` +
        `Leave it empty in .env to use the deployer account.`,
    );
  }

  console.log(`network:   ${network.name}`);
  console.log(`deployer:  ${deployer.address}`);
  console.log(
    `balance:   ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`,
  );
  console.log(`authority: ${authorityAddress}`);
  console.log(`org name:  "${orgName}"\n           → ${instituteHash}\n`);

  // The generated verifiers only exist after trusted setup + sync + compile.
  for (const name of VERIFIER_CONTRACTS) {
    const solPath = path.join(__dirname, '..', 'contracts', 'verifiers', `${name}.sol`);
    if (!fs.existsSync(solPath)) {
      throw new Error(
        `Missing contracts/verifiers/${name}.sol — run ` +
          `"pnpm --filter blockchain run circuits:setup" (then compile) before deploying.`,
      );
    }
  }

  const registry = await ethers.deployContract('RootRegistry', [deployer.address]);
  await registry.waitForDeployment();
  console.log(`RootRegistry             ${await registry.getAddress()}`);

  const verifierAddresses: string[] = [];
  for (const name of VERIFIER_CONTRACTS) {
    const verifier = await ethers.deployContract(name);
    await verifier.waitForDeployment();
    verifierAddresses.push(await verifier.getAddress());
    console.log(`${name.padEnd(24)} ${await verifier.getAddress()}`);
  }

  const landRegistryVerifier = await ethers.deployContract('LandRegistryVerifier', [
    await registry.getAddress(),
    ...verifierAddresses,
  ]);
  await landRegistryVerifier.waitForDeployment();
  console.log(`LandRegistryVerifier     ${await landRegistryVerifier.getAddress()}`);

  const deployment = {
    network: network.name,
    chainId: Number((await deployer.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    authority: { address: authorityAddress, orgName, instituteHash },
    contracts: {
      RootRegistry: await registry.getAddress(),
      Groth16VerifierOwnership: verifierAddresses[0],
      Groth16VerifierMortgage: verifierAddresses[1],
      Groth16VerifierTransfer: verifierAddresses[2],
      LandRegistryVerifier: await landRegistryVerifier.getAddress(),
    },
  };

  // Write the record BEFORE the last transaction: on a live network the
  // contracts above already cost gas, and losing their addresses to a failure
  // in the step below would strand them. smoke:<network> reports an
  // unregistered authority clearly, so a half-finished record is recoverable.
  const deploymentsDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  // D30: role grant + institute anchor, atomically.
  const tx = await registry.registerAuthority(authorityAddress, instituteHash);
  await tx.wait();
  console.log(`\nSTATE_AUTHORITY_ROLE + authorityInstitute anchored for ${authorityAddress}`);

  console.log(`\ndeployment record → ${path.relative(process.cwd(), outPath)}`);
  console.log(
    `set NEXT_PUBLIC_CONTRACT_ADDRESS=${deployment.contracts.RootRegistry} (RootRegistry) in .env for the frontend`,
  );

  if (network.name === 'sepolia') {
    console.log('\nOptional Etherscan verification:');
    console.log(
      `  npx hardhat verify --network sepolia ${deployment.contracts.RootRegistry} ${deployer.address}`,
    );
    for (const [i, name] of VERIFIER_CONTRACTS.entries()) {
      console.log(`  npx hardhat verify --network sepolia ${verifierAddresses[i]}  # ${name}`);
    }
    console.log(
      `  npx hardhat verify --network sepolia ${deployment.contracts.LandRegistryVerifier} ` +
        `${deployment.contracts.RootRegistry} ${verifierAddresses.join(' ')}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
