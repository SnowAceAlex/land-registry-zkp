import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import en from '@/i18n/dictionaries/en.json';
import viDict from '@/i18n/dictionaries/vi.json';

import { apiFailure, walletFailure } from './error-message';

/**
 * A sentence no dictionary contains. If it ever turns up in a Failure, some
 * call site started rendering captured text again — which is the whole thing
 * these two functions exist to prevent (the app is bilingual, the API is not).
 */
const BACKEND_PROSE = 'The certificate for property 3 has been revoked.';

beforeEach(() => {
  // These functions log on purpose; the test asserts that and keeps it quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function translated(failure: { title: string; detail?: string }, dict: typeof en.govErrors) {
  const strings = Object.values(dict) as string[];
  expect(strings).toContain(failure.title);
  if (failure.detail !== undefined) expect(strings).toContain(failure.detail);
}

describe('apiFailure', () => {
  it.each([400, 401, 404, 409, 410, 422, 503, 418])(
    'answers status %i entirely out of the dictionary',
    (status) => {
      const failure = apiFailure(new ApiError(status, BACKEND_PROSE), en.govErrors);
      expect(JSON.stringify(failure)).not.toContain(BACKEND_PROSE);
      translated(failure, en.govErrors);
    },
  );

  it('says the same thing in Vietnamese, with nothing English left in it', () => {
    const failure = apiFailure(new ApiError(410, BACKEND_PROSE), viDict.govErrors);
    expect(failure.title).toBe(viDict.govErrors.gone);
    expect(failure.detail).toBeUndefined();
  });

  it('never renders a thrown Error message either', () => {
    const failure = apiFailure(new Error(BACKEND_PROSE), en.govErrors);
    expect(JSON.stringify(failure)).not.toContain(BACKEND_PROSE);
  });

  /** Dropping the detail moved the information; it did not discard it. */
  it('puts the backend text where a developer can still read it', () => {
    apiFailure(new ApiError(409, BACKEND_PROSE), en.govErrors);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(BACKEND_PROSE),
      expect.anything(),
    );
  });
});

describe('walletFailure', () => {
  /** viem attaches `shortMessage`, which used to be shown. It is English too. */
  it('does not surface viem shortMessage', () => {
    const error = Object.assign(new Error('reverted'), {
      shortMessage: BACKEND_PROSE,
      name: 'ContractFunctionExecutionError',
    });
    const failure = walletFailure(error, en.govErrors);
    expect(JSON.stringify(failure)).not.toContain(BACKEND_PROSE);
    translated(failure, en.govErrors);
  });

  /**
   * A cancelled signature is a decision, not a fault. Logging every one of them
   * would bury the failures that need reading.
   */
  it('stays out of the console when the officer pressed Cancel', () => {
    walletFailure(Object.assign(new Error('User rejected the request'), { code: 4001 }), en.govErrors);
    expect(console.error).not.toHaveBeenCalled();
  });
});
