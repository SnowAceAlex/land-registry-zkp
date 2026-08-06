/**
 * scripts/smokeDeployment.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Check a LIVE deployment (local node or Sepolia) end to end, reading the
 * addresses from deployments/<network>.json written by scripts/deploy.ts.
 *
 * Two modes:
 *   default          read-only — prints registry state, the D30 identity anchor
 *                    and the role check, and confirms the dispatcher is wired to
 *                    the three verifiers. Sends no transaction, costs no gas.
 *   SMOKE_PUBLISH=1  full round trip — builds a real Merkle tree from mock
 *                    records, publishes its root (TRANSACTION, costs gas),
 *                    generates a real ownership proof and verifies it on-chain.
 *
 * Usage:
 *   pnpm --filter blockchain run smoke:deployment                 # read-only
 *   SMOKE_PUBLISH=1 pnpm --filter blockchain run smoke:deployment # round trip
 *   (PowerShell: $env:SMOKE_PUBLISH=1; pnpm --filter blockchain run smoke:deployment)
 *
 * Add --network localhost / --network sepolia via the package scripts.
 *
 * ⚠️  Publishing changes on-chain state. On a deployment you intend to keep as
 *     "the" demo instance, run read-only first and only publish deliberately.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ethers, network } from 'hardhat';

import { PUBLIC_SIGNAL_ORDER } from '../shared/circuitInputs';
import { fromUnixTimestamp } from '../shared/datetime';
import { generateGroth16Proof, getCircuitPaths, toSolidityCalldata } from '../shared/zkpHelper';
import { buildSampleInput } from './setup/sampleWitness';

const BLOCKCHAIN_DIR = path.resolve(__dirname, '..');

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  authority: { address: string; orgName: string; instituteHash: string };
  contracts: Record<string, string>;
}

function loadDeployment(): DeploymentRecord {
  const recordPath = path.join(BLOCKCHAIN_DIR, 'deployments', `${network.name}.json`);
  if (!fs.existsSync(recordPath)) {
    throw new Error(
      `No deployment record at deployments/${network.name}.json — ` +
        `deploy to this network first (see DEPLOYMENT.md).`,
    );
  }
  return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
}

async function main() {
  const deployment = loadDeployment();
  const [signer] = await ethers.getSigners();

  console.log(`\nnetwork:    ${network.name} (chainId ${deployment.chainId})`);
  console.log(`deployed:   ${deployment.deployedAt}`);
  console.log(`signer:     ${signer.address}`);

  const registry = await ethers.getContractAt(
    'RootRegistry',
    deployment.contracts.RootRegistry,
    signer,
  );
  const dispatcher = await ethers.getContractAt(
    'LandRegistryVerifier',
    deployment.contracts.LandRegistryVerifier,
    signer,
  );

  // ── 1. The contracts are actually there ────────────────────────────────────
  const code = await ethers.provider.getCode(deployment.contracts.RootRegistry);
  if (code === '0x') {
    throw new Error(
      `No contract code at ${deployment.contracts.RootRegistry}. ` +
        `If this is a local node, it was restarted since the deploy — redeploy.`,
    );
  }

  // ── 2. Registry state ──────────────────────────────────────────────────────
  const [latestRoot, rootVersion, lastUpdatedAt] = await Promise.all([
    registry.latestRoot(),
    registry.rootVersion(),
    registry.lastUpdatedAt(),
  ]);
  console.log(`\nRootRegistry         ${await registry.getAddress()}`);
  console.log(`  rootVersion:       ${rootVersion}`);
  console.log(`  latestRoot:        ${latestRoot}`);
  console.log(
    `  lastUpdatedAt:     ${
      lastUpdatedAt === 0n
        ? '(never published)'
        : fromUnixTimestamp(lastUpdatedAt, 'DD/MM/YYYY HH:mm')
    }`,
  );

  // ── 3. D30 identity anchor + role ──────────────────────────────────────────
  const authority = deployment.authority.address;
  const role = await registry.STATE_AUTHORITY_ROLE();
  const [hasRole, anchor] = await Promise.all([
    registry.hasRole(role, authority),
    registry.authorityInstitute(authority),
  ]);
  const expectedAnchor = ethers.keccak256(ethers.toUtf8Bytes(deployment.authority.orgName));
  console.log(`\nAuthority (D30)      ${authority}`);
  console.log(`  STATE_AUTHORITY:   ${hasRole ? 'yes' : 'NO — role missing!'}`);
  console.log(`  orgName:           "${deployment.authority.orgName}"`);
  console.log(
    `  authorityInstitute: ${anchor} ${anchor === expectedAnchor ? '(matches keccak256(orgName))' : '(MISMATCH!)'}`,
  );
  if (!hasRole || anchor !== expectedAnchor) {
    throw new Error('Authority is not correctly registered — re-run the deploy script.');
  }

  // ── 4. Dispatcher wiring ───────────────────────────────────────────────────
  const [regRef, ownershipRef, mortgageRef, transferRef, tolerance] = await Promise.all([
    dispatcher.registry(),
    dispatcher.ownershipVerifier(),
    dispatcher.mortgageVerifier(),
    dispatcher.transferVerifier(),
    dispatcher.TIMESTAMP_TOLERANCE_SECONDS(),
  ]);
  console.log(`\nLandRegistryVerifier ${await dispatcher.getAddress()}`);
  console.log(`  registry:          ${regRef}`);
  console.log(`  ownershipVerifier: ${ownershipRef}`);
  console.log(`  mortgageVerifier:  ${mortgageRef}`);
  console.log(`  transferVerifier:  ${transferRef}`);
  console.log(`  tolerance:         ${tolerance}s`);
  const wiringOk =
    regRef === deployment.contracts.RootRegistry &&
    ownershipRef === deployment.contracts.Groth16VerifierOwnership &&
    mortgageRef === deployment.contracts.Groth16VerifierMortgage &&
    transferRef === deployment.contracts.Groth16VerifierTransfer;
  if (!wiringOk) {
    throw new Error('Dispatcher is wired to addresses other than the recorded deployment.');
  }
  console.log('  wiring:            matches deployments record ✓');

  if (process.env.SMOKE_PUBLISH !== '1') {
    console.log(
      '\nRead-only checks passed. Set SMOKE_PUBLISH=1 for the full publish+prove+verify round trip.\n',
    );
    return;
  }

  // ── 5. Full round trip (state-changing) ────────────────────────────────────
  if (signer.address.toLowerCase() !== authority.toLowerCase()) {
    throw new Error(
      `SMOKE_PUBLISH needs the authority account. Signer is ${signer.address}, ` +
        `authority is ${authority}.`,
    );
  }

  console.log('\n── full round trip ─────────────────────────────────────────');
  // Timestamp the witness with CHAIN time so the on-chain freshness check
  // (D9/D26) lines up even if the node's clock drifts from the wall clock.
  const chainNow = BigInt((await ethers.provider.getBlock('latest'))!.timestamp);
  const { input, expectedPublicSignals } = await buildSampleInput('ownership', { now: chainNow });
  const rootIndex = (PUBLIC_SIGNAL_ORDER.ownership as readonly string[]).indexOf('merkleRoot');
  const newRoot = ethers.toBeHex(BigInt(expectedPublicSignals[rootIndex]), 32);

  console.log(`  publishing root ${newRoot} ...`);
  const publishTx = await registry.publishRoot(newRoot);
  const publishReceipt = await publishTx.wait();
  console.log(`  tx ${publishReceipt!.hash}  gas ${publishReceipt!.gasUsed}`);
  console.log(`  rootVersion is now ${await registry.rootVersion()}`);

  console.log('  generating ownership proof (snarkjs) ...');
  const { wasmPath, zkeyPath } = getCircuitPaths('ownership', BLOCKCHAIN_DIR);
  const startedAt = Date.now();
  const pkg = await generateGroth16Proof(input, wasmPath, zkeyPath, 'ownership');
  console.log(`  proof generated in ${Date.now() - startedAt} ms`);

  const { a, b, c } = toSolidityCalldata(pkg.proof);
  const verified = await dispatcher.verifyOwnership(a, b, c, pkg.publicSignals);
  const verifyGas = await dispatcher.verifyOwnership.estimateGas(a, b, c, pkg.publicSignals);
  console.log(`  on-chain verifyOwnership → ${verified}  (gas ${verifyGas})`);
  if (!verified) throw new Error('On-chain verification returned false.');

  console.log('\nFull round trip OK: root published, real proof verified on-chain.\n');
}

main()
  .then(() => {
    // snarkjs leaves worker threads running — exit explicitly or this hangs.
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
