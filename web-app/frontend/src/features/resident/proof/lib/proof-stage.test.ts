import { describe, expect, it } from 'vitest';

import { type ProofStageFacts, isBundleStale, nextProofStage } from './proof-stage';

const ROOT = '7777';
const LEAF = '5555';

/** Everything answered, everything agreeing: the stage is `ready`. */
function facts(overrides: Partial<ProofStageFacts> = {}): ProofStageFacts {
  return {
    bundleLoaded: true,
    bundleError: null,
    integrityIssues: [],
    titleExpired: false,
    refreshRejected: false,
    bundleLeaf: LEAF,
    registryLeaf: LEAF,
    attestation: 'ok',
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
    expect(
      nextProofStage(facts({ bundleLoaded: false, integrityIssues: null, refreshedRoot: null })),
    ).toBe('no-bundle');
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
    expect(nextProofStage(facts({ hasResult: true, chainRoot: '8888' }))).toBe(
      'root-not-published',
    );
  });

  /**
   * D68 — the wall the old screen only hit inside the prover, eight seconds in
   * and worded as `Assert Failed. Error in template Ownership_226 line: 76`.
   */
  describe('superseded (D68)', () => {
    it('blocks when the registry records a different leaf for this plot', () => {
      expect(nextProofStage(facts({ registryLeaf: '6666' }))).toBe('superseded');
    });

    /**
     * Order matters more than the check does. When the registry is ahead of the
     * chain, its leaf comes from a tree nobody published — telling an owner
     * their certificate was replaced on that basis would be accusing them on
     * evidence the blockchain has not accepted.
     */
    it('yields to root-not-published, whose evidence is the published one', () => {
      expect(nextProofStage(facts({ registryLeaf: '6666', refreshedInSync: false }))).toBe(
        'root-not-published',
      );
      expect(nextProofStage(facts({ registryLeaf: '6666', chainRoot: '8888' }))).toBe(
        'root-not-published',
      );
    });

    it('claims nothing before both leaves are known', () => {
      expect(nextProofStage(facts({ registryLeaf: null }))).toBe('ready');
      expect(nextProofStage(facts({ bundleLeaf: null }))).toBe('ready');
    });

    /** A stale receipt is the normal case and must still reach ready (D64). */
    it('does not fire merely because the receipt path was behind', () => {
      expect(nextProofStage(facts())).toBe('ready');
      expect(isBundleStale('1234', ROOT)).toBe(true);
    });
  });

  describe('no-proof-possible (D68)', () => {
    /**
     * The regression this exists for. A revoked plot answers 410, so the
     * refresh throws, so `refreshedRoot` stays null — exactly the shape of a
     * request still in flight. The old ordering read it as one and left the
     * spinner turning under a record card the owner had just been told was
     * unusable.
     */
    it('does not mistake a failed refresh for one still in flight', () => {
      const rejected = facts({
        refreshRejected: true,
        refreshedRoot: null,
        chainRoot: undefined,
        chainReachable: false,
      });
      expect(nextProofStage(rejected)).toBe('no-proof-possible');
    });

    /** A retry cannot find a leaf that is not in the tree; say so instead. */
    it('outranks chain-unavailable, which would offer a pointless retry', () => {
      expect(nextProofStage(facts({ refreshRejected: true, chainReachable: false }))).toBe(
        'no-proof-possible',
      );
    });

    it('still reports the spinner while the request is genuinely running', () => {
      expect(nextProofStage(facts({ busy: 'refreshing', refreshRejected: true }))).toBe(
        'refreshing',
      );
    });

    /**
     * A plain failure — node down, 503, network — keeps its retry. Only the
     * registry's definitive "this leaf is gone" becomes a dead end.
     */
    it('leaves an ordinary failure at chain-unavailable', () => {
      expect(
        nextProofStage(facts({ refreshedRoot: null, chainRoot: undefined, chainReachable: false })),
      ).toBe('chain-unavailable');
    });
  });

  describe('title-expired (D68)', () => {
    it('blocks an expired title', () => {
      expect(nextProofStage(facts({ titleExpired: true }))).toBe('title-expired');
    });

    /**
     * Before the network, deliberately: nothing the registry could answer makes
     * an expired term provable, so the round trip would buy only a slower no.
     * These facts describe a screen that never made the call at all.
     */
    it('fires before anything is asked of the registry or the chain', () => {
      expect(
        nextProofStage(
          facts({
            titleExpired: true,
            registryLeaf: null,
            refreshedRoot: null,
            chainRoot: undefined,
            chainReachable: undefined,
          }),
        ),
      ).toBe('title-expired');
    });

    /** A broken file is the more specific complaint, and it comes first. */
    it('yields to a failed integrity check', () => {
      expect(
        nextProofStage(facts({ titleExpired: true, integrityIssues: ['secret-mismatch'] })),
      ).toBe('integrity-failed');
    });
  });

  /** D82 — the registry refuses the status attestation while a procedure is open. */
  describe('procedure-open (D82)', () => {
    it('stops when the registry refuses the attestation', () => {
      expect(nextProofStage(facts({ attestation: 'open' }))).toBe('procedure-open');
    });

    it('waits while the attestation request is in flight', () => {
      expect(nextProofStage(facts({ attestation: 'pending' }))).toBe('refreshing');
    });

    /** Same reasoning as `superseded`: only claim it once evidence agrees. */
    it('yields to root-not-published and superseded', () => {
      expect(nextProofStage(facts({ attestation: 'open', chainRoot: '8888' }))).toBe(
        'root-not-published',
      );
      expect(nextProofStage(facts({ attestation: 'open', registryLeaf: '6666' }))).toBe(
        'superseded',
      );
    });
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
