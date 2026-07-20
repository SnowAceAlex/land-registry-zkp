pragma circom 2.0.0;

/*
 * common/leafHasher.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * The one and only place the LUR leaf layout is spelled out circuit-side.
 *
 * leaf = Poseidon([propertyId, ownerCommitment, useType,
 *                  validityPeriod, encumbranceStatus, tenureType])
 *
 * ⚠️  D4: this field order is frozen and must match shared/merkleTree.ts
 *     `hashRecord()` exactly. Getting it wrong does not fail loudly — leaves
 *     simply stop matching the published root and every proof silently fails
 *     to verify.
 *
 * ownership/mortgage/transfer all instantiate this template rather than
 * wiring their own Poseidon(6), so the order exists in exactly one file per
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

    signal output leaf;

    component hasher = Poseidon(6);
    hasher.inputs[0] <== propertyId;
    hasher.inputs[1] <== ownerCommitment;
    hasher.inputs[2] <== useType;
    hasher.inputs[3] <== validityPeriod;
    hasher.inputs[4] <== encumbranceStatus;
    hasher.inputs[5] <== tenureType;

    leaf <== hasher.out;
}
