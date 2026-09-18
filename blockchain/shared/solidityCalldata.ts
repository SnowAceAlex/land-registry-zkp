/**
 * shared/solidityCalldata.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Format a Groth16 proof as the (a, b, c) arguments the generated Solidity
 * verifiers and `LandRegistryVerifier` expect.
 *
 * ⚠️  THE G2 POINT pi_b MUST HAVE EACH COORDINATE PAIR SWAPPED for the EVM
 *     pairing precompile: snarkjs emits [x.a, x.b] and Solidity expects
 *     [x.b, x.a]. This is the single place that swap lives — never hand-build
 *     these arrays elsewhere (same spirit as D25). The third projective
 *     coordinate of pi_a/pi_c and the third pair of pi_b are the constant
 *     (1, 0) affine markers, and are dropped.
 *
 * ⚠️  THIS FILE MUST STAY FREE OF RUNTIME IMPORTS (the `Groth16Proof` import is
 *     type-only and erased). It lives apart from `zkpHelper.ts` for the same
 *     reason `treeDimensions.ts` lives apart from `merkleTree.ts`: zkpHelper
 *     imports snarkjs at the top level, and `/resident/verify` needs this
 *     formatting to make an `eth_call` while doing its own proving nowhere —
 *     its snarkjs lives in a worker. Reaching for it through zkpHelper put
 *     ~3 MB into that page.
 *
 * `zkpHelper.ts` re-exports both names, so every existing importer is
 * unaffected.
 */

import type { Groth16Proof } from './types';

/** Groth16 proof shaped as the (a, b, c) arguments of the Solidity verifiers. */
export interface SolidityProofArgs {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
}

export function toSolidityCalldata(proof: Groth16Proof): SolidityProofArgs {
  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
  };
}
