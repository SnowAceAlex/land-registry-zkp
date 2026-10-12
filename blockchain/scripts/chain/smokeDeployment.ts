/**
 * scripts/chain/smokeDeployment.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Check a LIVE deployment (local node or Sepolia) end to end, reading the
 * addresses from deployments/<network>.json written by scripts/chain/deploy.ts.
 *
 * Two modes:
 *   default          read-only — prints registry state, the D30 identity anchor
 *                    and the role check, and confirms the dispatcher is wired to
 *                    the three verifiers. Sends no transaction, costs no gas.
 *   SMOKE_PUBLISH=1  full round trip — builds a real Merkle tree from mock
 *                    records, publishes its root (TRANSACTION, costs gas),
 *                    generates a real ownership proof, signs its status
 *                    attestation with ATTESTER_PRIVATE_KEY (D82) and verifies
 *                    both on-chain.
 *
 * Usage:
 *   pnpm --filter blockchain run chain:smoke:localhost                 # read-only
 *   SMOKE_PUBLISH=1 pnpm --filter blockchain run chain:smoke:localhost # round trip
 *   (PowerShell: $env:SMOKE_PUBLISH=1; pnpm --filter blockchain run chain:smoke:localhost)
 *
 * Add --network localhost / --network sepolia via the package scripts.
 *
 * ⚠️  Publishing changes on-chain state. On a deployment you intend to keep as
 *     "the" demo instance, run read-only first and only publish deliberately.
 */

import { ethers, network } from 'hardhat';

import { PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { fromUnixTimestamp } from '../../shared/datetime';
import { loadDeployment } from '../../shared/deployments';
import {
  attestationMessageFromSignals,
  statusAttestationTypedData,
} from '../../shared/statusAttestation';
import { generateGroth16Proof, getCircuitPaths, toSolidityCalldata } from '../../shared/zkpHelper';
import { BLOCKCHAIN_DIR } from '../lib/paths';
import { buildSampleInput } from '../circuits/sampleWitness';

async function main() {
  const deployment = loadDeployment(BLOCKCHAIN_DIR, network.name);
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

  // ── 3b. D82 attester ───────────────────────────────────────────────────────
  if (deployment.attester) {
    const isAttester = await registry.hasRole(await registry.ATTESTER_ROLE(), deployment.attester);
    console.log(`\nAttester (D82)       ${deployment.attester}`);
    console.log(`  ATTESTER_ROLE:     ${isAttester ? 'yes' : 'NO — role missing!'}`);
    if (!isAttester) throw new Error('Attester has no ATTESTER_ROLE — re-run the deploy script.');
  } else {
    console.log('\nAttester (D82)       (none recorded — deployment predates D82, redeploy)');
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

  // Plays the backend's GET /api/proof/:id/attestation (D82).
  const attesterKey = process.env.ATTESTER_PRIVATE_KEY?.trim();
  if (!attesterKey)
    throw new Error('SMOKE_PUBLISH needs ATTESTER_PRIVATE_KEY to sign the attestation.');
  const attester = new ethers.Wallet(attesterKey);
  const expiresAt = chainNow + 300n;
  const typed = statusAttestationTypedData(
    deployment.chainId,
    await dispatcher.getAddress(),
    attestationMessageFromSignals('ownership', pkg.publicSignals, expiresAt),
  );
  const signature = await attester.signTypedData(typed.domain, typed.types, typed.message);
  console.log(`  attestation signed by ${attester.address}`);

  const { a, b, c } = toSolidityCalldata(pkg.proof);
  const args = [a, b, c, pkg.publicSignals, expiresAt, signature] as const;
  const verified = await dispatcher.verifyOwnership(...args);
  const verifyGas = await dispatcher.verifyOwnership.estimateGas(...args);
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
