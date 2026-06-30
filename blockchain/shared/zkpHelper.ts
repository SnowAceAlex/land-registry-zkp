/**
 * shared/zkpHelper.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Wrapper around snarkjs for Groth16 proof generation and verification.
 *
 * ⚠️  IMPORTANT DESIGN RULE:
 *   This file is the single entry point for all snarkjs operations in the project.
 *   Frontend (lib/zkp.ts) and backend (proof.service.ts) import from here — never
 *   call snarkjs directly outside this file.
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
 */

import { Groth16Proof, ProofInput, ProofPackage, PublicSignals } from './types';

// TODO: import snarkjs
// import * as snarkjs from 'snarkjs';

// ─────────────────────────────────────────────────────────────────────────────
// Proof Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Generate a Groth16 proof for a given circuit.
 *
 * @param input      The circuit witness inputs (all private + public signals)
 * @param wasmPath   Absolute path to the compiled circuit WASM file
 * @param zkeyPath   Absolute path to the proving key (.zkey)
 * @returns          A ProofPackage containing the Groth16 proof + public signals
 *
 * Example implementation:
 *   const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
 *   return { proof, publicSignals, circuitType };
 */
export async function generateGroth16Proof(
  _input: ProofInput,
  _wasmPath: string,
  _zkeyPath: string,
  _circuitType: ProofPackage['circuitType'],
): Promise<ProofPackage> {
  // TODO: implement
  throw new Error('generateGroth16Proof not implemented yet');
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Verification (off-chain)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Verify a Groth16 proof off-chain using the verification key.
 *
 * This is the off-chain / backend verification step.
 * On-chain verification uses the Solidity Verifier contract in contracts/verifiers/.
 *
 * @param vkeyPath      Path to the verification_key.json file
 * @param publicSignals The public signals from the prover
 * @param proof         The Groth16 proof object
 * @returns             true if the proof is valid
 *
 * Example implementation:
 *   const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
 *   return await snarkjs.groth16.verify(vkey, publicSignals, proof);
 */
export async function verifyGroth16Proof(
  _vkeyPath: string,
  _publicSignals: PublicSignals,
  _proof: Groth16Proof,
): Promise<boolean> {
  // TODO: implement
  throw new Error('verifyGroth16Proof not implemented yet');
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Paths Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Helper to resolve circuit build artifact paths.
 *
 * After compiling circuits, artifacts are placed at:
 *   blockchain/circuits/build/<circuitName>/<circuitName>_js/<circuitName>.wasm
 *   blockchain/circuits/build/<circuitName>/<circuitName>.zkey
 *   blockchain/circuits/build/<circuitName>/verification_key.json
 *
 * @param circuitName  Name of the circuit (e.g., 'ownership', 'mortgage', 'transfer')
 * @param baseDir      Root directory of the blockchain package (use __dirname or pass explicitly)
 * @returns            Object with { wasmPath, zkeyPath, vkeyPath }
 */
export function getCircuitPaths(
  _circuitName: string,
  _baseDir: string,
): { wasmPath: string; zkeyPath: string; vkeyPath: string } {
  // TODO: implement using path.join
  throw new Error('getCircuitPaths not implemented yet');
}
