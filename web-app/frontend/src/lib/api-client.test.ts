import { describe, expect, it } from 'vitest';

import { ApiError, filenameFromDisposition, parseApiError } from './api-client';

describe('parseApiError', () => {
  it('reads the message of a Nest exception body', () => {
    const error = parseApiError(409, {
      statusCode: 409,
      message: 'A issuance draft (#7) is still waiting to be signed.',
      error: 'Conflict',
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.detail).toBe('A issuance draft (#7) is still waiting to be signed.');
    expect(error.reason).toBeUndefined();
  });

  it('joins the list class-validator produces for a 400', () => {
    const error = parseApiError(400, {
      statusCode: 400,
      message: ['propertyId must be a decimal integer string', 'proof must be an object'],
      error: 'Bad Request',
    });

    expect(error.detail).toBe(
      'propertyId must be a decimal integer string; proof must be an object',
    );
  });

  it('keeps the D33 reason and details of a proof rejection', () => {
    // approve() throws UnprocessableEntityException({ reason, message, details }),
    // which Nest sends as the body verbatim.
    const error = parseApiError(422, {
      reason: 'RootMismatch',
      message: 'Proof root does not match latestRoot',
      details: { expected: '555', actual: '777' },
    });

    expect(error.reason).toBe('RootMismatch');
    expect(error.details).toEqual({ expected: '555', actual: '777' });
    expect(error.detail).toBe('Proof root does not match latestRoot');
  });

  it('ignores a reason that is not one of the D33 names', () => {
    expect(parseApiError(422, { reason: 42, message: 'x' }).reason).toBeUndefined();
  });

  it('falls back to the status line when the body is not a JSON error', () => {
    const error = parseApiError(502, '<html>Bad Gateway</html>', 'Bad Gateway');

    expect(error.detail).toBe('502 Bad Gateway');
    expect(error.message).toContain('502');
  });
});

describe('filenameFromDisposition', () => {
  it('reads a quoted filename', () => {
    expect(filenameFromDisposition('attachment; filename="batch-3.zip"', 'x.zip')).toBe(
      'batch-3.zip',
    );
  });

  it('reads an unquoted filename', () => {
    expect(filenameFromDisposition('attachment; filename=transfer-5.zip', 'x.zip')).toBe(
      'transfer-5.zip',
    );
  });

  it('uses the fallback when the header is missing', () => {
    expect(filenameFromDisposition(null, 'download.zip')).toBe('download.zip');
  });
});
