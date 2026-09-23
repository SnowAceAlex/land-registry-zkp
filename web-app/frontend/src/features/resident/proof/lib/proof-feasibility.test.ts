import { describe, expect, it } from 'vitest';

import {
  EncumbranceStatus,
  type LURRecord,
  TenureType,
  UseType,
} from '@land-registry/blockchain/shared/types';

import { MAX_TERM_YEARS, SECONDS_PER_YEAR } from '@/lib/term';

import { isTitleExpired, proofBlockers } from './proof-feasibility';

/** 2026-09-20T00:00:00Z, a fixed clock so no test depends on when it runs. */
const NOW = 1789603200n;

function record(overrides: Partial<LURRecord> = {}): LURRecord {
  return {
    propertyId: 4n,
    ownerCommitment: 111n,
    useType: UseType.RESIDENTIAL,
    // Ten years of term left.
    validityPeriod: NOW + 10n * SECONDS_PER_YEAR,
    encumbranceStatus: EncumbranceStatus.FREE,
    tenureType: TenureType.FIXED_TERM,
    offchainHash: 222n,
    ...overrides,
  };
}

describe('isTitleExpired (D68)', () => {
  it('is false while the term is still running', () => {
    expect(isTitleExpired(record(), NOW)).toBe(false);
  });

  it('is true once the term has passed', () => {
    expect(isTitleExpired(record({ validityPeriod: NOW - 1n }), NOW)).toBe(true);
  });

  /**
   * ownership.circom passes minRequiredRemainingTerm = 1, so its check is
   * `validityPeriod > now`, not `>=`. A title expiring on this very second is
   * already unprovable, and the mirror has to agree or the screen would promise
   * a proof the prover then refuses.
   */
  it('counts a term expiring on this exact second as expired', () => {
    expect(isTitleExpired(record({ validityPeriod: NOW }), NOW)).toBe(true);
    expect(isTitleExpired(record({ validityPeriod: NOW + 1n }), NOW)).toBe(false);
  });

  /**
   * ⚠️ THE SENTINEL. D5 stores validityPeriod = 0n for a perpetual title, so
   * the naive comparison says every ONT/ODT plot expired in 1970 — the exact
   * inversion of the truth. termCheck.circom dodges the same trap (D23).
   */
  it('never calls a perpetual title expired, whatever the sentinel says', () => {
    expect(isTitleExpired(record({ tenureType: TenureType.PERPETUAL, validityPeriod: 0n }), NOW)).toBe(
      false,
    );
  });
});

describe('proofBlockers — ownership', () => {
  it('finds nothing wrong with a live title', () => {
    expect(proofBlockers('ownership', record(), NOW, null)).toEqual([]);
  });

  it('reports an expired term', () => {
    expect(proofBlockers('ownership', record({ validityPeriod: NOW - 1n }), NOW, null)).toEqual([
      'expired',
    ]);
  });

  /** ownership.circom reads neither the encumbrance nor any threshold. */
  it('ignores an encumbrance, which ownership.circom does not constrain', () => {
    expect(
      proofBlockers(
        'ownership',
        record({ encumbranceStatus: EncumbranceStatus.MORTGAGED }),
        NOW,
        null,
      ),
    ).toEqual([]);
  });
});

describe('proofBlockers — mortgage', () => {
  it('allows a clean title with room to spare', () => {
    expect(proofBlockers('mortgage', record(), NOW, 5)).toEqual([]);
  });

  /** mortgage.circom §4: `encumbranceStatus === 0`, a hard constraint (D7). */
  it.each([
    EncumbranceStatus.MORTGAGED,
    EncumbranceStatus.LITIGATED,
    EncumbranceStatus.RESTRICTED,
  ])('blocks encumbrance status %i', (encumbranceStatus) => {
    expect(proofBlockers('mortgage', record({ encumbranceStatus }), NOW, 5)).toEqual(['encumbered']);
  });

  it('blocks a threshold longer than the term left', () => {
    expect(proofBlockers('mortgage', record(), NOW, 11)).toEqual(['term-too-long']);
  });

  /** The circuit's test is `validityPeriod >= now + threshold` — inclusive. */
  it('allows a threshold that lands exactly on the expiry date', () => {
    expect(proofBlockers('mortgage', record(), NOW, 10)).toEqual([]);
  });

  /**
   * MAX_TERM_YEARS is the largest number the field accepts (D70), so this is
   * the strongest claim a perpetual owner can make on screen — and the mirror
   * must not stand in its way. The second case goes past the cap on purpose:
   * the ceiling is an interface rule about what the public signal reveals, not
   * a circuit constraint, and this function answers for the circuit.
   */
  it('lets a perpetual title clear every threshold the field allows', () => {
    const perpetual = record({ tenureType: TenureType.PERPETUAL, validityPeriod: 0n });
    expect(proofBlockers('mortgage', perpetual, NOW, MAX_TERM_YEARS)).toEqual([]);
    expect(proofBlockers('mortgage', perpetual, NOW, 99)).toEqual([]);
  });

  /**
   * Both walls at once, or the owner lowers the number and meets the next one.
   */
  it('reports every reason, not just the first', () => {
    expect(
      proofBlockers(
        'mortgage',
        record({ encumbranceStatus: EncumbranceStatus.MORTGAGED }),
        NOW,
        11,
      ),
    ).toEqual(['encumbered', 'term-too-long']);
  });

  /**
   * The field's own validation owns an unusable number. Inventing a threshold
   * here would raise a wall about a figure the owner never entered.
   */
  it('claims nothing about the term while no threshold has been chosen', () => {
    expect(proofBlockers('mortgage', record(), NOW, null)).toEqual([]);
  });
});
