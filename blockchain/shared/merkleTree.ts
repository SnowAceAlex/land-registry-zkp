/**
 * shared/merkleTree.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Merkle tree utilities using Poseidon hash (ZK-friendly).
 *
 * ⚠️  IMPORTANT DESIGN RULE:
 *   All Merkle tree / Poseidon hash logic lives EXCLUSIVELY here.
 *   Both backend (chain.service.ts) and frontend (lib/zkp.ts) must import
 *   from '@land-registry/blockchain/shared' — NEVER copy this logic elsewhere.
 *
 * Dependencies:
 *   - circomlibjs: provides Poseidon hash compatible with circom circuits
 *   - merkletreejs: provides the MerkleTree data structure
 *
 * Hash function: Poseidon (NOT Keccak256)
 *   Poseidon is ZK-friendly — it has a much lower constraint count inside
 *   circom circuits compared to Keccak256 or SHA-256.
 */

import { LURRecord, MerkleProofData } from './types';

// TODO: Import Poseidon from circomlibjs
// import { buildPoseidon } from 'circomlibjs';

// TODO: Import MerkleTree from merkletreejs
// import { MerkleTree } from 'merkletreejs';

// ─────────────────────────────────────────────────────────────────────────────
// Poseidon Hash Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Implement Poseidon hash wrapper.
 *
 * circomlibjs Poseidon is async to initialize (WASM-based).
 * Pattern: call buildPoseidon() once and cache the instance.
 *
 * @param inputs Array of bigint values to hash (max ~15 inputs for Poseidon)
 * @returns      The Poseidon hash as a bigint
 *
 * Example implementation:
 *   let poseidon: any;
 *   async function getPoseidon() {
 *     if (!poseidon) poseidon = await buildPoseidon();
 *     return poseidon;
 *   }
 *
 *   export async function poseidonHash(inputs: bigint[]): Promise<bigint> {
 *     const p = await getPoseidon();
 *     const hash = p(inputs.map(x => x));
 *     return BigInt(p.F.toString(hash));
 *   }
 */
export async function poseidonHash(_inputs: bigint[]): Promise<bigint> {
  // TODO: implement using circomlibjs buildPoseidon
  throw new Error('poseidonHash not implemented yet');
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Leaf Hashing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Compute the Poseidon leaf hash for a LUR record.
 *
 * The leaf is: Poseidon([propertyId, ownerCommitment, useType, validityPeriod, encumbranceStatus, assessedValue])
 * This must match EXACTLY the leaf computation inside the circom circuits.
 *
 * @param record A LURRecord with all fields as bigint
 * @returns      The leaf hash as a bigint
 */
export async function hashRecord(_record: LURRecord): Promise<bigint> {
  // TODO: implement
  // return poseidonHash([
  //   record.propertyId,
  //   record.ownerCommitment,
  //   BigInt(record.useType),
  //   record.validityPeriod,
  //   BigInt(record.encumbranceStatus),
  //   record.assessedValue,
  // ]);
  throw new Error('hashRecord not implemented yet');
}

// ─────────────────────────────────────────────────────────────────────────────
// Merkle Tree Construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Build a Merkle tree from an array of LUR records.
 *
 * Steps:
 *  1. Hash each record using hashRecord() to produce leaf hashes
 *  2. Construct a MerkleTree using merkletreejs with Poseidon as the hash function
 *  3. Return the tree instance (use it to get root + generate proofs)
 *
 * Note on merkletreejs + Poseidon:
 *   merkletreejs expects a Buffer-based hash function. Wrap poseidonHash to accept
 *   Buffer inputs and return a Buffer. See the library docs for custom hash functions.
 *
 * @param records Array of all LUR records in the registry
 * @returns       A MerkleTree instance
 */
export async function buildTree(_records: LURRecord[]): Promise<unknown> {
  // TODO: implement
  // const leaves = await Promise.all(records.map(hashRecord));
  // const tree = new MerkleTree(leaves, poseidonHashBuffer, { sortPairs: false });
  // return tree;
  throw new Error('buildTree not implemented yet');
}

// ─────────────────────────────────────────────────────────────────────────────
// Merkle Root
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Get the Merkle root from a built tree.
 *
 * @param tree A MerkleTree instance (from buildTree)
 * @returns    The root hash as a bigint (to publish on-chain via publishRoot())
 */
export async function getMerkleRoot(_tree: unknown): Promise<bigint> {
  // TODO: implement
  // return BigInt('0x' + (tree as MerkleTree).getRoot().toString('hex'));
  throw new Error('getMerkleRoot not implemented yet');
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Generate a Merkle inclusion proof for a specific record.
 *
 * The returned MerkleProofData is used as:
 *  1. Private input to the circom circuit (siblings + pathIndices)
 *  2. On-chain verification input to RootRegistry.verifyProof()
 *
 * @param tree    The MerkleTree instance
 * @param record  The specific LUR record to generate a proof for
 * @returns       A MerkleProofData object with leaf, siblings, pathIndices, root
 */
export async function generateMerkleProof(
  _tree: unknown,
  _record: LURRecord,
): Promise<MerkleProofData> {
  // TODO: implement
  // 1. Compute the leaf hash
  // 2. Call tree.getProof(leaf) to get sibling data
  // 3. Map the proof to MerkleProofData format
  //    - Convert pathIndices from merkletreejs position format (left/right) to 0/1 array
  throw new Error('generateMerkleProof not implemented yet');
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof Verification (off-chain)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TODO: Verify a Merkle proof off-chain (without calling the contract).
 *
 * Useful for the backend to validate proofs before submitting on-chain,
 * and for the frontend to show immediate feedback.
 *
 * @param proof     A MerkleProofData object
 * @param root      The expected Merkle root (from on-chain or local state)
 * @returns         true if the proof is valid for the given root
 */
export async function verifyMerkleProof(
  _proof: MerkleProofData,
  _root: bigint,
): Promise<boolean> {
  // TODO: implement
  // Recompute root from leaf + siblings + pathIndices using Poseidon
  // Compare against the expected root
  throw new Error('verifyMerkleProof not implemented yet');
}
