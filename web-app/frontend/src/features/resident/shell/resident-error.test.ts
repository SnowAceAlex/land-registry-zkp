import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import en from '@/i18n/dictionaries/en.json';
import viDict from '@/i18n/dictionaries/vi.json';
import { ArtifactMissingError } from '@/lib/zkp';

import { proverFailure, residentErrorCode, residentFailure } from './resident-error';

describe('residentErrorCode', () => {
  // Off the proof route the shared table applies unchanged (D66).
  it('falls back to the shared classifier by default', () => {
    expect(residentErrorCode(new ApiError(404, 'x'))).toBe('not-found');
    expect(residentErrorCode(new ApiError(410, 'x'))).toBe('gone');
    expect(residentErrorCode(new ApiError(400, 'x'))).toBe('bad-request');
    expect(residentErrorCode(new ApiError(503, 'x'))).toBe('service-unavailable');
    expect(residentErrorCode(new TypeError('fetch failed'))).toBe('unreachable');
    expect(residentErrorCode(new Error('?'))).toBe('unknown');
  });

  // On GET /api/proof/:propertyId the same statuses mean something an owner
  // needs worded differently — 410 in particular is "no proof can ever exist".
  it('refines the proof route statuses an owner reads differently', () => {
    expect(residentErrorCode(new ApiError(410, 'revoked'), true)).toBe('revoked');
    expect(residentErrorCode(new ApiError(400, 'not issued'), true)).toBe('not-issued');
  });

  // D74: a 503 on the proof route is a failed chain read — transient. It used
  // to be read as a missing verification key, which that route never loads.
  it('keeps a 503 on the proof route as the retryable shared code', () => {
    expect(residentErrorCode(new ApiError(503, 'chain read failed'), true)).toBe(
      'service-unavailable',
    );
  });

  it('leaves the other proof route statuses alone', () => {
    expect(residentErrorCode(new ApiError(404, 'x'), true)).toBe('not-found');
    expect(residentErrorCode(new ApiError(429, 'slow down'), true)).toBe('unknown');
    expect(residentErrorCode(new TypeError('fetch failed'), true)).toBe('unreachable');
  });

  it('keeps the D33 reason, which outranks the bare status', () => {
    expect(residentErrorCode(new ApiError(422, 'x', 'RootMismatch'))).toBe('root-mismatch');
    expect(residentErrorCode(new ApiError(422, 'x', 'StaleTimestamp'), true)).toBe(
      'stale-timestamp',
    );
    expect(residentErrorCode(new ApiError(422, 'x', 'InvalidProof'))).toBe('invalid-proof');
  });

  // A missing artifact is not a verification failure and must never read as
  // one: nothing is wrong with the proof or the bundle (D55).
  it('names a missing circuit artifact, on either route', () => {
    const error = new ArtifactMissingError('Could not load /circuits/ownership/ownership.wasm');
    expect(residentErrorCode(error)).toBe('artifacts-missing');
    expect(residentErrorCode(error, true)).toBe('artifacts-missing');
  });
});

/**
 * The bilingual rule, as a test rather than a comment: nothing a backend, a
 * library or a circuit wrote may appear in what a resident reads. It used to,
 * as the detail line, which is how a revoked plot produced a Vietnamese
 * headline above an English paragraph.
 */
describe('residentFailure — every word comes from the dictionary', () => {
  const BACKEND_PROSE = 'Its leaf is no longer in the tree, see the revocations mapping.';

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function assertTranslated(failure: { title: string; detail?: string }, dict: typeof en.residentErrors) {
    const strings = Object.values(dict) as string[];
    expect(JSON.stringify(failure)).not.toContain(BACKEND_PROSE);
    expect(strings).toContain(failure.title);
    if (failure.detail !== undefined) expect(strings).toContain(failure.detail);
  }

  it.each([400, 401, 404, 409, 410, 422, 503])('answers status %i in the dictionary alone', (status) => {
    const error = new ApiError(status, BACKEND_PROSE);
    assertTranslated(residentFailure(error, en.residentErrors), en.residentErrors);
    assertTranslated(residentFailure(error, en.residentErrors, true), en.residentErrors);
  });

  it('answers in Vietnamese with nothing English left in it', () => {
    const failure = residentFailure(new ApiError(410, BACKEND_PROSE), viDict.residentErrors, true);
    expect(failure.title).toBe(viDict.residentErrors.revoked);
    expect(failure.detail).toBe(viDict.residentErrors.revokedBody);
  });

  /**
   * The two dead ends take over the whole proof screen (D68), so a bare
   * headline is not enough there — and the fix is a dictionary key, never the
   * backend's sentence.
   */
  it('gives the dead ends a translated second line', () => {
    expect(residentFailure(new ApiError(410, BACKEND_PROSE), en.residentErrors, true).detail).toBe(
      en.residentErrors.revokedBody,
    );
    expect(residentFailure(new ApiError(400, BACKEND_PROSE), en.residentErrors, true).detail).toBe(
      en.residentErrors.notIssuedBody,
    );
  });

  it('leaves the one-liners without a body rather than padding them', () => {
    expect(residentFailure(new ApiError(404, BACKEND_PROSE), en.residentErrors).detail).toBeUndefined();
  });

  it('puts the backend text in the console instead', () => {
    residentFailure(new ApiError(410, BACKEND_PROSE), en.residentErrors, true);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(BACKEND_PROSE),
      expect.anything(),
    );
  });

  /** A circuit's `Assert Failed. Error in template …` is the same problem. */
  it('never renders what the prover threw', () => {
    const assertion = new Error('Assert Failed. Error in template Ownership_226 line: 76');
    const failure = proverFailure(assertion, en.residentErrors);
    expect(failure.title).toBe(en.residentErrors.proverFailed);
    expect(failure.detail).toBe(en.residentErrors.proverFailedBody);
    expect(JSON.stringify(failure)).not.toContain('Ownership_226');
  });
});
