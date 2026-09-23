import { describe, expect, it } from 'vitest';

import { MAX_TERM_YEARS, SECONDS_PER_YEAR, parseTermYears, yearsToSeconds } from './term';

/**
 * Moved here with the function when the resident mortgage screen needed the
 * same conversion the transfer counter uses (D66). Same assertions.
 */
describe('yearsToSeconds (D16/D27 threshold)', () => {
  it('counts 365-day years in seconds', () => {
    expect(yearsToSeconds(0)).toBe(0n);
    expect(yearsToSeconds(20)).toBe(20n * 365n * 24n * 3600n);
    expect(yearsToSeconds(1)).toBe(SECONDS_PER_YEAR);
  });

  it('rejects anything but a whole, non-negative number of years', () => {
    expect(() => yearsToSeconds(-1)).toThrow();
    expect(() => yearsToSeconds(1.5)).toThrow();
    expect(() => yearsToSeconds(Number.NaN)).toThrow();
  });

  /**
   * The cap is re-checked here and not only in the UI, because this function is
   * the single door into `minRequiredRemainingTerm` (D70). A screen that
   * forgets it must fail loudly rather than emit a public signal that announces
   * the plot is PERPETUAL.
   */
  it('refuses a threshold above the legal maximum term', () => {
    expect(yearsToSeconds(MAX_TERM_YEARS)).toBe(BigInt(MAX_TERM_YEARS) * SECONDS_PER_YEAR);
    expect(() => yearsToSeconds(MAX_TERM_YEARS + 1)).toThrow();
  });
});

describe('parseTermYears (D70)', () => {
  it('reads a whole number of years, with surrounding space', () => {
    expect(parseTermYears('0')).toEqual({ years: 0 });
    expect(parseTermYears('20')).toEqual({ years: 20 });
    expect(parseTermYears('  7  ')).toEqual({ years: 7 });
  });

  it('accepts the cap and refuses one year past it', () => {
    expect(parseTermYears(String(MAX_TERM_YEARS))).toEqual({ years: MAX_TERM_YEARS });
    expect(parseTermYears(String(MAX_TERM_YEARS + 1))).toEqual({ error: 'above-max' });
    expect(parseTermYears('999')).toEqual({ error: 'above-max' });
  });

  /**
   * The forms `Number()` would happily accept. Each names a quantity of years
   * nobody typed, and the threshold is public — a number the owner did not mean
   * to set is exactly what must not reach a public signal.
   */
  it('refuses anything that is not a plain run of digits', () => {
    for (const raw of ['', '   ', '-1', '1.5', '5.0', '+5', '5e1', '0x10', 'five', '5 years']) {
      expect(parseTermYears(raw)).toEqual({ error: 'not-whole' });
    }
  });

  it('refuses a digit run long enough to lose integer precision', () => {
    expect(parseTermYears('9'.repeat(30))).toEqual({ error: 'above-max' });
  });
});
