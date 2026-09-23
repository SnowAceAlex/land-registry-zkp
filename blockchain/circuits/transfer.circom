pragma circom 2.0.0;

/*
 * transfer.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * Use case: the state authority needs to confirm a proposed ownership transfer
 * is legitimate *before* publishing the resulting root. The old and new owner
 * jointly produce one proof that the only thing changing is who holds the title.
 *
 * Two-step flow (CODING_ROADMAP §3 — easy to get backwards):
 *   1. old + new owner generate this proof -> LandRegistryVerifier.verifyTransfer()
 *      checks it against the CURRENT root. newMerkleRoot is not published yet.
 *   2. only if that passes does the state authority call publishRoot(newMerkleRoot).
 *
 * Public signals (order is load-bearing — D21):
 *   [0] oldMerkleRoot         must equal the currently published root
 *   [1] newMerkleRoot         the root the authority is being asked to publish
 *   [2] propertyId
 *   [3] oldOwnerCommitment
 *   [4] newOwnerCommitment
 *
 * Private: useType, validityPeriod, encumbranceStatus, tenureType,
 *          oldOwnerSecret, newOwnerSecret,
 *          oldSiblings[24], oldPathIndices[24], newSiblings[24], newPathIndices[24]
 *
 * Constraints (CODING_ROADMAP §2.4):
 *   1. oldOwnerCommitment === Poseidon([oldOwnerSecret])
 *   2. newOwnerCommitment === Poseidon([newOwnerSecret])
 *   3. oldLeaf from the record with oldOwnerCommitment
 *   4. oldLeaf included in oldMerkleRoot
 *   5. newLeaf from the SAME record fields but newOwnerCommitment
 *   6. newLeaf included in newMerkleRoot
 *   7. encumbranceStatus === FREE — no transferring mortgaged/litigated land
 *   8. tenureType == PERPETUAL OR remaining term >= minRequiredRemainingTerm
 *
 * Constraint 8 was not in the original §2.4 sketch (D27). Vietnamese law
 * transfers the *remaining* term along with fixed-term land, so a buyer must be
 * told what they are actually acquiring — and expired land must not change
 * hands at all. Same threshold construction as mortgage.circom: the buyer
 * acknowledges "at least N seconds of term remain" and the proof attests it,
 * while the exact expiry date stays private (it reaches the buyer off-chain in
 * the record bundle, so publishing it on-chain would leak without adding value).
 *
 * ── Scope limitations to carry into the thesis (Scope 1.5) ───────────────────
 * (a) Requiring both secrets in one witness assumes buyer and seller sign in a
 *     single session. A production system needs multi-party proof composition.
 * (b) CLOSED by D41. Both Merkle paths are now pinned to `expectedIndex ==
 *     propertyId`, so oldPathIndices === newPathIndices is a consequence, the
 *     new tree's slot for this property holds the NEW leaf, and the old leaf
 *     has no reachable path to the published root. Previously the two paths
 *     were independent and a malicious authority could publish a tree carrying
 *     both, leaving the seller able to keep proving ownership.
 */

include "circomlib/circuits/poseidon.circom";
include "common/merkleProof.circom";
include "common/leafHasher.circom";
include "common/termCheck.circom";

