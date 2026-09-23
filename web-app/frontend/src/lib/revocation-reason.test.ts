import { describe, expect, it } from 'vitest';

import {
  MAX_REASON_CODE,
  MIN_REASON_CODE,
  REVOCATION_REASON_CODES,
  isRevocationReasonCode,
} from './revocation-reason';

describe('revocation reason codes (D45)', () => {
  it('covers exactly the contract window', () => {
    expect([...REVOCATION_REASON_CODES]).toEqual([1, 2, 3, 4, 5]);
    expect(MIN_REASON_CODE).toBe(1);
    expect(MAX_REASON_CODE).toBe(5);
  });

  it('accepts every code the contract accepts', () => {
    for (const code of REVOCATION_REASON_CODES) {
      expect(isRevocationReasonCode(code)).toBe(true);
    }
  });

  // 0 is what an EMPTY `revocations` entry reads back as, so it must not pass:
  // a live plot would otherwise be labelled with reason 0.
  it('rejects 0 and 6, the values just outside the window', () => {
    expect(isRevocationReasonCode(0)).toBe(false);
    expect(isRevocationReasonCode(6)).toBe(false);
  });

  // The two callers hand it untrusted input: an `unknown` event detail blob and
  // a raw chain read.
  it('rejects non-integers and non-numbers', () => {
    expect(isRevocationReasonCode(1.5)).toBe(false);
    expect(isRevocationReasonCode('1')).toBe(false);
    expect(isRevocationReasonCode(null)).toBe(false);
    expect(isRevocationReasonCode(undefined)).toBe(false);
    expect(isRevocationReasonCode(Number.NaN)).toBe(false);
    expect(isRevocationReasonCode(1n)).toBe(false);
  });
});
