/**
 * lib/term.ts - the remaining-term threshold, in the units the circuits want.
 *
 * Two use cases pick this number and neither should convert it itself (D66):
 * the buyer at the transfer counter (D27) and the owner generating a mortgage
 * proof (D16). Both feed `minRequiredRemainingTerm`, both take whole years from
 * a person, and the circuits count seconds.
 *
 * Both also have to REJECT the same numbers, which is why parsing lives here
 * too (D70). The two screens used to validate by hand and disagreed: one tested
 * `/^\d+$/` and the other `Number.isInteger(Number(raw))`, so `"5e0"` and `" 5"`
 * were accepted at the counter and refused on the owner's screen.
 */

export const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n;

/**
 * The longest threshold either screen accepts (D70).
 *
 * Điều 172 Luật Đất đai 2024 caps a granted or leased term at 50 years, 70 for
 * the special investment cases — so no FIXED_TERM title can ever satisfy a
 * threshold above this. `minRequiredRemainingTerm` is public signal [4] (D21),
 * which makes a larger number self-defeating rather than merely pointless: the
 * only titles that could clear it are the PERPETUAL ones, so the figure itself
 * announces the `tenureType` that `mortgage.circom` exists to withhold. The cap
 * is what keeps a perpetual plot indistinguishable from a 50-year one freshly
 * granted.
 */
export const MAX_TERM_YEARS = 70;

export type TermYearsError =
  /** Not a whole number of years, 0 or more. */
  | 'not-whole'
  /** Above MAX_TERM_YEARS — see the constant for why that is a refusal. */
  | 'above-max';

export type TermYearsResult = { years: number } | { error: TermYearsError };

/**
 * Read a threshold typed by a person, or say which rule it broke.
 *
 * Deliberately stricter than `Number()`: `"5e1"`, `"0x10"`, `"5.0"` and `"+5"`
 * all name a quantity of years a user did not type, and a threshold nobody
 * meant to set is the one number here that must never reach a public signal.
 */
export function parseTermYears(raw: string): TermYearsResult {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { error: 'not-whole' };

  const years = Number(trimmed);
  // Unreachable for any string a text input can hold in practice, but a digit
  // run long enough to lose integer precision would otherwise slip through the
  // regex above and land in BigInt() below as something else entirely.
  if (!Number.isSafeInteger(years)) return { error: 'above-max' };
  if (years > MAX_TERM_YEARS) return { error: 'above-max' };

  return { years };
}

/**
 * Whole years → seconds, for the remaining-term threshold a party accepts
 * (D16/D27). 365-day years: the threshold is a floor the parties agree on, and
 * a few days' drift over decades is not what it is for.
 *
 * Re-checks what `parseTermYears` already checked, because this is the single
 * door into the witness: a screen that forgets the cap must fail here rather
 * than quietly prove something that identifies the plot.
 */
export function yearsToSeconds(years: number): bigint {
  if (!Number.isInteger(years) || years < 0) {
    throw new Error(`The remaining term must be a whole number of years, got ${years}`);
  }
  if (years > MAX_TERM_YEARS) {
    throw new Error(`The remaining term may not exceed ${MAX_TERM_YEARS} years, got ${years}`);
  }
  return BigInt(years) * SECONDS_PER_YEAR;
}
