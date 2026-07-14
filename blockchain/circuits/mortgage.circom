pragma circom 2.0.0;

/*
 * mortgage.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * Purpose: Zero-Knowledge Proof circuit for MORTGAGE / ENCUMBRANCE disclosure.
 *
 * This circuit proves that:
 *   - A specific LUR record has a particular encumbranceStatus (e.g., mortgaged)
 *   - The record is a valid leaf in the current Merkle root
 *   - Without revealing the full record details (owner identity stays private)
 *
 * Use case: A bank verifies that the property is encumbered/unencumbered before
 *            approving a loan, without learning the owner's personal details.
 *
 * Public inputs:
 *   - merkleRoot: the current Merkle root from RootRegistry.sol
 *   - propertyId: the public property identifier
 *   - encumbranceStatus: the claimed encumbrance value to verify (0 = free, 1 = mortgaged, ...)
 *
 * Private inputs (witness):
 *   - ownerCommitment, useType, validityPeriod, tenureType (hidden record fields)
 *   - merkleProof: siblings + path indices
 *
 * TODO:
 *  1. Include MerkleProof template from ./common/merkleProof.circom
 *  2. Hash record into leaf using Poseidon
 *  3. Constrain that the encumbranceStatus in the witness matches the public input
 *  4. Verify Merkle inclusion
 */

// TODO: implement circuit body
