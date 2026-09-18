import { describe, expect, it } from 'vitest';

import { type ProofStageFacts, isBundleStale, nextProofStage } from './proof-stage';

const ROOT = '7777';

/** Everything answered, everything agreeing: the stage is `ready`. */
function facts(overrides: Partial<ProofStageFacts> = {}): ProofStageFacts {
  return {
    bundleLoaded: true,
    bundleError: null,
    integrityIssues: [],
    refreshedRoot: ROOT,
    refreshedInSync: true,
    chainRoot: ROOT,
    chainReachable: true,
    busy: null,
    hasResult: false,
    ...overrides,
  };
}

describe('nextProofStage (D64)', () => {
  it('is ready when everything has answered and agrees', () => {
    expect(nextProofStage(facts())).toBe('ready');
  });

  it('walks the happy path in order', () => {
    expect(nextProofStage(facts({ bundleLoaded: false, integrityIssues: null, refreshedRoot: null }))).toBe(
      'no-bundle',
    );
    expect(nextProofStage(facts({ busy: 'parsing' }))).toBe('parsing');
    expect(nextProofStage(facts({ integrityIssues: null }))).toBe('parsing');
    expect(nextProofStage(facts({ refreshedRoot: null }))).toBe('refreshing');
    expect(nextProofStage(facts({ busy: 'proving' }))).toBe('proving');
    expect(nextProofStage(facts({ hasResult: true }))).toBe('done');
  });

  // The owner picked a file; being told "no bundle" would be wrong.
  it('reports a rejected file rather than falling back to no-bundle', () => {
    expect(nextProofStage(facts({ bundleLoaded: false, bundleError: 'missing-secret' }))).toBe(
      'bundle-rejected',
    );
    expect(nextProofStage(facts({ bundleLoaded: true, bundleError: 'invalid-json' }))).toBe(
      'bundle-rejected',
    );
  });

  it('stops at a failed integrity check before touching the network', () => {
    expect(nextProofStage(facts({ integrityIssues: ['leaf-mismatch'], refreshedRoot: null }))).toBe(
      'integrity-failed',
    );
  });

  it('waits rather than guessing while the chain read is in flight', () => {
    expect(nextProofStage(facts({ chainReachable: undefined, chainRoot: undefined }))).toBe(
      'refreshing',
    );
  });

  it('blocks when the chain cannot be reached', () => {
    expect(nextProofStage(facts({ chainReachable: false, chainRoot: undefined }))).toBe(
      'chain-unavailable',
    );
  });

  /**
   * The BLOCKING sense of stale. Either signal is enough: the backend's own
   * inSync flag, or the roots simply differing. Proving here would produce a
   * proof every verifier rejects with RootMismatch.
   */
  it('blocks when the registry tree is not the published root', () => {
    expect(nextProofStage(facts({ refreshedInSync: false }))).toBe('root-not-published');
    expect(nextProofStage(facts({ chainRoot: '8888' }))).toBe('root-not-published');
  });

  /**
   * The BENIGN sense. The receipt's own path being older is the normal state
   * after any stranger transfers a plot, and the refresh has already repaired
   * it — so it must not stop the owner.
   */
  it('still reaches ready when only the receipt is behind', () => {
    // Nothing in the facts even mentions the receipt's root: staleness of the
    // FILE is not an input to the stage machine, which is the point.
    expect(nextProofStage(facts())).toBe('ready');
    expect(isBundleStale('1234', ROOT)).toBe(true);
  });

  it('does not let a result mask a chain that has moved on', () => {
    expect(nextProofStage(facts({ hasResult: true, chainRoot: '8888' }))).toBe('root-not-published');
  });
});

describe('isBundleStale (D64, benign)', () => {
  it('is true when the receipt root differs from the refreshed one', () => {
    expect(isBundleStale('1234', ROOT)).toBe(true);
  });

  it('is false when they match', () => {
    expect(isBundleStale(ROOT, ROOT)).toBe(false);
  });

  it('claims nothing before the refresh has answered', () => {
    expect(isBundleStale(ROOT, null)).toBe(false);
  });
});
