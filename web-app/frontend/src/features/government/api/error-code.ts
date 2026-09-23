/**
 * features/government/api/error-code.ts
 *
 * Re-export only. The classifier moved to `lib/api-error-code.ts` when the
 * resident portal needed the same status → code table (D66); the two portals
 * cannot import each other, so shared code is promoted rather than copied.
 * This file stays so no government screen or `error-message.ts` import changed.
 */

export { apiErrorCode, logFailure, type ApiErrorCode } from '@/lib/api-error-code';
