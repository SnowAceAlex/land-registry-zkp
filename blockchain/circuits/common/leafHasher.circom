pragma circom 2.0.0;

/*
 * common/leafHasher.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * The one and only place the LUR leaf layout is spelled out circuit-side.
 *
 * leaf = Poseidon([propertyId, ownerCommitment, useType,
 *                  validityPeriod, encumbranceStatus, tenureType,
 *                  offchainHash])
 *
 * ⚠️  D4: this field order is frozen and must match shared/merkleTree.ts
 *     `hashRecord()` exactly. Getting it wrong does not fail loudly — leaves
 *     simply stop matching the published root and every proof silently fails
 *     to verify.
 *
 * `offchainHash` commits to the descriptive certificate fields (address, area,
 * landUseCode, …) that are printed on the certificate but never stored
 * on-chain. The circuit treats it as an opaque number: it is computed off-chain
 * by shared/offchainMetadata.ts and only needs to enter the leaf so that a
 * verifier recomputing the leaf from a receipt detects any edit to those
 * fields. It is a PRIVATE input — the digest never appears in publicSignals, so
 * the public signal layout (D21) and the on-chain verifier indices are
 * unchanged.
 *
 * ownership/mortgage/transfer all instantiate this template rather than
 * wiring their own Poseidon(7), so the order exists in exactly one file per
 * layer (hashRecord() in TS, LeafHasher() here) instead of four copies.
 */

include "circomlib/circuits/poseidon.circom";

template LeafHasher() {
    signal input propertyId;
    signal input ownerCommitment;
    signal input useType;
    signal input validityPeriod;
    signal input encumbranceStatus;
    signal input tenureType;
    signal input offchainHash;

    signal output leaf;

    component hasher = Poseidon(7);
    hasher.inputs[0] <== propertyId;
    hasher.inputs[1] <== ownerCommitment;
    hasher.inputs[2] <== useType;
    hasher.inputs[3] <== validityPeriod;
    hasher.inputs[4] <== encumbranceStatus;
    hasher.inputs[5] <== tenureType;
    hasher.inputs[6] <== offchainHash;

    leaf <== hasher.out;
}
