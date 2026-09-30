/**
 * features/resident/shell/resident-error.ts - a failure, in a resident's language.
 *
 * Same discipline as the government portal's `error-message.ts`: every word is
 * translated and chosen by CODE, and screens never branch on message text.
 *
 * ⚠️ Nothing the backend wrote is rendered. It used to be, as the detail line,
 *    which is how a revoked plot produced a Vietnamese headline above an
 *    English paragraph. Captured text goes to the console via `logFailure`; a
 *    message that reads thin without it needs a dictionary key, not a borrowed
 *    sentence.
 *
 * Lives here, not in `lib/`, because it binds codes to the `residentErrors`
 * dictionary slice, which is portal-specific. The status → code table itself is
 * shared with the government portal (`lib/api-error-code.ts`, D66); what this
 * adds is the two codes whose MEANING is resident-specific on the proof route,
 * where the same HTTP status says something quite different to an owner than
 * it would to an officer.
 */

import type { Dictionary } from '@/i18n/dictionaries';

import { type ApiErrorCode, apiErrorCode, logFailure } from '@/lib/api-error-code';
import { ApiError } from '@/lib/api-client';
import { ArtifactMissingError } from '@/lib/zkp';

type ErrorStrings = Dictionary['residentErrors'];

export interface Failure {
  title: string;
  /** Translated text only — see the header. */
  detail?: string;
}

/**
 * `ApiErrorCode` plus the three cases a resident screen must word differently.
 *
 *  - `revoked` (410 on the proof route) is not "gone, try again": the leaf has
 *    been removed from the tree, so NO proof can exist for that plot, ever.
 *  - `not-issued` (400) means the plot was imported but never issued, so it has
 *    no commitment and no leaf yet (D14) — nothing is wrong with the request.
 *  - `artifacts-missing` is a 404 on `/circuits/*` inside the worker — this
 *    deployment was never synced (D55). An owner cannot fix it; say so.
 *
 * A 503 is deliberately NOT refined here any more. It used to become
 * `vkey-missing` on the proof route, but a missing verification key is a
 * `POST /api/proof/verify` failure, and this portal stopped calling that route
 * (D62). What `GET /api/proof/:propertyId` answers with 503 since D74 is a
 * failed chain read — transient, and exactly what the shared
 * `service-unavailable` says.
 */
export type ResidentErrorCode = ApiErrorCode | 'revoked' | 'not-issued' | 'artifacts-missing';

const TITLES: Record<ResidentErrorCode, keyof ErrorStrings> = {
  'bad-request': 'badRequest',
  unauthorized: 'unauthorized',
  'not-found': 'notFound',
  conflict: 'conflict',
  gone: 'gone',
  unprocessable: 'unprocessable',
  'service-unavailable': 'serviceUnavailable',
  'root-mismatch': 'rootMismatch',
  'stale-timestamp': 'staleTimestamp',
  'invalid-proof': 'invalidProof',
  'owner-frozen': 'ownerFrozen',
  'owner-not-frozen': 'ownerNotFrozen',
  unreachable: 'unreachable',
  unknown: 'unknown',
  revoked: 'revoked',
  'not-issued': 'notIssued',
  'artifacts-missing': 'artifactsMissing',
};

/**
 * A translated second line, for the codes a bare headline leaves too thin.
 *
 * `revoked` and `not-issued` earn one because they take over the whole proof
 * screen as dead ends (D68): the owner is looking at a single red box and
 * nothing else, and "this certificate has been revoked" alone does not say why
 * no proof can exist. The rest are one-liners that read complete on their own —
 * a body per code would be noise, not care.
 */
const BODIES: Partial<Record<ResidentErrorCode, keyof ErrorStrings>> = {
  revoked: 'revokedBody',
  'not-issued': 'notIssuedBody',
};

/**
 * Classify a failure for a resident screen.
 *
 * `onProofRoute` refines the two statuses whose meaning depends on which route
 * answered. Only `GET /api/proof/:propertyId` returns 410 for a revoked plot
 * and 400 for an unissued one; a 410 from anywhere else is just gone.
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
    default:
      return code;
  }
}

export function residentFailure(
  error: unknown,
  t: ErrorStrings,
  onProofRoute = false,
): Failure {
  const code = residentErrorCode(error, onProofRoute);
  logFailure(`resident/${code}`, error);
  return { title: t[TITLES[code]], detail: BODIES[code] ? t[BODIES[code]] : undefined };
}

/**
 * A failure thrown by the prover itself, worded for the person holding the
 * title (D68).
 *
 * ⚠️ THE ONE PLACE `detail` IS TRANSLATED. Everywhere else the detail is the
 *    backend's own sentence, shown untranslated because it names the exact plot
 *    or root involved. A circuit names neither: it throws
 *    `Assert Failed. Error in template Ownership_226 line: 76`, which tells an
 *    owner nothing and tells an attacker nothing either. It goes to the console
 *    for whoever is debugging and never to the screen.
 *
 * Reaching the generic branch at all means the interface mirror in
 * `proof-feasibility.ts` missed a constraint the circuit enforces. That is the
 * expected direction of drift and the reason this function exists — the mirror
 * is allowed to be incomplete precisely because this catches what it misses.
 */
export function proverFailure(error: unknown, t: ErrorStrings): Failure {
  if (error instanceof ArtifactMissingError) return residentFailure(error, t);
  // The refresh inside a proving run can still fail on the network.
  if (error instanceof ApiError) return residentFailure(error, t, true);

  console.error('[resident/proof] the prover refused the witness', error);
  return { title: t.proverFailed, detail: t.proverFailedBody };
}
