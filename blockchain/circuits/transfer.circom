pragma circom 2.0.0;

/*
 * transfer.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * Purpose: Zero-Knowledge Proof circuit for TRANSFER / OWNERSHIP CHANGE.
 *
 * This circuit proves that:
 *   - A valid ownership transfer is taking place (old owner → new owner)
 *   - The original LUR record is in the current Merkle root (pre-transfer state)
 *   - A new updated record (with newOwnerCommitment) will form a valid new leaf
 *   - Neither the old nor new owner's secret is revealed
 *
 * Use case: The Land Registry publishes a new Merkle root including the
 *            transferred record. This ZKP proves the transfer was legitimate.
 *
 * Public inputs:
 *   - oldMerkleRoot: the root before transfer (RootRegistry current root)
 *   - newMerkleRoot: the root after transfer (what will be published)
 *   - propertyId: the public identifier of the property being transferred
 *   - oldOwnerCommitment: Poseidon(oldOwnerSecret)
 *   - newOwnerCommitment: Poseidon(newOwnerSecret)
 *
 * Private inputs (witness):
 *   - record fields (useType, validityPeriod, encumbranceStatus, tenureType)
 *   - oldOwnerSecret: proves old owner authorized the transfer
 *   - newOwnerSecret: proves new owner accepted
 *   - oldMerkleProof: inclusion proof in the old root
 *   - newMerkleProof: inclusion proof of the new record in the new root
 *
 * TODO:
 *  1. Include MerkleProof template from ./common/merkleProof.circom
 *  2. Hash old record leaf (with oldOwnerCommitment), verify in oldMerkleRoot
 *  3. Hash new record leaf (with newOwnerCommitment), verify in newMerkleRoot
 *  4. Constrain ownerCommitment derivations from secrets
 *  5. Constrain that all other record fields remain unchanged
 */

// TODO: implement circuit body
