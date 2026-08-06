/**
 * scripts/circuits/smokeOwnership.ts   (pnpm --filter blockchain run circuits:smoke)
 * ─────────────────────────────────────────────────────────────────────────────
 * Fast single-circuit toolchain smoke test (ownership only).
 *
 * Why this exists: THESIS_IMPLEMENTATION_GUIDE risk #6 is "circomlib/Poseidon
 * version mismatch, discovered late". Proving circom → r1cs → zkey → proof →
 * verify works for one circuit keeps Phase 3 a matter of repetition, not of
 * debugging the toolchain. Phase 3's setupAll.ts does all three properly and
 * records the metrics; this stays as a quick regression guard.
 *
 * It shares the setup code path (trustedSetup.ts) and the prove/verify path
 * (shared/zkpHelper.ts) with setupAll.ts, so the two cannot drift — and, like
 * every other verify caller, it goes through zkpHelper rather than snarkjs
 * directly (the single-entry-point rule).
 */

import { PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { generateGroth16Proof, getCircuitPaths, verifyGroth16Proof } from '../../shared/zkpHelper';
import { BLOCKCHAIN_DIR, setupCircuit } from './trustedSetup';
import { buildSampleInput } from './sampleWitness';

const CIRCUIT = 'ownership' as const;

function step(message: string): void {
  console.log(`\n▶ ${message}`);
}

async function main(): Promise<void> {
  console.log(`\nSmoke test — ${CIRCUIT}`);

  step('Trusted setup (local Phase-2 contribution, public Hermez ptau — D13)');
  const { info, power } = await setupCircuit(CIRCUIT);

  step('Proving from real mock data (through zkpHelper)');
  const { wasmPath, zkeyPath, vkeyPath } = getCircuitPaths(CIRCUIT, BLOCKCHAIN_DIR);
  const { input, expectedPublicSignals } = await buildSampleInput(CIRCUIT);

  const startedAt = Date.now();
  const pkg = await generateGroth16Proof(input, wasmPath, zkeyPath, CIRCUIT);
  const proveMs = Date.now() - startedAt;

  step('Verifying');
  const verifyStartedAt = Date.now();
  const verified = await verifyGroth16Proof(vkeyPath, pkg.publicSignals, pkg.proof);
  const verifyMs = Date.now() - verifyStartedAt;
  if (!verified) {
    throw new Error('groth16.verify returned false — the pipeline is broken');
  }

  // The public signals must line up with what the circuit tests asserted and
  // what LandRegistryVerifier.sol will index in Phase 4 (D21).
  PUBLIC_SIGNAL_ORDER.ownership.forEach((name, i) => {
    if (pkg.publicSignals[i] !== expectedPublicSignals[i]) {
      throw new Error(
        `publicSignals[${i}] should be ${name}=${expectedPublicSignals[i]} ` +
          `but was ${pkg.publicSignals[i]}`,
      );
    }
  });

  const proofBytes = Buffer.byteLength(JSON.stringify(pkg.proof), 'utf8');
  console.log('\n─────────────────────────────────────────────');
  console.log(`  circuit            ${CIRCUIT}`);
  console.log(`  constraints        ${info.nConstraints}`);
  console.log(`  powers of tau      2^${power}`);
  console.log(`  proof time         ${proveMs} ms`);
  console.log(`  verify time        ${verifyMs} ms`);
  console.log(`  proof size         ${proofBytes} bytes`);
  console.log(
    `  public signals     ${pkg.publicSignals.length} (${PUBLIC_SIGNAL_ORDER.ownership.join(', ')})`,
  );
  console.log(`  verified           ${verified}`);
  console.log('─────────────────────────────────────────────');
  console.log('\nPipeline circom -> zkpHelper(snarkjs) -> verify is working end to end.');
  console.log('These are smoke numbers (one circuit); circuits:setup records the full table.\n');
}

main()
  .then(() => {
    // snarkjs leaves its worker threads running, so the process never exits on
    // its own. Everything above already completed and asserted.
    process.exit(0);
  })
  .catch((error) => {
    console.error(`\n✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
