/**
 * shared/zkpHelper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Wrapper around snarkjs for Groth16 proof generation and verification.
 *
 * ⚠️  IMPORTANT DESIGN RULE:
 *   This file is the single entry point for Groth16 proof GENERATION and
 *   VERIFICATION (snarkjs.groth16.fullProve / groth16.verify). Backend
 *   (proof.service.ts), the trusted-setup scripts, and tests prove/verify only
 *   through here — never call groth16.fullProve/verify directly elsewhere. The
 *   browser prover (frontend lib/zkp.ts) is the one documented exception: it
 *   calls snarkjs directly with fetched WASM/zkey URLs, and reuses only the
 *   browser-safe primitives (assertTimestampFresh + PUBLIC_SIGNAL_ORDER) — see
 *   the lazy `fs` note below.
 *
 *   The one-time trusted-setup APIs (snarkjs.r1cs.* / snarkjs.zKey.*) are a
 *   different concern — key generation, not proving — and are called directly
 *   in scripts/setup/trustedSetup.ts; they are intentionally NOT routed here.
 *
 * Groth16 workflow:
 *   1. Compile circuit: circom ownership.circom --r1cs --wasm --sym
 *   2. Trusted setup:   snarkjs groth16 setup ownership.r1cs pot*.ptau ownership.zkey
 *   3. Export vkey:     snarkjs zkey export verificationkey ownership.zkey vkey.json
 *   4. Generate proof:  snarkjs.groth16.fullProve(input, wasmPath, zkeyPath) → { proof, publicSignals }
 *   5. Verify proof:    snarkjs.groth16.verify(vkey, publicSignals, proof) → boolean
 *   6. Export Solidity: snarkjs zkey export solidityverifier ownership.zkey Verifier.sol
 *
 * File paths convention (relative to blockchain/ package root):
 *   - WASM:  circuits/build/<circuit>/<circuit>_js/<circuit>.wasm
 *   - zkey:  circuits/build/<circuit>/<circuit>.zkey
 *   - vkey:  circuits/build/<circuit>/verification_key.json
 *
 * ⚠️  Browser-safety of the shared barrel: `snarkjs` and `path` are
 *     browser-compatible, so they are imported normally. Node's `fs` is NOT, and
 *     `shared/index.ts` re-exports this module, so a value-import of the barrel
 *     from the Next.js frontend (Phase 8) would pull `fs` into the browser
 *     bundle. `verifyGroth16Proof` therefore loads `fs` lazily, keeping the
 *     module graph free of a static `fs` import.
 */

import * as path from 'path';
import * as snarkjs from 'snarkjs';

import { PUBLIC_SIGNAL_ORDER } from './circuitInputs';
import {
  PROOF_TIMESTAMP_TOLERANCE_SECONDS,
  assertTimestampFresh,
  nowUnixTimestamp,
} from './datetime';
import { Groth16Proof, ProofInput, ProofPackage, PublicSignals } from './types';

type CircuitType = ProofPackage['circuitType'];

// ─────────────────────────────────────────────────────────────────────────────
// Proof Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a Groth16 proof for a given circuit.
 *
 * @param input       The circuit witness inputs (all private + public signals),
 *                    built via shared/circuitInputs.ts (D25) — never hand-written.
 * @param wasmPath    Path (Node) or URL (browser) to the compiled circuit WASM.
 * @param zkeyPath    Path (Node) or URL (browser) to the proving key (.zkey).
 * @param circuitType Which circuit this is — carried through into the result.
 * @returns           A ProofPackage: the Groth16 proof + public signals + type.
 */
export async function generateGroth16Proof(
  input: ProofInput,
  wasmPath: string,
  zkeyPath: string,
  circuitType: CircuitType,
): Promise<ProofPackage> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  return {
    proof: proof as Groth16Proof,
    publicSignals: publicSignals as PublicSignals,
    circuitType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Verification (off-chain)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify a Groth16 proof off-chain using the verification key.
 *
 * This is a THIN cryptographic check — it proves the witness satisfied the
 * circuit, nothing more. It deliberately does NOT check timestamp freshness:
 * every off-chain verify *path* must additionally call {@link assertProofFresh}
 * (D26), because `currentTimestamp` is a prover-chosen public input and a stale
 * proof verifies perfectly. On-chain verification uses the generated Solidity
 * verifier plus a block.timestamp check in LandRegistryVerifier (Phase 4).
 *
 * @param vkeyPath      Path to the verification_key.json file.
 * @param publicSignals The public signals from the prover.
 * @param proof         The Groth16 proof object.
 * @returns             true if the proof is cryptographically valid.
 */
export async function verifyGroth16Proof(
  vkeyPath: string,
  publicSignals: PublicSignals,
  proof: Groth16Proof,
): Promise<boolean> {
  // Lazy import keeps `fs` out of the static module graph so the shared barrel
  // stays browser-safe (see the file-header note).
  const { readFileSync } = await import('node:fs');
  const vkey = JSON.parse(readFileSync(vkeyPath, 'utf8'));
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

/**
 * Assert a proof's `currentTimestamp` public signal is within tolerance of now
 * (D26). Companion to {@link verifyGroth16Proof} — call BOTH at every off-chain
 * verify entry point (Phase 6 backend, Phase 9 verifier portal).
 *
 * The index of `currentTimestamp` differs per circuit (3 for ownership/mortgage,
 * 5 for transfer); it is looked up from PUBLIC_SIGNAL_ORDER so this never drifts
 * from the circuits (D21/D25).
 *
 * @throws if the timestamp is stale — see {@link assertTimestampFresh}.
 */
export function assertProofFresh(
  circuitType: CircuitType,
  publicSignals: PublicSignals,
  now: bigint = nowUnixTimestamp(),
  toleranceSeconds: bigint = PROOF_TIMESTAMP_TOLERANCE_SECONDS,
): void {
  const order = PUBLIC_SIGNAL_ORDER[circuitType] as readonly string[];
  const index = order.indexOf('currentTimestamp');
  if (index === -1) {
    throw new Error(`assertProofFresh: circuit '${circuitType}' has no currentTimestamp signal`);
  }
  const claimed = publicSignals[index];
  if (claimed === undefined) {
    throw new Error(
      `assertProofFresh: publicSignals is missing index ${index} (currentTimestamp) ` +
        `for circuit '${circuitType}'`,
    );
  }
  assertTimestampFresh(BigInt(claimed), now, toleranceSeconds);
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Paths Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the build-artifact paths for a circuit, matching the layout produced
 * by scripts/compileCircuits.ts + scripts/setup/*.ts:
 *   circuits/build/<circuitName>/<circuitName>_js/<circuitName>.wasm
 *   circuits/build/<circuitName>/<circuitName>.zkey
 *   circuits/build/<circuitName>/verification_key.json
 *
 * @param circuitName  'ownership' | 'mortgage' | 'transfer'.
 * @param baseDir      Root of the blockchain package (e.g. path.resolve(__dirname, '..')).
 * @returns            { wasmPath, zkeyPath, vkeyPath }.
 */
export function getCircuitPaths(
  circuitName: CircuitType,
  baseDir: string,
): { wasmPath: string; zkeyPath: string; vkeyPath: string } {
  const buildDir = path.join(baseDir, 'circuits', 'build', circuitName);
  return {
    wasmPath: path.join(buildDir, `${circuitName}_js`, `${circuitName}.wasm`),
    zkeyPath: path.join(buildDir, `${circuitName}.zkey`),
    vkeyPath: path.join(buildDir, 'verification_key.json'),
  };
}
