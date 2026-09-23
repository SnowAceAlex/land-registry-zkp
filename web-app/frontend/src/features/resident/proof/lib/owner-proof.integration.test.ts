/**
 * UC-5's whole cryptographic path, against the real trusted-setup artifacts:
 * the owner's bundle → checkBundleIntegrity → buildOwnerProofInput → Groth16
 * prove → verify, for BOTH circuits the resident portal offers.
 *
 * The unit tests pin the wiring; only an actual proof shows that the witness
 * this feature assembles satisfies ownership.circom and mortgage.circom. A
 * swapped Merkle path, or a commitment computed from the wrong secret, passes
 * every other test and fails only here — or, without this test, on a land
 * owner's machine.
 *
 * It also covers the new D59 entry point with a real proof rather than a type:
 * `verifyGroth16Proof` (Node, reads the vkey from disk) and
 * `verifyGroth16ProofWithKey` (what the browser worker calls, with a vkey it
 * fetched) must agree.
 *
 * Proving runs through shared/zkpHelper in Node with file paths; the browser
 * worker calls the same function with URLs. Self-skips on a checkout without
 * `circuits:setup` artifacts, like the blockchain integration tests.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  type CircuitType,
  PUBLIC_SIGNAL_ORDER,
  generateGroth16Proof,
  getCircuitPaths,
  isTimestampFresh,
  nowUnixTimestamp,
  publicSignalIndex,
  verifyGroth16Proof,
  verifyGroth16ProofWithKey,
} from '@land-registry/blockchain/shared';
import { describe, expect, it } from 'vitest';

import { OWNER_SECRET, sampleBundle } from './__fixtures__/bundle';
import { checkBundleIntegrity } from './bundle-integrity';
import { type OwnerProofType, buildOwnerProofInput } from './owner-witness';

const BLOCKCHAIN_DIR = path.resolve(import.meta.dirname, '../../../../../../../blockchain');

const artifactsPresent = (['ownership', 'mortgage'] as const).every((circuit) => {
  const { wasmPath, zkeyPath, vkeyPath } = getCircuitPaths(circuit, BLOCKCHAIN_DIR);
  return [wasmPath, zkeyPath, vkeyPath].every((p) => fs.existsSync(p));
});

/** Prove, then verify through BOTH entry points, and return the package. */
async function proveAndVerify(type: OwnerProofType, minRemainingTermYears?: number) {
  const { bundle, refreshed } = await sampleBundle();

  const integrity = await checkBundleIntegrity(bundle);
  expect(integrity.issues).toEqual([]);

  const input = buildOwnerProofInput(type, {
    record: integrity.record,
    ownerSecret: OWNER_SECRET,
    refreshed,
    currentTimestamp: nowUnixTimestamp(),
    minRemainingTermYears,
  });

  const { wasmPath, zkeyPath, vkeyPath } = getCircuitPaths(type, BLOCKCHAIN_DIR);
  const pkg = await generateGroth16Proof(input, wasmPath, zkeyPath, type);

  expect(await verifyGroth16Proof(vkeyPath, pkg.publicSignals, pkg.proof)).toBe(true);

  // D59: the browser fetches and parses the vkey itself, then calls this.
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
  expect(await verifyGroth16ProofWithKey(vkey, pkg.publicSignals, pkg.proof)).toBe(true);

  return { pkg, refreshed };
}

/** The signal names a circuit discloses — the verifier's whole view (D21). */
const disclosed = (circuitType: CircuitType) => [...PUBLIC_SIGNAL_ORDER[circuitType]];

