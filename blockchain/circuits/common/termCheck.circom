pragma circom 2.0.0;

/*
 * common/termCheck.circom
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared legal-term predicate for ownership.circom and mortgage.circom.
 *
 * Proves (as a hard constraint, D7 — no boolean output signal):
 *     tenureType == PERPETUAL   OR   validityPeriod - currentTimestamp >= minRequiredRemainingTerm
 *
 * ── Why this doesn't subtract (D23) ──────────────────────────────────────────
 * CODING_ROADMAP §2.3 sketches this as
 *     remainingTime  = validityPeriod - currentTimestamp
 *     sufficientTerm = GreaterEqThan(64)(remainingTime, minRequiredRemainingTerm)
 * which is broken for the PERPETUAL branch: D5 stores validityPeriod = 0 as a
 * sentinel there, so the subtraction underflows in the field to a ~2^254 value,
 * and the Num2Bits inside GreaterEqThan then has no satisfying assignment. The
 * result is that a legitimately perpetual owner cannot generate a proof at all.
 *
 * Instead we mux the deadline and compare directly — no subtraction anywhere:
 *     target       = currentTimestamp + minRequiredRemainingTerm
 *     effDeadline  = isPerpetual ? target : validityPeriod
 *     effDeadline >= target
 * PERPETUAL degenerates to `target >= target`, always true, and the
 * fixed-term branch is exactly the intended comparison.
 *
 * ── Why the explicit range checks ────────────────────────────────────────────
 * circomlib's LessThan(n) (which GreaterEqThan wraps) is only sound when both
 * operands are already known to be < 2^n. validityPeriod is a *private* input,
 * so without Num2Bits a prover could feed a field element that wraps and defeat
 * the comparison. It is committed in the Merkle leaf, so forging it also means
 * forging the root — but the range check is cheap and this predicate is the
 * whole point of the mortgage proof, so constrain it directly rather than
 * relying on a second-order argument.
 */

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template RemainingTermCheck(nBits) {
    signal input tenureType;
    signal input validityPeriod;
    signal input currentTimestamp;
    signal input minRequiredRemainingTerm;

    // Bound every operand to nBits so the comparator below is sound.
    component vpBits = Num2Bits(nBits);
    vpBits.in <== validityPeriod;

    component ctBits = Num2Bits(nBits);
    ctBits.in <== currentTimestamp;

    component mrBits = Num2Bits(nBits);
    mrBits.in <== minRequiredRemainingTerm;

    // TenureType.PERPETUAL == 0, so IsZero is the same test as IsEqual(_, 0)
    // for one fewer constraint.
    component isPerpetual = IsZero();
    isPerpetual.in <== tenureType;

    signal target;
    target <== currentTimestamp + minRequiredRemainingTerm;

    // effDeadline = validityPeriod + isPerpetual * (target - validityPeriod)
    //             = isPerpetual ? target : validityPeriod
    signal effDeadline;
    effDeadline <== validityPeriod + isPerpetual.out * (target - validityPeriod);

    // Both operands are < 2^(nBits+1): validityPeriod < 2^nBits, and
    // target = currentTimestamp + minRequiredRemainingTerm < 2^(nBits+1).
    component enoughTerm = GreaterEqThan(nBits + 1);
    enoughTerm.in[0] <== effDeadline;
    enoughTerm.in[1] <== target;

    enoughTerm.out === 1;
}
