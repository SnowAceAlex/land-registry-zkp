import { describe, expect, it } from 'vitest';

import { SECONDS_PER_YEAR, yearsToSeconds } from './term';

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
});
