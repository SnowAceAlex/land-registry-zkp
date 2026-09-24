/**
 * scripts/bench/proveBench.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * What one proof costs to make and to check, per circuit, at the current depth
 * (D71, Chapter 5).
 *
 * This is the CLIENT number. The thesis' central comparison is that generating
 * a proof costs seconds of CPU and that CPU belongs to the citizen, not to the
 * registry. The matching server number comes from `bench:proof-load`.
 *
 * ⚠️ Measured in Node, NOT in a browser. A browser is typically 1.5–2× slower
 * (wasm inside a Web Worker, no native thread pool), so everything here is a
 * LOWER BOUND and has to be reported as one. The real browser figure is taken
 * by hand once, on `/resident/proof`, and recorded in the runbook.
 *
 * Usage: ITERATIONS=10 pnpm --filter blockchain run bench:prove
 */
import {
  CircuitType,
  buildMortgageInput,
  buildOwnershipInput,
  buildTransferInput,
} from '../../shared/circuitInputs';
import { nowUnixTimestamp } from '../../shared/datetime';
import { buildTree, generateMerkleProof, poseidonHash } from '../../shared/merkleTree';
import { TREE_DEPTH } from '../../shared/treeDimensions';
import { EncumbranceStatus, ProofInput, TenureType } from '../../shared/types';
import { generateGroth16Proof, getCircuitPaths, verifyGroth16Proof } from '../../shared/zkpHelper';
import { BLOCKCHAIN_DIR } from '../lib/paths';
import { generateMockRecords } from '../tools/generateMockData';
import { percentiles, writeBenchReport } from './lib/stats';

const ITERATIONS = Number(process.env.ITERATIONS ?? 10);

async function witnesses(): Promise<Record<CircuitType, ProofInput>> {
  const { records, secrets } = await generateMockRecords(24);
  const tree = await buildTree(records);

  // mortgage.circom and transfer.circom both HARD-require an unencumbered title
  // with term left (D6/D27) — a mortgaged or expired plot makes the witness
  // unsatisfiable, not merely unprovable. The mock generator randomises both,
  // so the plot has to be chosen rather than taken by index.
  const record = records.find(
    (r) =>
      r.encumbranceStatus === EncumbranceStatus.FREE &&
      (r.tenureType === TenureType.PERPETUAL || r.validityPeriod > BigInt(nowUnixTimestamp())),
  );
  if (!record) throw new Error('no unencumbered, unexpired mock plot to measure with');
  const ownerSecret = secrets.get(record.propertyId)!;
  const proof = await generateMerkleProof(tree, record);
  const currentTimestamp = BigInt(nowUnixTimestamp());

  // transfer.circom binds BOTH roots, so the new path has to come from a tree
  // that actually has the new owner in it — the old tree cannot answer for it.
  const newOwnerSecret = 987_654_321n;
  const newRecord = { ...record, ownerCommitment: await poseidonHash([newOwnerSecret]) };
  const nextTree = await buildTree(
    records.map((r) => (r.propertyId === record.propertyId ? newRecord : r)),
  );
  const newProof = await generateMerkleProof(nextTree, newRecord);

  return {
    ownership: buildOwnershipInput({ record, ownerSecret, proof, currentTimestamp }),
    mortgage: buildMortgageInput({
      record,
      ownerSecret,
      proof,
      currentTimestamp,
      minRequiredRemainingTerm: 0n,
    }),
    transfer: buildTransferInput({
      oldRecord: record,
      newRecord,
      oldOwnerSecret: ownerSecret,
      newOwnerSecret,
      oldProof: proof,
      newProof,
      currentTimestamp,
      minRequiredRemainingTerm: 0n,
    }),
  };
}

async function main(): Promise<void> {
  const inputs = await witnesses();
  const circuits: CircuitType[] = ['ownership', 'mortgage', 'transfer'];
  const results: Record<string, unknown> = {};

  console.log(`  depth ${TREE_DEPTH}, ${ITERATIONS} iteration(s) per circuit (Node, not browser)`);

  for (const circuitType of circuits) {
    const { wasmPath, zkeyPath, vkeyPath } = getCircuitPaths(circuitType, BLOCKCHAIN_DIR);
    const proveMs: number[] = [];
    const verifyMs: number[] = [];
    let proofBytes = 0;
    let publicSignalCount = 0;

    for (let i = 0; i < ITERATIONS; i++) {
      const proveStart = Date.now();
      const pkg = await generateGroth16Proof(inputs[circuitType], wasmPath, zkeyPath, circuitType);
      proveMs.push(Date.now() - proveStart);

      const verifyStart = Date.now();
      const ok = await verifyGroth16Proof(vkeyPath, pkg.publicSignals, pkg.proof);
      verifyMs.push(Date.now() - verifyStart);
      if (!ok) throw new Error(`${circuitType}: a freshly generated proof failed to verify`);

      proofBytes = Buffer.byteLength(JSON.stringify(pkg.proof));
      publicSignalCount = pkg.publicSignals.length;
    }

    const prove = percentiles(proveMs);
    const verify = percentiles(verifyMs);
    results[circuitType] = { proveMs: prove, verifyMs: verify, proofBytes, publicSignalCount };

    console.log(
      `  ${circuitType.padEnd(10)} prove p50 ${prove.p50}ms (p95 ${prove.p95}) · ` +
        `verify p50 ${verify.p50}ms · proof ${proofBytes} B · ${publicSignalCount} public signals`,
    );
  }

  const file = writeBenchReport('prove', {
    kind: 'prove',
    treeDepth: TREE_DEPTH,
    iterations: ITERATIONS,
    note: 'Node, not browser — a lower bound; a browser is typically 1.5-2x slower',
    circuits: results,
  });
  console.log('');
  console.log(`  report: ${file}`);
}

// snarkjs leaves worker threads running — exit explicitly or this never ends.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
