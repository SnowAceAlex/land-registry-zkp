/**
 * features/resident/lookup/components/lookup-view.tsx - D48, public property
 * history.
 *
 * Implemented in Phase 9. What the original TODO asked for, and where it went:
 *
 *  1. GET /api/records/:propertyId/history — `../api.ts`. Unguarded on the same
 *     reasoning as D39: it returns only pseudonymous commitments and Poseidon
 *     hashes.
 *  2. The two-tier read split (D50) is honoured and EXPLAINED to the reader:
 *     the public route returns propertyId, ownerCommitment, status, leaf and
 *     rootVersion only, and `record-summary.tsx` says why the eight descriptive
 *     certificate fields are absent. They sit behind ApiKeyGuard at
 *     GET /api/government/properties/:propertyId, because publishing
 *     `encumbranceStatus` and `validityPeriod` would make mortgage.circom
 *     pointless. Nothing here reaches for that route.
 *  3. The lifecycle renders as events in `property-timeline.tsx`, each with the
 *     root version it was published under; ids and hashes are font-mono via
 *     `HashText`.
 *  4. The states (idle / searching / found / not found / API unreachable) live
 *     in `lookup-search.tsx`, a Client Component, so this view stays a Server
 *     Component — as the TODO required.
 */

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { LookupSearch } from './lookup-search';

export function LookupView({
  lang,
  t,
  errors,
  revocation,
}: {
  lang: Locale;
  t: Dictionary['residentLookup'];
  errors: Dictionary['residentErrors'];
  revocation: Dictionary['residentRevocation'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <LookupSearch lang={lang} t={t} errors={errors} revocation={revocation} />
    </div>
  );
}
