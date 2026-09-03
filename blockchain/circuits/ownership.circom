pragma circom 2.0.0;

/*
 * ownership.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * Use case: a landholder proves to a buyer/notary that they control a specific
 * property and that the title has not expired — without revealing the land use
 * type, the expiry date, the encumbrance status, or their secret.
 *
 * Public signals (order is load-bearing — D21, indexed by LandRegistryVerifier):
 *   [0] merkleRoot         must equal the root published in RootRegistry
 *   [1] propertyId         which property is being claimed
 *   [2] ownerCommitment    pseudonymous owner handle (D8), not a real identity
 *   [3] currentTimestamp   checked on-chain against block.timestamp ±tolerance (D9)
 *
 * Private: useType, validityPeriod, encumbranceStatus, tenureType, ownerSecret,
 *          siblings[20], pathIndices[20]
 *
 * Constraints (CODING_ROADMAP §2.2):
 *   1. ownerCommitment == Poseidon([ownerSecret])          — owner binding
 *   2. leaf == Poseidon([...6 fields...])                  — D4 order
 *   3. MerkleProof(leaf, path).root == merkleRoot          — inclusion
 *   4. tenureType == PERPETUAL OR validityPeriod > now     — not expired
 */

include "circomlib/circuits/poseidon.circom";
include "common/merkleProof.circom";
include "common/leafHasher.circom";
include "common/termCheck.circom";

template Ownership(levels) {
    // ── Public inputs ────────────────────────────────────────────────────────
    signal input merkleRoot;
    signal input propertyId;
    signal input ownerCommitment;
    signal input currentTimestamp;

    // ── Private inputs ───────────────────────────────────────────────────────
    signal input useType;
    signal input validityPeriod;
    signal input encumbranceStatus;
    signal input tenureType;
    // Commitment to the descriptive certificate fields (address, area,
    // landUseCode, …). Private: it never appears in publicSignals, so the D21
    // layout and the on-chain verifier indices are unchanged.
    signal input offchainHash;
    signal input ownerSecret;
    signal input siblings[levels];
    signal input pathIndices[levels];

    // 1. Owner binding: only someone who knows the preimage of the public
    //    ownerCommitment can produce this witness.
    component commitmentHasher = Poseidon(1);
    commitmentHasher.inputs[0] <== ownerSecret;
    commitmentHasher.out === ownerCommitment;

    // 2. Reconstruct the leaf from the record fields (D4 order lives in LeafHasher).
    component leafHasher = LeafHasher();
    leafHasher.propertyId <== propertyId;
    leafHasher.ownerCommitment <== ownerCommitment;
    leafHasher.useType <== useType;
    leafHasher.validityPeriod <== validityPeriod;
    leafHasher.encumbranceStatus <== encumbranceStatus;
    leafHasher.tenureType <== tenureType;
    leafHasher.offchainHash <== offchainHash;

    // 3. That leaf must sit in the tree whose root the state authority published.
    component merkle = MerkleProof(levels);
    merkle.leaf <== leafHasher.leaf;
    for (var i = 0; i < levels; i++) {
        merkle.siblings[i] <== siblings[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }
    
    merkle.expectedIndex <== propertyId;
    merkle.root === merkleRoot;

    // 4. Not expired. minRequiredRemainingTerm = 1 makes the shared threshold
    //    check mean `validityPeriod >= currentTimestamp + 1`, i.e. strictly
    //    greater than now — the §2.2 semantics. PERPETUAL titles bypass it.
    component term = RemainingTermCheck(64);
    term.tenureType <== tenureType;
    term.validityPeriod <== validityPeriod;
    term.currentTimestamp <== currentTimestamp;
    term.minRequiredRemainingTerm <== 1;
}

component main {public [merkleRoot, propertyId, ownerCommitment, currentTimestamp]} = Ownership(20);
