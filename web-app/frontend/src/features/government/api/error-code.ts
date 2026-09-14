/**
 * features/government/api/error-code.ts - classify a failed backend call.
 *
 * Screens show a translated headline chosen by this code and the backend's own
 * text as the detail line. They branch on the code — never on message text,
 * which is English, free-form and allowed to change.
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
