/**
 * lib/revocation-reason.ts - the on-chain revocation reason codes (D45).
 *
 * `RootRegistry` accepts `MIN_REASON_CODE`..`MAX_REASON_CODE`, i.e. 1..5, and
 * stores the code plus a `detailHash`. The free-text reason stays off chain on
 * purpose, so a code is all any reader ever gets.
 *
 * Numbers only. The five human labels are dictionary keys
 * (`residentRevocation.reason_1`…`reason_5`), because they are translated and
 * this file is imported by two sibling features that must not share strings
 * through an import (D66).
 */

export const MIN_REASON_CODE = 1;
export const MAX_REASON_CODE = 5;

export const REVOCATION_REASON_CODES = [1, 2, 3, 4, 5] as const;

export type RevocationReasonCode = (typeof REVOCATION_REASON_CODES)[number];

/**
 * Whether a number is a code the contract would have accepted.
 *
 * Used to narrow untrusted input from two directions: the `detail` blob of a
 * `REVOKED` property event, which is `unknown` on the wire, and a `revocations`
 * entry read straight off the chain.
 */
export function isRevocationReasonCode(code: unknown): code is RevocationReasonCode {
  return (
    typeof code === 'number' &&
    Number.isInteger(code) &&
    code >= MIN_REASON_CODE &&
    code <= MAX_REASON_CODE
  );
}