template Transfer(levels) {
    // ── Public inputs ────────────────────────────────────────────────────────
    // currentTimestamp and minRequiredRemainingTerm are appended at the end so
    // the indices of the original five stay put (D21 — Phase 4 indexes these).
    signal input oldMerkleRoot;
    signal input newMerkleRoot;
    signal input propertyId;
    signal input oldOwnerCommitment;
    signal input newOwnerCommitment;
    signal input currentTimestamp;
    signal input minRequiredRemainingTerm;

    // ── Private inputs ───────────────────────────────────────────────────────
    // Note there is ONE set of record-field signals, deliberately. Both leaves
    // are hashed from it, so "every field except the owner stays the same" is
    // structural — there is no way to express a transfer that also edits
    // useType or validityPeriod, so it needs no explicit constraint.
    signal input useType;
    signal input validityPeriod;
    signal input encumbranceStatus;
    signal input tenureType;
    // Commitment to the descriptive certificate fields (address, area,
    // landUseCode, …). Private: it never appears in publicSignals, so the D21
    // layout and the on-chain verifier indices are unchanged.
    signal input offchainHash;

    signal input oldOwnerSecret;
    signal input newOwnerSecret;

    signal input oldSiblings[levels];
    signal input oldPathIndices[levels];
    signal input newSiblings[levels];
    signal input newPathIndices[levels];

    // 1. The seller must know their secret — this is the authorisation to sell.
    component oldCommitmentHasher = Poseidon(1);
    oldCommitmentHasher.inputs[0] <== oldOwnerSecret;
    oldCommitmentHasher.out === oldOwnerCommitment;

    // 2. The buyer must know theirs — proves the new commitment is a real
    //    account someone can later prove ownership of, not an unspendable value.
    component newCommitmentHasher = Poseidon(1);
    newCommitmentHasher.inputs[0] <== newOwnerSecret;
    newCommitmentHasher.out === newOwnerCommitment;

    // 3. Pre-transfer leaf.
    component oldLeafHasher = LeafHasher();
    oldLeafHasher.propertyId <== propertyId;
    oldLeafHasher.ownerCommitment <== oldOwnerCommitment;
    oldLeafHasher.useType <== useType;
    oldLeafHasher.validityPeriod <== validityPeriod;
    oldLeafHasher.encumbranceStatus <== encumbranceStatus;
    oldLeafHasher.tenureType <== tenureType;
    oldLeafHasher.offchainHash <== offchainHash;

    // 4. ...which must be in the currently published tree.
    component oldMerkle = MerkleProof(levels);
    oldMerkle.leaf <== oldLeafHasher.leaf;
    for (var i = 0; i < levels; i++) {
        oldMerkle.siblings[i] <== oldSiblings[i];
        oldMerkle.pathIndices[i] <== oldPathIndices[i];
    }

    oldMerkle.expectedIndex <== propertyId;
    oldMerkle.root === oldMerkleRoot;

    // 5. Post-transfer leaf — same fields, new owner.
    component newLeafHasher = LeafHasher();
    newLeafHasher.propertyId <== propertyId;
    newLeafHasher.ownerCommitment <== newOwnerCommitment;
    newLeafHasher.useType <== useType;
    newLeafHasher.validityPeriod <== validityPeriod;
    newLeafHasher.encumbranceStatus <== encumbranceStatus;
    newLeafHasher.tenureType <== tenureType;
    newLeafHasher.offchainHash <== offchainHash;

    // 6. ...which must be in the tree the authority is about to publish.
    component newMerkle = MerkleProof(levels);
    newMerkle.leaf <== newLeafHasher.leaf;
    for (var i = 0; i < levels; i++) {
        newMerkle.siblings[i] <== newSiblings[i];
        newMerkle.pathIndices[i] <== newPathIndices[i];
    }
    newMerkle.expectedIndex <== propertyId;
    newMerkle.root === newMerkleRoot;

    // 7. Compliance: land under mortgage, litigation or restriction cannot be
    //    transferred. EncumbranceStatus.FREE == 0.
    encumbranceStatus === 0;

    // 8. The remaining term the buyer is acquiring clears the threshold they
    //    acknowledged. PERPETUAL land bypasses it. Already-expired land fails
    //    even at minRequiredRemainingTerm = 0, since that degenerates to
    //    `validityPeriod >= currentTimestamp`.
    component term = RemainingTermCheck(64);
    term.tenureType <== tenureType;
    term.validityPeriod <== validityPeriod;
    term.currentTimestamp <== currentTimestamp;
    term.minRequiredRemainingTerm <== minRequiredRemainingTerm;
}

component main {public [
    oldMerkleRoot,
    newMerkleRoot,
    propertyId,
    oldOwnerCommitment,
    newOwnerCommitment,
    currentTimestamp,
    minRequiredRemainingTerm
]} = Transfer(24);
