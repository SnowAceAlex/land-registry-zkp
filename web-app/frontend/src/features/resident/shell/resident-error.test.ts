import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { ArtifactMissingError } from '@/lib/zkp';

import { residentErrorCode } from './resident-error';

describe('residentErrorCode', () => {
  // Off the proof route the shared table applies unchanged (D66).
  it('falls back to the shared classifier by default', () => {
    expect(residentErrorCode(new ApiError(404, 'x'))).toBe('not-found');
    expect(residentErrorCode(new ApiError(410, 'x'))).toBe('gone');
    expect(residentErrorCode(new ApiError(400, 'x'))).toBe('bad-request');
    expect(residentErrorCode(new ApiError(503, 'x'))).toBe('unknown');
    expect(residentErrorCode(new TypeError('fetch failed'))).toBe('unreachable');
    expect(residentErrorCode(new Error('?'))).toBe('unknown');
  });

  // On GET /api/proof/:propertyId the same statuses mean something an owner
  // needs worded differently — 410 in particular is "no proof can ever exist".
  it('refines the proof route statuses an owner reads differently', () => {
    expect(residentErrorCode(new ApiError(410, 'revoked'), true)).toBe('revoked');
    expect(residentErrorCode(new ApiError(400, 'not issued'), true)).toBe('not-issued');
    expect(residentErrorCode(new ApiError(503, 'no vkey'), true)).toBe('vkey-missing');
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