describe.skipIf(!artifactsPresent)('owner proofs (integration, real zkey)', () => {
  it('proves ownership the verification key accepts', { timeout: 180_000 }, async () => {
    const { pkg, refreshed } = await proveAndVerify('ownership');

    expect(pkg.circuitType).toBe('ownership');
    expect(pkg.publicSignals).toHaveLength(disclosed('ownership').length);

    // The root it proves against is the refreshed one, not the receipt's.
    const rootIndex = publicSignalIndex('ownership', 'merkleRoot');
    expect(pkg.publicSignals[rootIndex]).toBe(refreshed.merkleRoot);
  });

  it('proves mortgage at a threshold the owner chose', { timeout: 180_000 }, async () => {
    const { pkg } = await proveAndVerify('mortgage', 5);

    expect(pkg.circuitType).toBe('mortgage');

    // D16: the threshold is the owner's own number, and it IS disclosed —
    // that is the claim being made, so the bank must be able to read it.
    const index = publicSignalIndex('mortgage', 'minRequiredRemainingTerm');
    expect(pkg.publicSignals[index]).toBe((5n * 365n * 24n * 3600n).toString());
  });

  /**
   * The selective-disclosure claim, made executable — the browser twin of the
   * assertion `ownerSmoke.ts` makes. A mortgage proof establishes "clean title
   * and at least N years left" while revealing NEITHER the encumbrance status
   * nor the actual expiry date, which are precisely what mortgage.circom
   * exists to hide.
   */
  it('never discloses validityPeriod or encumbranceStatus', { timeout: 180_000 }, async () => {
    for (const circuit of ['ownership', 'mortgage'] as const) {
      expect(disclosed(circuit)).not.toContain('validityPeriod');
      expect(disclosed(circuit)).not.toContain('encumbranceStatus');
      expect(disclosed(circuit)).not.toContain('ownerSecret');
    }

    const { pkg } = await proveAndVerify('mortgage', 5);
    const { bundle } = await sampleBundle();

    // And the actual values are absent from the wire form, not merely unnamed.
    const wire = JSON.stringify(pkg.publicSignals);
    expect(wire).not.toContain(bundle.receipt.record.validityPeriod);
    expect(wire).not.toContain(OWNER_SECRET.toString());
  });

  /**
   * D26, executable. A proof dated back an hour is still cryptographically
   * perfect — `currentTimestamp` is a public input the PROVER chooses — so
   * freshness is a separate rule, and it is the only thing that catches a
   * replay. This is why UC-6 checks freshness FIRST (D63).
   */
  it('stays cryptographically valid when back-dated, which freshness catches', { timeout: 180_000 }, async () => {
    const { bundle, refreshed } = await sampleBundle();
    const integrity = await checkBundleIntegrity(bundle);
    const backdated = nowUnixTimestamp() - 3600n;

    const input = buildOwnerProofInput('ownership', {
      record: integrity.record,
      ownerSecret: OWNER_SECRET,
      refreshed,
      currentTimestamp: backdated,
    });

    const { wasmPath, zkeyPath, vkeyPath } = getCircuitPaths('ownership', BLOCKCHAIN_DIR);
    const pkg = await generateGroth16Proof(input, wasmPath, zkeyPath, 'ownership');

    expect(await verifyGroth16Proof(vkeyPath, pkg.publicSignals, pkg.proof)).toBe(true);
    expect(isTimestampFresh(backdated)).toBe(false);
  });

  it('fails to prove from a Merkle path that is not the plot’s', { timeout: 180_000 }, async () => {
    const { bundle, refreshed } = await sampleBundle();
    const integrity = await checkBundleIntegrity(bundle);

    const input = buildOwnerProofInput('ownership', {
      record: integrity.record,
      ownerSecret: OWNER_SECRET,
      refreshed: {
        ...refreshed,
        siblings: refreshed.siblings.map((s) => (BigInt(s) + 1n).toString()),
      },
      currentTimestamp: nowUnixTimestamp(),
    });

    const { wasmPath, zkeyPath } = getCircuitPaths('ownership', BLOCKCHAIN_DIR);
    await expect(generateGroth16Proof(input, wasmPath, zkeyPath, 'ownership')).rejects.toThrow();
  });
});
