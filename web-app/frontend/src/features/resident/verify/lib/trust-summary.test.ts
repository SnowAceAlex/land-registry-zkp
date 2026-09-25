import { describe, expect, it } from 'vitest';

import type { RevocationEntry } from '@/lib/registry-reads';

import type { IssuerChainReport, LinkState } from './issuer-chain';
import type { PipelineStep } from './proof-pipeline';
import { type TrustFacts, summariseTrust } from './trust-summary';

const DONE: PipelineStep = { kind: 'done' };

const revocation: RevocationEntry = {
  reasonCode: 3,
  detailHash: '0xdead',
  rootVersion: 4,
  revokedAt: 1_800_000_000n,
};

function issuer(overrides: Partial<Record<keyof IssuerChainReport['links'], LinkState>> = {}): IssuerChainReport {
  return {
    account: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    organizationName: 'So Tai nguyen va Moi truong TP.HCM',
    links: {
      // No pinned root (a fresh checkout): link 1 cannot be checked. Tests that
      // need the D78 best case override it to 'pass'.
      certificate: 'not-verifiable',
      organization: 'pass',
      signature: 'pass',
      role: 'pass',
      ...overrides,
    },
  };
}

function facts(overrides: Partial<TrustFacts> = {}): TrustFacts {
  return {
    step: DONE,
    revocation: null,
    issuer: issuer(),
    chainReachable: true,
    ...overrides,
  };
}

describe('summariseTrust (D63)', () => {
  it('is a broken rule above all else', () => {
    const step: PipelineStep = { kind: 'rejected', reason: 'RootMismatch', at: 'rootMatchesChain' };

    expect(summariseTrust(facts({ step }))).toEqual({
      verdict: 'reject',
      reasons: ['proof-rejected'],
    });
  });

  /**
   * The case the whole module exists for: every check passed, and the answer is
   * still no. Nothing is wrong with the proof — the title behind it has been
   * withdrawn (D45).
   */
  it('rejects a perfect proof on a revoked plot', () => {
    const summary = summariseTrust(facts({ revocation }));

    expect(summary.verdict).toBe('reject');
    expect(summary.reasons).toContain('property-revoked');
  });

  /**
   * The other one: the proof is fine, but the root it proves against was
   * published by an account the registry never anchored (D30).
   */
  it('rejects a perfect proof whose issuer does not match the anchor', () => {
    const summary = summariseTrust(facts({ issuer: issuer({ organization: 'fail' }) }));

    expect(summary.verdict).toBe('reject');
    expect(summary.reasons).toContain('issuer-mismatch');
  });

  it('rejects when the publisher does not hold the authority role', () => {
    expect(summariseTrust(facts({ issuer: issuer({ role: 'fail' }) })).verdict).toBe('reject');
  });

  it('rejects a forged issuer signature', () => {
    expect(summariseTrust(facts({ issuer: issuer({ signature: 'fail' }) })).verdict).toBe('reject');
  });

  it('rejects an expired certificate', () => {
    expect(summariseTrust(facts({ issuer: issuer({ certificate: 'fail' }) })).verdict).toBe(
      'reject',
    );
  });

  it('names both problems when a revoked plot also has a bad issuer', () => {
    const summary = summariseTrust(
      facts({ revocation, issuer: issuer({ organization: 'fail' }) }),
    );

    expect(summary.verdict).toBe('reject');
    expect(summary.reasons).toEqual(['property-revoked', 'issuer-mismatch']);
  });

  // An unreachable chain means half the checks did not run. A tick would lie.
  it('is unknown, not accept, when the chain could not be reached', () => {
    const summary = summariseTrust(
      facts({ chainReachable: false, step: { kind: 'blocked', check: 'onChain', why: 'chain-unavailable' } }),
    );

    expect(summary.verdict).toBe('unknown');
    expect(summary.reasons).toContain('chain-unavailable');
  });

  it('is unknown while the checks are still running', () => {
    expect(summariseTrust(facts({ step: { kind: 'loading' } })).verdict).toBe('unknown');
    expect(summariseTrust(facts({ step: { kind: 'run', check: 'onChain' } })).reasons).toContain(
      'checks-incomplete',
    );
  });

  it('warns rather than accepting when no receipt was supplied', () => {
    expect(summariseTrust(facts({ issuer: null }))).toEqual({
      verdict: 'accept-with-warning',
      reasons: ['issuer-not-supplied'],
    });
  });

  /**
   * A verifier built without a pinned root (D78) cannot say who issued the
   * certificate, so it can never reach a clean accept with a receipt supplied.
   */
  it('warns when no trusted root CA is configured', () => {
    expect(summariseTrust(facts())).toEqual({
      verdict: 'accept-with-warning',
      reasons: ['issuer-unverified'],
    });
  });

  it('accepts cleanly only when every link genuinely passed', () => {
    const summary = summariseTrust(facts({ issuer: issuer({ certificate: 'pass' }) }));

    expect(summary).toEqual({ verdict: 'accept', reasons: [] });
  });
});
