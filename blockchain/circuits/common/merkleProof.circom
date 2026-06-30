pragma circom 2.0.0;

/*
 * common/merkleProof.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * Purpose: Reusable Merkle inclusion proof template using Poseidon hash.
 *          Included by ownership.circom, mortgage.circom, transfer.circom.
 *
 * Template: MerkleProof(levels)
 *   Proves that a given `leaf` is included in a Merkle tree of depth `levels`,
 *   given `siblings` (the sibling hash at each level) and `pathIndices`
 *   (0 = current node is left child, 1 = current node is right child).
 *
 * Inputs:
 *   - leaf:         The leaf hash to prove inclusion of (Poseidon hash of record)
 *   - pathIndices[levels]:  Array of 0/1 indicating left/right at each level
 *   - siblings[levels]:    The sibling hashes at each level of the Merkle path
 *
 * Output:
 *   - root:  The Merkle root computed from the leaf + proof. Should equal
 *            the published root in RootRegistry.sol to be valid.
 *
 * TODO:
 *  1. Import Poseidon hasher: include "circomlib/circuits/poseidon.circom"
 *     (Install circomlib: npm install circomlib in blockchain/ — it ships .circom files)
 *  2. Import Switcher (mux) template for selecting left/right: 
 *     include "circomlib/circuits/switcher.circom"  (or use a conditional mux)
 *  3. Implement the MerkleProof template:
 *       template MerkleProof(levels) {
 *         signal input leaf;
 *         signal input pathIndices[levels];
 *         signal input siblings[levels];
 *         signal output root;
 *
 *         component hashers[levels];
 *         component switchers[levels];
 *
 *         for (var i = 0; i < levels; i++) {
 *           // Use switcher to pick left/right based on pathIndices[i]
 *           // Hash: Poseidon([left, right])
 *         }
 *         root <== hashers[levels-1].out;
 *       }
 *  4. Set default tree depth constant (e.g., 20 levels for ~1M leaves)
 *
 * Note: The Poseidon hash function is ZK-friendly (much cheaper in-circuit
 *       than Keccak256). All hashing in this project uses Poseidon.
 */

// TODO: implement MerkleProof template
