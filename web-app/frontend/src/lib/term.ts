/**
 * lib/term.ts - the remaining-term threshold, in the units the circuits want.
 *
 * Two use cases pick this number and neither should convert it itself (D66):
 * the buyer at the transfer counter (D27) and the owner generating a mortgage
 * proof (D16). Both feed `minRequiredRemainingTerm`, both take whole years from
 * a person, and the circuits count seconds.
 */

export const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

/**
 * Whole years → seconds, for the remaining-term threshold a party accepts
 * (D16/D27). 365-day years: the threshold is a floor the parties agree on, and
 * a few days' drift over decades is not what it is for.
 */
export function yearsToSeconds(years: number): bigint {
  if (!Number.isInteger(years) || years < 0) {
    throw new Error(`The remaining term must be a whole number of years, got ${years}`);
  }
  return BigInt(years) * SECONDS_PER_YEAR;
}
