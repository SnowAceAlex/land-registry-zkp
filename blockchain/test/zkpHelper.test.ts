/**
 * test/zkpHelper.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests for shared/zkpHelper.ts (Phase 3).
 *
 *  - Unit (cheap, no artifacts): getCircuitPaths layout + assertProofFresh (D26).
 *  - Integration (guarded): full generate → verify through the wrapper, per
 *    circuit, ONLY when trusted-setup artifacts exist. They are produced by
 *    `pnpm --filter blockchain run circuits:setup` and are gitignored, so the
 *    integration block self-skips on a clean checkout rather than failing.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

import { PUBLIC_SIGNAL_ORDER } from '../shared/circuitInputs';
import { nowUnixTimestamp } from '../shared/datetime';
import { ProofPackage } from '../shared/types';
import {
  assertProofFresh,
  generateGroth16Proof,
  getCircuitPaths,
  verifyGroth16Proof,
} from '../shared/zkpHelper';
import { buildSampleInput } from '../scripts/setup/sampleWitness';

const BLOCKCHAIN_DIR = path.resolve(__dirname, '..');
type CircuitType = ProofPackage['circuitType'];
const CIRCUITS: CircuitType[] = ['ownership', 'mortgage', 'transfer'];

describe('shared/zkpHelper (Phase 3)', () => {
  describe('getCircuitPaths', () => {
    it('resolves the circuits/build/<name>/ artifact layout', () => {
      const { wasmPath, zkeyPath, vkeyPath } = getCircuitPaths('ownership', '/base');
      expect(wasmPath).to.equal(
        path.join('/base', 'circuits', 'build', 'ownership', 'ownership_js', 'ownership.wasm'),
      );
      expect(zkeyPath).to.equal(
        path.join('/base', 'circuits', 'build', 'ownership', 'ownership.zkey'),
      );
      expect(vkeyPath).to.equal(
        path.join('/base', 'circuits', 'build', 'ownership', 'verification_key.json'),
      );
    });
  });

  describe('assertProofFresh (D26)', () => {
    /** Public signals filled with 0 except currentTimestamp at its per-circuit index. */
    function signalsWithTimestamp(circuit: CircuitType, ts: bigint): string[] {
      const order = PUBLIC_SIGNAL_ORDER[circuit] as readonly string[];
      return order.map((name) => (name === 'currentTimestamp' ? ts.toString() : '0'));
    }

    for (const circuit of CIRCUITS) {
      it(`accepts a fresh timestamp (${circuit})`, () => {
        const now = nowUnixTimestamp();
        expect(() =>
          assertProofFresh(circuit, signalsWithTimestamp(circuit, now), now),
        ).to.not.throw();
      });

      it(`rejects a stale timestamp (${circuit})`, () => {
        const now = nowUnixTimestamp();
        expect(() =>
          assertProofFresh(circuit, signalsWithTimestamp(circuit, now - 3600n), now),
        ).to.throw(/stale/);
      });
    }
  });

  describe('generate + verify (integration — needs `circuits:setup` artifacts)', () => {
    for (const circuit of CIRCUITS) {
      it(`proves and verifies ${circuit}`, async function () {
        const { wasmPath, zkeyPath, vkeyPath } = getCircuitPaths(circuit, BLOCKCHAIN_DIR);
        if (![wasmPath, zkeyPath, vkeyPath].every((p) => fs.existsSync(p))) {
          this.skip();
        }

        const { input, expectedPublicSignals } = await buildSampleInput(circuit);
        const pkg = await generateGroth16Proof(input, wasmPath, zkeyPath, circuit);

        // D21 public-signal order, verified against the vkey.
        expect(pkg.publicSignals).to.deep.equal(expectedPublicSignals);
        expect(await verifyGroth16Proof(vkeyPath, pkg.publicSignals, pkg.proof)).to.equal(true);
        expect(() => assertProofFresh(circuit, pkg.publicSignals)).to.not.throw();

        // Tampering with a public signal must break cryptographic verification.
        const tampered = [...pkg.publicSignals];
        tampered[1] = (BigInt(tampered[1]) + 1n).toString();
        expect(await verifyGroth16Proof(vkeyPath, tampered, pkg.proof)).to.equal(false);
      });
    }
  });
});
