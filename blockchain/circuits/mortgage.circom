pragma circom 2.0.0;

/*
 * mortgage.circom  —  clean-title / encumbrance-free proof
 * ─────────────────────────────────────────────────────────────────────────────
 * Use case: a landholder proves to a bank that the title offered as collateral
 * is free of any encumbrance AND still has at least a chosen amount of legal
 * term left — without revealing the actual expiry date.
 *
 * The threshold is owner-chosen and public (D16, self-service — there is no
 * request/response workflow between bank and owner in this PoC). Making it
 * public is what gives it meaning: the bank reads the threshold it is being
 * offered, and the proof attests the title clears it.
 *
 * Public signals (order is load-bearing — D21):
 *   [0] merkleRoot
 *   [1] propertyId
 *   [2] ownerCommitment
 *   [3] currentTimestamp
 *   [4] minRequiredRemainingTerm     seconds of term the owner claims to have left
 *
 * Private: useType, validityPeriod, encumbranceStatus, tenureType, ownerSecret,
 *          siblings[20], pathIndices[20]
 *
 * Constraints (CODING_ROADMAP §2.3):
 *   1–3. owner binding + leaf + Merkle inclusion (same as ownership)
 *   4. encumbranceStatus === FREE (0)   — hard constraint per D7: an encumbered
 *      title simply cannot produce a proof, and no boolean result signal is
 *      exposed. The existence of a valid proof *is* the answer.
 *   5. tenureType == PERPETUAL OR remaining term >= minRequiredRemainingTerm
 */

include "circomlib/circuits/poseidon.circom";
include "common/merkleProof.circom";
include "common/leafHasher.circom";
include "common/termCheck.circom";

template Mortgage(levels) {
    // ── Public inputs ────────────────────────────────────────────────────────
    signal input merkleRoot;
    signal input propertyId;
    signal input ownerCommitment;
    signal input currentTimestamp;
    signal input minRequiredRemainingTerm;

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

    // 1. Owner binding.
    component commitmentHasher = Poseidon(1);
    commitmentHasher.inputs[0] <== ownerSecret;
    commitmentHasher.out === ownerCommitment;

    // 2. Leaf reconstruction (D4 order lives in LeafHasher).
    component leafHasher = LeafHasher();
    leafHasher.propertyId <== propertyId;
    leafHasher.ownerCommitment <== ownerCommitment;
    leafHasher.useType <== useType;
    leafHasher.validityPeriod <== validityPeriod;
    leafHasher.encumbranceStatus <== encumbranceStatus;
    leafHasher.tenureType <== tenureType;
    leafHasher.offchainHash <== offchainHash;

    // 3. Merkle inclusion against the published root.
    component merkle = MerkleProof(levels);
    merkle.leaf <== leafHasher.leaf;
    for (var i = 0; i < levels; i++) {
        merkle.siblings[i] <== siblings[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }
    
    merkle.expectedIndex <== propertyId;
    merkle.root === merkleRoot;

    // 4. Clean title. EncumbranceStatus.FREE == 0.
    encumbranceStatus === 0;

    // 5. Enough legal term left to cover the loan, without revealing how much.
    component term = RemainingTermCheck(64);
    term.tenureType <== tenureType;
    term.validityPeriod <== validityPeriod;
    term.currentTimestamp <== currentTimestamp;
    term.minRequiredRemainingTerm <== minRequiredRemainingTerm;
}

component main {public [
    merkleRoot,
    propertyId,
    ownerCommitment,
    currentTimestamp,
    minRequiredRemainingTerm
]} = Mortgage(20);
