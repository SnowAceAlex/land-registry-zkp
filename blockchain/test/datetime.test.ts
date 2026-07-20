/**
 * test/datetime.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the proof-timestamp freshness guard (D9/D26).
 *
 * This is the check that stops a replay: `currentTimestamp` is chosen by the
 * prover and the circuit accepts any value, so an owner whose title expired
 * last year can still produce a perfectly valid proof dated back when it was
 * live. Only the verifier layer can catch that.
 */

import { expect } from 'chai';
import {
  PROOF_TIMESTAMP_TOLERANCE_SECONDS,
  assertTimestampFresh,
  isTimestampFresh,
  nowUnixTimestamp,
  toUnixTimestamp,
  fromUnixTimestamp,
} from '../shared/datetime';

const NOW = 1_800_000_000n; // fixed reference so tests don't race the clock

describe('datetime — proof timestamp freshness (D9/D26)', () => {
  it('accepts a timestamp matching real time', () => {
    expect(isTimestampFresh(NOW, NOW)).to.equal(true);
  });

  it('accepts drift in both directions up to the tolerance', () => {
    expect(isTimestampFresh(NOW - PROOF_TIMESTAMP_TOLERANCE_SECONDS, NOW)).to.equal(true);
    expect(isTimestampFresh(NOW + PROOF_TIMESTAMP_TOLERANCE_SECONDS, NOW)).to.equal(true);
  });

  it('rejects one second beyond the tolerance, both directions', () => {
    expect(isTimestampFresh(NOW - PROOF_TIMESTAMP_TOLERANCE_SECONDS - 1n, NOW)).to.equal(false);
    expect(isTimestampFresh(NOW + PROOF_TIMESTAMP_TOLERANCE_SECONDS + 1n, NOW)).to.equal(false);
  });

  it('rejects the replay case: a proof dated a year ago', () => {
    const aYearAgo = NOW - 365n * 24n * 60n * 60n;
    expect(isTimestampFresh(aYearAgo, NOW)).to.equal(false);
  });

  it('assertTimestampFresh throws with an actionable message', () => {
    let message = '';
    try {
      assertTimestampFresh(NOW - 86_400n, NOW);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).to.match(/stale/);
    expect(message).to.match(/86400s in the past/);
    expect(message).to.match(/replay/);
  });

  it('assertTimestampFresh stays silent for a fresh timestamp', () => {
    expect(() => assertTimestampFresh(NOW + 60n, NOW)).to.not.throw();
  });

  it('honours a caller-supplied tolerance', () => {
    expect(isTimestampFresh(NOW - 30n, NOW, 10n)).to.equal(false);
    expect(isTimestampFresh(NOW - 30n, NOW, 60n)).to.equal(true);
  });

  it('defaults `now` to the real clock', () => {
    // Guards against the default argument silently becoming a constant.
    expect(isTimestampFresh(nowUnixTimestamp())).to.equal(true);
    expect(isTimestampFresh(nowUnixTimestamp() - 86_400n)).to.equal(false);
  });
});

describe('datetime — UTC+7 calendar conversion (D10)', () => {
  it('round-trips a Vietnam-local calendar date through epoch seconds', () => {
    const epoch = toUnixTimestamp('2030-06-15');
    expect(fromUnixTimestamp(epoch)).to.equal('15/06/2030');
  });

  it('keeps a date stable across the UTC day boundary', () => {
    // 07:00 Hanoi is 00:00 UTC — a naive UTC formatter would render this as
    // the 15th, and an off-by-one here would silently shift every expiry date.
    const epoch = toUnixTimestamp('2030-06-16T07:00:00');
    expect(fromUnixTimestamp(epoch, 'DD/MM/YYYY HH:mm')).to.equal('16/06/2030 07:00');
  });
});
