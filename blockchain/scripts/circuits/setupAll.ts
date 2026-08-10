/**
 * scripts/circuits/setupAll.ts   (pnpm --filter blockchain run circuits:setup)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 3 — Trusted Setup for all three circuits.
 *
 * For each circuit: run the circuit-specific Phase-2 setup (trustedSetup.ts),
 * then prove + verify end-to-end THROUGH shared/zkpHelper.ts (the single snarkjs
 * entry point), assert the publicSignals land in the D21 order, apply the D26
 * freshness guard, and record metrics for Chapter 5.
 *
 * Outputs into circuits/build/<name>/ (gitignored, reproducible):
 *   <name>.zkey, verification_key.json, Groth16Verifier<Name>.sol
 * plus circuits/build/setup-metrics.json (the measured table).
 *
 * Run circuits:compile first — this consumes its r1cs + wasm output.
 */

import * as fs from 'fs';
import * as path from 'path';

import { PUBLIC_SIGNAL_ORDER } from '../../shared/circuitInputs';
import { ProofPackage } from '../../shared/types';
import {
  assertProofFresh,
  generateGroth16Proof,
  getCircuitPaths,
  verifyGroth16Proof,
} from '../../shared/zkpHelper';
import { BLOCKCHAIN_DIR, setupCircuit } from './trustedSetup';
import { buildSampleInput } from './sampleWitness';
import { syncVerifier } from './syncVerifiers';

type CircuitType = ProofPackage['circuitType'];
const CIRCUITS: CircuitType[] = ['ownership', 'mortgage', 'transfer'];

interface Metric {
  circuit: CircuitType;
  constraints: number;
  ptauPower: number;
  proveMs: number;
  verifyMs: number;
  proofBytes: number;
  publicSignals: number;
}

async function runCircuit(circuit: CircuitType): Promise<Metric> {
  console.log(`\n▶ ${circuit}`);
  const { info, power } = await setupCircuit(circuit);
  // Phase 4: mirror the fresh verifier into contracts/verifiers/ (renamed,
  // gitignored) so the on-chain contracts can never drift from this zkey.
  const syncedPath = path.relative(BLOCKCHAIN_DIR, syncVerifier(circuit));
  console.log(`  verifier → ${syncedPath}`);
  const { wasmPath, zkeyPath, vkeyPath } = getCircuitPaths(circuit, BLOCKCHAIN_DIR);

  const { input, expectedPublicSignals } = await buildSampleInput(circuit);

  const startedAt = Date.now();
  const pkg = await generateGroth16Proof(input, wasmPath, zkeyPath, circuit);
  const proveMs = Date.now() - startedAt;

  const verifyStartedAt = Date.now();
  const verified = await verifyGroth16Proof(vkeyPath, pkg.publicSignals, pkg.proof);
  const verifyMs = Date.now() - verifyStartedAt;
  if (!verified) {
    throw new Error(`${circuit}: groth16.verify returned false — the setup is broken`);
  }

  // D21: publicSignals must line up positionally with PUBLIC_SIGNAL_ORDER, which
  // is what LandRegistryVerifier.sol indexes into in Phase 4.
  const order = PUBLIC_SIGNAL_ORDER[circuit];
  if (pkg.publicSignals.length !== order.length) {
    throw new Error(
      `${circuit}: expected ${order.length} public signals, got ${pkg.publicSignals.length}`,
    );
  }
  order.forEach((name, i) => {
    if (pkg.publicSignals[i] !== expectedPublicSignals[i]) {
      throw new Error(
        `${circuit}: publicSignals[${i}] should be ${name}=${expectedPublicSignals[i]} ` +
          `but was ${pkg.publicSignals[i]}`,
      );
    }
  });

  // D26: the freshness guard callers must apply (Phase 6/9) has to accept a
  // just-generated proof.
  assertProofFresh(circuit, pkg.publicSignals);

  const proofBytes = Buffer.byteLength(JSON.stringify(pkg.proof), 'utf8');
  console.log(`  proof ${proveMs} ms · verify ${verifyMs} ms · ${proofBytes} B · verified ✓`);

  return {
    circuit,
    constraints: info.nConstraints,
    ptauPower: power,
    proveMs,
    verifyMs,
    proofBytes,
    publicSignals: pkg.publicSignals.length,
  };
}

async function main(): Promise<void> {
  console.log('\nPhase 3 — Trusted Setup (all circuits)');
  console.log('Powers of Tau: public Hermez/iden3 ceremony (D13); local Phase-2 only.\n');

  const metrics: Metric[] = [];
  for (const circuit of CIRCUITS) {
    metrics.push(await runCircuit(circuit));
  }

  const pad = (value: string | number, width: number) => String(value).padStart(width);
  console.log('\n  circuit    constraints   ptau   proof(ms)   verify(ms)   proof(B)   public');
  console.log('  ──────────────────────────────────────────────────────────────────────────');
  for (const m of metrics) {
    console.log(
      `  ${m.circuit.padEnd(9)}${pad(m.constraints, 12)}${pad(`2^${m.ptauPower}`, 7)}` +
        `${pad(m.proveMs, 12)}${pad(m.verifyMs, 13)}${pad(m.proofBytes, 11)}${pad(m.publicSignals, 9)}`,
    );
  }

  const metricsPath = path.join(BLOCKCHAIN_DIR, 'circuits', 'build', 'setup-metrics.json');
  fs.writeFileSync(
    metricsPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), metrics }, null, 2),
  );
  console.log(`\n  metrics → ${path.relative(BLOCKCHAIN_DIR, metricsPath)}`);
  console.log('\nAll three circuits: setup + prove + verify OK end to end.');
  console.log('These are the Phase 3 numbers; Phase 10 records the final Chapter 5 table.\n');
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
