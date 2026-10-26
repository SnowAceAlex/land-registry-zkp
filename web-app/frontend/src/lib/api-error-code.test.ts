import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import { apiErrorCode } from './api-error-code';

describe('apiErrorCode', () => {
  it('names each status the portal explains differently', () => {
    expect(apiErrorCode(new ApiError(400, 'x'))).toBe('bad-request');
    expect(apiErrorCode(new ApiError(401, 'x'))).toBe('unauthorized');
    expect(apiErrorCode(new ApiError(404, 'x'))).toBe('not-found');
    expect(apiErrorCode(new ApiError(409, 'x'))).toBe('conflict');
    expect(apiErrorCode(new ApiError(410, 'x'))).toBe('gone');
    expect(apiErrorCode(new ApiError(422, 'x'))).toBe('unprocessable');
    expect(apiErrorCode(new ApiError(503, 'x'))).toBe('service-unavailable');
    expect(apiErrorCode(new ApiError(500, 'x'))).toBe('unknown');
  });

  it('prefers the D33 reason over the bare status', () => {
    expect(apiErrorCode(new ApiError(422, 'x', 'RootMismatch'))).toBe('root-mismatch');
    expect(apiErrorCode(new ApiError(422, 'x', 'StaleTimestamp'))).toBe('stale-timestamp');
    expect(apiErrorCode(new ApiError(422, 'x', 'InvalidProof'))).toBe('invalid-proof');
  });

  it('names the status-attestation reasons (D82)', () => {
    expect(apiErrorCode(new ApiError(422, 'x', 'AttestationExpired'))).toBe('attestation-expired');
    expect(apiErrorCode(new ApiError(422, 'x', 'InvalidAttestation'))).toBe('invalid-attestation');
    expect(apiErrorCode(new ApiError(409, 'x', 'ProcedureOpen'))).toBe('procedure-open');
  });

  it('names the office-scope and queue reasons (D86, D87, D90)', () => {
    expect(apiErrorCode(new ApiError(403, 'x', 'OutsideOfficeArea'))).toBe('outside-office-area');
    expect(apiErrorCode(new ApiError(403, 'x', 'CentralScopeRequired'))).toBe(
      'central-scope-required',
    );
    expect(apiErrorCode(new ApiError(409, 'x', 'PredecessorNotRevoked'))).toBe(
      'predecessor-not-revoked',
    );
    expect(apiErrorCode(new ApiError(409, 'x', 'ItemInOpenDraft'))).toBe('item-in-open-draft');
    expect(apiErrorCode(new ApiError(409, 'x', 'QueueChanged'))).toBe('queue-changed');
  });

  it('calls a 403 without a reason forbidden, not unknown', () => {
    expect(apiErrorCode(new ApiError(403, 'x'))).toBe('forbidden');
  });

  it('treats a failed fetch as the API being unreachable, not as a wrong request', () => {
    // fetch() rejects with a TypeError when the backend is down or CORS fails.
    expect(apiErrorCode(new TypeError('Failed to fetch'))).toBe('unreachable');
    expect(apiErrorCode(new Error('something'))).toBe('unknown');
  });
});
