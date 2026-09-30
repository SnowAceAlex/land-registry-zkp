import { describe, expect, it } from 'vitest';

import {
  CHECK_ORDER,
  type CheckName,
  type CheckState,
  type PipelineFacts,
  initialChecks,
  nextVerificationStep,
} from './proof-pipeline';

function facts(
  checks: Partial<Record<CheckName, CheckState>> = {},
  overrides: Partial<PipelineFacts> = {},
): PipelineFacts {
  return {
    parsed: true,
    checks: { ...initialChecks(), ...checks },
    chainReachable: true,
    artifactsMissing: false,
    ...overrides,
  };
}

const allPass = {
  freshness: 'pass',
  cryptographic: 'pass',
  rootMatchesChain: 'pass',
  ownerNotFrozen: 'pass',
} as const;

describe('nextVerificationStep (D63)', () => {
  it('asks for a proof before anything else', () => {
    expect(nextVerificationStep(facts({}, { parsed: false }))).toEqual({ kind: 'need-proof' });
  });

  it('runs the checks in the contract’s order', () => {
    expect(nextVerificationStep(facts())).toEqual({ kind: 'run', check: 'freshness' });
    expect(nextVerificationStep(facts({ freshness: 'pass' }))).toEqual({
      kind: 'run',
      check: 'cryptographic',
    });
    expect(nextVerificationStep(facts({ freshness: 'pass', cryptographic: 'pass' }))).toEqual({
      kind: 'run',
      check: 'rootMatchesChain',
    });
    expect(
      nextVerificationStep(
        facts({ freshness: 'pass', cryptographic: 'pass', rootMatchesChain: 'pass' }),
      ),
    ).toEqual({ kind: 'run', check: 'ownerNotFrozen' });
    expect(nextVerificationStep(facts(allPass))).toEqual({ kind: 'run', check: 'onChain' });
    expect(nextVerificationStep(facts({ ...allPass, onChain: 'pass' }))).toEqual({ kind: 'done' });
  });

  it('waits while a check is running', () => {
    expect(nextVerificationStep(facts({ cryptographic: 'running', freshness: 'pass' }))).toEqual({
      kind: 'loading',
    });
  });

  /**
   * The D26 property, and the reason freshness is first. A replayed proof is
   * cryptographically PERFECT, so if the crypto check ran first it would pass
   * and the verifier would be told the proof is valid.
   */
  it('rejects a stale proof before the cryptographic check ever runs', () => {
    const step = nextVerificationStep(facts({ freshness: 'fail' }));

    expect(step).toEqual({ kind: 'rejected', reason: 'StaleTimestamp', at: 'freshness' });
  });

  it('never reports RootMismatch for a proof that is not cryptographically valid', () => {
    // Even with the root check already marked failed, the earlier failure wins.
    const step = nextVerificationStep(
      facts({ freshness: 'pass', cryptographic: 'fail', rootMatchesChain: 'fail' }),
    );

    expect(step).toEqual({ kind: 'rejected', reason: 'InvalidProof', at: 'cryptographic' });
  });

  it('reports RootMismatch once the cryptography has passed', () => {
    expect(
      nextVerificationStep(facts({ freshness: 'pass', cryptographic: 'pass', rootMatchesChain: 'fail' })),
    ).toEqual({ kind: 'rejected', reason: 'RootMismatch', at: 'rootMatchesChain' });
  });

  it('prefers a decoded revert over the default name for the check', () => {
    const step = nextVerificationStep(
      facts({ ...allPass, onChain: 'fail' }, { rejection: 'StaleTimestamp' }),
    );

    expect(step).toEqual({ kind: 'rejected', reason: 'StaleTimestamp', at: 'onChain' });
  });

  // BLOCKED IS NOT REJECTED. An unreachable chain must never read as a verdict.
  it('blocks rather than rejecting when the chain cannot be reached', () => {
    const step = nextVerificationStep(
      facts({ freshness: 'pass', cryptographic: 'pass' }, { chainReachable: false }),
    );

    expect(step).toEqual({ kind: 'blocked', check: 'rootMatchesChain', why: 'chain-unavailable' });
  });

  it('waits rather than blocking while the chain is still being reached', () => {
    expect(
      nextVerificationStep(
        facts({ freshness: 'pass', cryptographic: 'pass' }, { chainReachable: undefined }),
      ),
    ).toEqual({ kind: 'loading' });
  });

  it('lets the local checks run even with no chain', () => {
    expect(nextVerificationStep(facts({}, { chainReachable: false }))).toEqual({
      kind: 'run',
      check: 'freshness',
    });
  });

  /**
   * A missing verifying key blocks only the LOCAL check. The contract needs no
   * local artifact, so its verdict is still obtainable — which is both the
   * honest outcome and a neat demonstration of what on-chain verification is.
   */
  it('blocks only the cryptographic check when artifacts are missing', () => {
    const blocked = nextVerificationStep(facts({ freshness: 'pass' }, { artifactsMissing: true }));
    expect(blocked).toEqual({ kind: 'blocked', check: 'cryptographic', why: 'artifacts-missing' });

    const onward = nextVerificationStep(
      facts({ freshness: 'pass', cryptographic: 'unavailable' }, { artifactsMissing: true }),
    );
    expect(onward).toEqual({ kind: 'run', check: 'rootMatchesChain' });
  });

  it('skips past an unavailable check instead of stopping on it', () => {
    expect(
      nextVerificationStep(facts({ freshness: 'pass', cryptographic: 'unavailable', rootMatchesChain: 'pass', ownerNotFrozen: 'unavailable', onChain: 'unavailable' })),
    ).toEqual({ kind: 'done' });
  });

  it('starts every check pending', () => {
    expect(Object.values(initialChecks()).every((state) => state === 'pending')).toBe(true);
    expect(Object.keys(initialChecks()).sort()).toEqual([...CHECK_ORDER].sort());
  });

  /** D79/D81 — a proof whose owner a pending procedure froze. */
  it('reports OwnerFrozen once the root has matched, and before the contract is asked', () => {
    expect(
      nextVerificationStep(
        facts({
          freshness: 'pass',
          cryptographic: 'pass',
          rootMatchesChain: 'pass',
          ownerNotFrozen: 'fail',
        }),
      ),
    ).toEqual({ kind: 'rejected', reason: 'OwnerFrozen', at: 'ownerNotFrozen' });
  });

  it('treats a skipped check — a transfer proof — as resolved', () => {
    expect(nextVerificationStep(facts({ ...allPass, ownerNotFrozen: 'skipped' }))).toEqual({
      kind: 'run',
      check: 'onChain',
    });
  });

  it('blocks the freeze check too when the chain cannot be reached', () => {
    expect(
      nextVerificationStep(
        facts(
          { freshness: 'pass', cryptographic: 'pass', rootMatchesChain: 'unavailable' },
          { chainReachable: false },
        ),
      ),
    ).toEqual({ kind: 'blocked', check: 'ownerNotFrozen', why: 'chain-unavailable' });
  });
});
