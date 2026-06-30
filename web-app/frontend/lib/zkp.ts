/**
 * lib/zkp.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side ZKP proof generation using snarkjs (runs in the browser).
 *
 * ⚠️  PRIVACY NOTE:
 *   Proof generation MUST happen client-side (in the browser) so that the
 *   owner's private witness (ownerSecret, full record) never leaves their device.
 *   The backend only receives the proof + public signals, not the private inputs.
 *
 * TODO:
 *  1. Import snarkjs (already added to package.json):
 *     import * as snarkjs from 'snarkjs';
 *
 *  2. Import shared types from @land-registry/blockchain/shared:
 *     import { ProofInput, ProofPackage, MerkleProofData } from '@land-registry/blockchain/shared';
 *     NOTE: Do NOT import merkleTree or zkpHelper directly — only types.
 *           The actual proof generation uses snarkjs directly here (browser context).
 *
 *  3. Implement generateOwnershipProof(input):
 *     - input includes: ownerSecret (bigint), full LURRecord, MerkleProofData from backend
 *     - Fetch WASM and zkey from /public/circuits/ (serve build artifacts statically)
 *     - Call snarkjs.groth16.fullProve(input, wasmUrl, zkeyUrl)
 *     - Return { proof, publicSignals }
 *
 *  4. Circuit artifacts should be placed in web-app/frontend/public/circuits/:
 *     public/circuits/ownership/ownership.wasm
 *     public/circuits/ownership/ownership.zkey
 *     (copy from blockchain/circuits/build/ after compilation)
 *
 *  5. Implement verifyProofClientSide(vkey, publicSignals, proof):
 *     Use snarkjs.groth16.verify() for immediate UI feedback before sending to backend.
 *
 * PERFORMANCE:
 *   snarkjs proof generation can be slow (1-30s depending on circuit size).
 *   Consider running it in a Web Worker to avoid blocking the UI thread.
 *   See: https://snarkjs.io/#8-verifying-from-a-smart-contract
 */

// TODO: uncomment after setting up circuit artifacts in /public/circuits/
//
// import * as snarkjs from 'snarkjs';
// import type { ProofInput } from '@land-registry/blockchain/shared';
//
// const CIRCUITS_BASE_URL = '/circuits';
//
// export async function generateOwnershipProof(input: ProofInput) {
//   const wasmUrl = `${CIRCUITS_BASE_URL}/ownership/ownership.wasm`;
//   const zkeyUrl = `${CIRCUITS_BASE_URL}/ownership/ownership.zkey`;
//
//   const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmUrl, zkeyUrl);
//   return { proof, publicSignals };
// }
//
// export async function verifyProofClientSide(
//   vkeyUrl: string,
//   publicSignals: string[],
//   proof: object
// ): Promise<boolean> {
//   const vkey = await fetch(vkeyUrl).then(r => r.json());
//   return snarkjs.groth16.verify(vkey, publicSignals, proof);
// }

export {};
