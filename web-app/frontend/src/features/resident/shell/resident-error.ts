/**
 * features/resident/shell/resident-error.ts - a failure, in a resident's language.
 *
 * Same discipline as the government portal's `error-message.ts`: the title is
 * translated and chosen by CODE, the detail is the backend's own text, shown
 * untranslated because it names the exact plot or root involved. Screens never
 * branch on message text.
 *
 * Lives here, not in `lib/`, because it binds codes to the `residentErrors`
 * dictionary slice, which is portal-specific. The status → code table itself is
 * shared with the government portal (`lib/api-error-code.ts`, D66); what this
 * adds is the three codes whose MEANING is resident-specific on the proof
 * route, where the same HTTP status says something quite different to an owner
 * than it would to an officer.
 */

import type { Dictionary } from '@/i18n/dictionaries';

import { type ApiErrorCode, apiErrorCode, errorDetail } from '@/lib/api-error-code';
import { ApiError } from '@/lib/api-client';
import { ArtifactMissingError } from '@/lib/zkp';

type ErrorStrings = Dictionary['residentErrors'];

export interface Failure {
  title: string;
  detail?: string;
}

/**
 * `ApiErrorCode` plus the four cases a resident screen must word differently.
 *
 *  - `revoked` (410 on the proof route) is not "gone, try again": the leaf has
 *    been removed from the tree, so NO proof can exist for that plot, ever.
 *  - `not-issued` (400) means the plot was imported but never issued, so it has
 *    no commitment and no leaf yet (D14) — nothing is wrong with the request.
 *  - `vkey-missing` (503) is the registry unable to serve a proof, which is not
 *    the owner's problem and should not read like their file is bad.
 *  - `artifacts-missing` is a 404 on `/circuits/*` inside the worker — this
 *    deployment was never synced (D55). An owner cannot fix it; say so.
 */
export type ResidentErrorCode = ApiErrorCode | 'revoked' | 'not-issued' | 'vkey-missing' | 'artifacts-missing';

const TITLES: Record<ResidentErrorCode, keyof ErrorStrings> = {
  'bad-request': 'badRequest',
  unauthorized: 'unauthorized',
  'not-found': 'notFound',
  conflict: 'conflict',
  gone: 'gone',
  unprocessable: 'unprocessable',
  'root-mismatch': 'rootMismatch',
  'stale-timestamp': 'staleTimestamp',
  'invalid-proof': 'invalidProof',
  unreachable: 'unreachable',
  unknown: 'unknown',
  revoked: 'revoked',
  'not-issued': 'notIssued',
  'vkey-missing': 'vkeyMissing',
  'artifacts-missing': 'artifactsMissing',
};

/**
 * Classify a failure for a resident screen.
 *
 * `onProofRoute` refines the three statuses whose meaning depends on which
 * route answered. Only `GET /api/proof/:propertyId` returns 410 for a revoked
 * plot and 400 for an unissued one; a 410 from anywhere else is just gone.
 */
export function residentErrorCode(error: unknown, onProofRoute = false): ResidentErrorCode {
  if (error instanceof ArtifactMissingError) return 'artifacts-missing';

  const code = apiErrorCode(error);
  if (!onProofRoute || !(error instanceof ApiError)) return code;

  switch (error.status) {
    case 410:
      return 'revoked';
    case 400:
      return 'not-issued';
    case 503:
      return 'vkey-missing';
    default:
      return code;
  }
}

export function residentFailure(
  error: unknown,
  t: ErrorStrings,
  onProofRoute = false,
): Failure {
  return { title: t[TITLES[residentErrorCode(error, onProofRoute)]], detail: errorDetail(error) };
}
