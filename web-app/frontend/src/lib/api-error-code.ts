/**
 * lib/api-error-code.ts - classify a failed backend call.
 *
 * Screens show a translated message chosen by this code, and branch on the code
 * — never on message text, which is English, free-form and allowed to change.
 *
 * ⚠️ NO BACKEND TEXT EVER REACHES THE SCREEN. Every string a user reads comes
 *    from `i18n/dictionaries/{en,vi}.json`; the backend's own sentence goes to
 *    the console through `logFailure()` and nowhere else. This app is bilingual
 *    and the API is not: showing `error.detail` under a translated headline put
 *    an English paragraph beneath a Vietnamese title on every failure screen.
 *    If a message reads too thin without it, add a dictionary key — do not
 *    borrow the backend's words to fill the space.
 *
 * Shared by both portals (D66). The status → code table has to agree with the
 * backend, and one such table must not exist twice; the WORDING stays
 * per-portal, in the `govErrors` and `residentErrors` dictionary slices.
 * `features/government/api/error-code.ts` re-exports from here so no
 * government screen changed, and `features/resident/shell/resident-error.ts`
 * refines three codes whose meaning is resident-specific.
 */

import { ApiError, type ApiReason } from '@/lib/api-client';

export type ApiErrorCode =
  | 'bad-request'
  | 'unauthorized'
  | 'not-found'
  | 'conflict'
  | 'gone'
  | 'unprocessable'
  | 'service-unavailable'
  | 'root-mismatch'
  | 'stale-timestamp'
  | 'invalid-proof'
  | 'owner-frozen'
  | 'owner-not-frozen'
  | 'unreachable'
  | 'unknown';

const REASON_CODES: Record<ApiReason, ApiErrorCode> = {
  RootMismatch: 'root-mismatch',
  StaleTimestamp: 'stale-timestamp',
  InvalidProof: 'invalid-proof',
  OwnerFrozen: 'owner-frozen',
  OwnerNotFrozen: 'owner-not-frozen',
};

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'bad-request',
  401: 'unauthorized',
  404: 'not-found',
  409: 'conflict',
  410: 'gone',
  422: 'unprocessable',
  // D74: every failed chain read in the backend becomes a 503, and on Sepolia
  // about 1 request in 400 hits an RPC timeout. Its whole value to the reader
  // is "temporary — try again", which 'unknown' threw away.
  503: 'service-unavailable',
};

export function apiErrorCode(error: unknown): ApiErrorCode {
  if (error instanceof ApiError) {
    if (error.reason) return REASON_CODES[error.reason];
    return STATUS_CODES[error.status] ?? 'unknown';
  }
  // fetch() rejects with a TypeError when the backend is down or CORS refuses.
  if (error instanceof TypeError) return 'unreachable';
  return 'unknown';
}

/**
 * The backend's own explanation — **for the console, never for the screen.**
 *
 * Exported only so `logFailure` and a debugger can reach it. A call site that
 * renders this is the bug this comment exists to prevent.
 */
function debugDetail(error: unknown): string | undefined {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return undefined;
}

/**
 * Put a failure where a developer can find it.
 *
 * The counterpart to dropping the detail line: the information did not become
 * worthless, it stopped being the user's problem. `scope` names the call site
 * so a console with several failures in it can still be read.
 */
export function logFailure(scope: string, error: unknown): void {
  console.error(`[${scope}] ${debugDetail(error) ?? 'failed'}`, error);
}
