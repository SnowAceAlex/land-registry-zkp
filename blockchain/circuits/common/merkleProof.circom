pragma circom 2.0.0;

/*
 * common/merkleProof.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * Reusable Merkle inclusion proof template using Poseidon.
 * Included by ownership.circom, mortgage.circom, transfer.circom.
 *
 * Template: MerkleProof(levels)
 *   Recomputes the Merkle root from a leaf and its authentication path.
 *   The caller constrains that root against a public `merkleRoot` signal —
 *   this template only computes, it does not compare.
 *
 * Inputs:
 *   - leaf                 leaf hash (see common/leafHasher.circom)
 *   - pathIndices[levels]  0 = current node is the LEFT child, 1 = RIGHT child
 *   - siblings[levels]     sibling hash at each level, bottom-up
 *   - expectedIndex        the leaf index this path must correspond to. The
 *                          caller MUST pass the record's propertyId (D41) —
 *                          the template constrains the path bits to encode it,
 *                          so a leaf can only be proven at its own slot.
 * Output:
 *   - root                 computed Merkle root
 *
 * ⚠️  This must stay byte-for-byte semantically identical to
 *     shared/merkleTree.ts `verifyMerkleProof()`. Both walk bottom-up and
 *     both read pathIndices[i] === 0 as "current node is the left child".
 *     If the two ever disagree, proofs still generate but never verify.
 *
 * Tree depth is fixed at 20 across the project (D20) — instantiate as
 * MerkleProof(20). shared/merkleTree.ts pads every proof to exactly 20 levels
 * with the zero-hash chain, so a short tree still produces a full-depth path.
 */

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";

template MerkleProof(levels) {
    signal input leaf;
    signal input pathIndices[levels];
    signal input siblings[levels];
    // D41: the leaf index this path must correspond to. Callers pass the
    // record's propertyId, which pins one property to exactly one slot.
    signal input expectedIndex;
    signal output root;

    // levelHash[i] = the node on the path at height i; levelHash[0] is the leaf.
    signal levelHash[levels + 1];
    levelHash[0] <== leaf;

    component switchers[levels];
    component hashers[levels];

    // pathIndices read LSB-first is the binary expansion of the leaf index.
    var indexAcc = 0;
    var pow = 1;

    for (var i = 0; i < levels; i++) {
        // circomlib's Switcher is documented "assume sel is binary" — it does
        // NOT constrain sel itself. Without this, a prover could pass
        // pathIndices[i] = 5 and steer (outL, outR) to an arbitrary linear
        // combination, forging a path to any root. Force it to a bit.
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        indexAcc += pathIndices[i] * pow;
        pow = pow * 2;

        // sel = 0 -> (outL, outR) = (L, R) = (current, sibling)   [current is left]
        // sel = 1 -> (outL, outR) = (R, L) = (sibling, current)   [current is right]
        switchers[i] = Switcher();
        switchers[i].sel <== pathIndices[i];
        switchers[i].L <== levelHash[i];
        switchers[i].R <== siblings[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== switchers[i].outL;
        hashers[i].inputs[1] <== switchers[i].outR;

        levelHash[i + 1] <== hashers[i].out;
    }

    // D41 — the load-bearing line. Without it a leaf can be proven at ANY slot,
    // so a tree carrying both a transferred-away leaf and its replacement lets
    // the previous owner keep proving ownership. With it, a property occupies
    // exactly one slot and at most one owner is provable per published root.
    // The bits are already constrained above, so this is one linear constraint.
    indexAcc === expectedIndex;

    root <== levelHash[levels];
}
