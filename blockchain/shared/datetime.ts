/**
 * shared/datetime.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Single shared date/time util (D10). All calendar-date input/display uses
 * Vietnam local time (UTC+7); on-chain and in-circuit values always stay
 * plain Unix epoch seconds — never convert timezone on that side.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

/** Current time as Unix epoch seconds. */
export function nowUnixTimestamp(): bigint {
  return BigInt(dayjs().unix());
}

/** Parse a calendar date (interpreted in Vietnam local time) to Unix epoch seconds. */
export function toUnixTimestamp(date: string | Date): bigint {
  return BigInt(dayjs.tz(date, VN_TIMEZONE).unix());
}

/** Format a Unix epoch seconds value as a Vietnam local calendar date/time string. */
export function fromUnixTimestamp(timestamp: bigint, format = 'DD/MM/YYYY'): string {
  return dayjs.unix(Number(timestamp)).tz(VN_TIMEZONE).format(format);
}

// ─────────────────────────────────────────────────────────────────────────────
// Proof timestamp freshness (D9, D26)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How far a proof's `currentTimestamp` may sit from real time. ±10 minutes per
 * D9 — wide enough to absorb clock skew and block time, narrow enough that a
 * stale proof cannot be replayed meaningfully.
 */
export const PROOF_TIMESTAMP_TOLERANCE_SECONDS = 600n;

/**
 * ⚠️  READ THIS BEFORE VERIFYING ANY PROOF.
 *
 * `currentTimestamp` is a *public input chosen by the prover*. The circuit
 * happily accepts any value — it only ever proves "at the moment T that I
 * claim, the title was valid". Nothing inside the ZK proof binds T to real
 * time. Without this check, an owner can generate a proof dated two years ago,
 * when their expired title was still valid, and it verifies perfectly.
 *
 * So every path that can verify a proof must apply this independently:
 *   - on-chain  — LandRegistryVerifier compares against block.timestamp
 *     (separate Solidity implementation; Solidity cannot import this)
 *   - frontend  — the verifier portal doing an off-chain snarkjs verify
 *   - backend   — any verify-on-behalf endpoint
 * The last two share this function so they cannot drift apart.
 *
 * Bounds are two-sided. A future-dated timestamp does not currently help an
 * attacker (it makes every term check stricter, not looser), but leaving the
 * upper bound open would silently become a hole if a future circuit ever reads
 * the timestamp the other way round.
 */
export function isTimestampFresh(
  claimedTimestamp: bigint,
  now: bigint = nowUnixTimestamp(),
  toleranceSeconds: bigint = PROOF_TIMESTAMP_TOLERANCE_SECONDS,
): boolean {
  const drift = claimedTimestamp > now ? claimedTimestamp - now : now - claimedTimestamp;
  return drift <= toleranceSeconds;
}

/** Throwing form of {@link isTimestampFresh}, for use at verification entry points. */
export function assertTimestampFresh(
  claimedTimestamp: bigint,
  now: bigint = nowUnixTimestamp(),
  toleranceSeconds: bigint = PROOF_TIMESTAMP_TOLERANCE_SECONDS,
): void {
  if (!isTimestampFresh(claimedTimestamp, now, toleranceSeconds)) {
    const driftSeconds = claimedTimestamp > now ? claimedTimestamp - now : now - claimedTimestamp;
    const direction = claimedTimestamp > now ? 'in the future' : 'in the past';
    throw new Error(
      `Proof timestamp is stale: claimed ${claimedTimestamp} (${fromUnixTimestamp(
        claimedTimestamp,
        'DD/MM/YYYY HH:mm',
      )}) is ${driftSeconds}s ${direction}, tolerance is ${toleranceSeconds}s. ` +
        `The proof may be a replay — reject it.`,
    );
  }
}
