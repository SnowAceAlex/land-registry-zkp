/**
 * lib/api-error-code.ts - classify a failed backend call.
 *
 * Screens show a translated headline chosen by this code and the backend's own
 * text as the detail line. They branch on the code — never on message text,
 * which is English, free-form and allowed to change.
 *
 * Shared by both portals (D66). The status → code table has to agree with the
 * backend, and one such table must not exist twice; the WORDING stays
 * per-portal, in the `govErrors` and `residentErrors` dictionary slices.
 * `features/government/api/error-code.ts` re-exports from here so no
 * government screen changed, and `features/resident/shell/resident-error.ts`
 * refines three codes whose meaning is resident-specific.
 */

import { ApiError } from '@/lib/api-client';

export type ApiErrorCode =
  | 'bad-request'
  | 'unauthorized'
  | 'not-found'
  | 'conflict'
  | 'gone'
  | 'unprocessable'
  | 'root-mismatch'
  | 'stale-timestamp'
  | 'invalid-proof'
  | 'unreachable'
  | 'unknown';

const REASON_CODES = {
  RootMismatch: 'root-mismatch',
  StaleTimestamp: 'stale-timestamp',
  InvalidProof: 'invalid-proof',
} as const;

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'bad-request',
  401: 'unauthorized',
  404: 'not-found',
  409: 'conflict',
  410: 'gone',
  422: 'unprocessable',
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

/** The backend's own explanation, when there is one worth showing. */
export function errorDetail(error: unknown): string | undefined {
  if (error instanceof ApiError) return error.detail;
  if (error instanceof Error) return error.message;
  return undefined;
}
