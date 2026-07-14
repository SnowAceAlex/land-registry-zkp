pragma circom 2.0.0;

/*
 * ownership.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * Purpose: Zero-Knowledge Proof circuit for OWNERSHIP verification.
 *
 * This circuit proves that:
 *   - The prover knows a Land Use Right (LUR) record that belongs to them
 *     (i.e., their identity commitment matches ownerCommitment in the record)
 *   - The record is a valid leaf in the current published Merkle root
 *   - Without revealing the full record contents (privacy-preserving)
 *
 * Public inputs:
 *   - merkleRoot: the Merkle root currently stored in RootRegistry.sol
 *   - ownerCommitment: Poseidon(ownerSecret) — the owner's identity commitment
 *
 * Private inputs (witness — never revealed):
 *   - record fields: propertyId, useType, validityPeriod, encumbranceStatus, tenureType
 *   - ownerSecret: the owner's private key / secret scalar
 *   - merkleProof: sibling hashes + path indices for the Merkle inclusion proof
 *
 * TODO:
 *  1. Include merkleProof.circom template from ./common/merkleProof.circom
 *  2. Include Poseidon hasher from circomlib (npm: circomlib)
 *  3. Hash the record fields into a leaf: leaf = Poseidon([propertyId, ownerCommitment, ...])
 *  4. Verify ownerCommitment == Poseidon([ownerSecret])
 *  5. Verify Merkle inclusion: MerkleProof(leaf, siblings, indices) == merkleRoot
 *  6. Add range checks or other constraints as needed for the thesis
 *
 * Reference: https://docs.circom.io/
 * circomlib templates: https://github.com/iden3/circomlib
 */

// TODO: implement circuit body
