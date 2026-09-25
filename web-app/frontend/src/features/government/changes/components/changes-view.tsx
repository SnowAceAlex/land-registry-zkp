/**
 * features/government/changes/components/changes-view.tsx - UC-4, publish a
 * change set.
 *
 * Implemented in Phase 8 (ChangesWorkbench + publishing/DraftPanel); the list
 * below is the spec they follow:
 *  1. GET /api/government/pending-changes for approved transfers plus the
 *     revocations queued on /government/revocations.
 *  2. POST /api/government/changesets to draft, sign with Metamask, then
 *     POST /api/government/changesets/:id/confirm. Same two-phase shape as
 *     issuance, same D44 single-draft rule.
 *  3. Revocation calls publishRootWithRevocations(newRoot, propertyIds[],
 *     reasonCodes[], detailHashes[]) (D45). Enforcement already comes free from
 *     removing the leaf - no Merkle path exists, so no proof can be built. The
 *     on-chain list exists for public auditability, which is why the reason is
 *     a uint8 code plus an off-chain detail hash and not free text.
 *  4. Warn before publishing: every root publish invalidates EVERY issued
 *     Merkle proof, not only the changed ones. Since D72 the backend stores the
 *     tree itself, so owners pick up their new path when they next ask.
 *  5. A change set carries at most 150 revocations (D56 + D73); the rest wait
 *     and the draft reports them as deferredRevocations. The portal reads the
 *     number from `revocationCap` on pending-changes, never from a copy.
 *  6. A round with transfers produces an archive of the buyers' bundles (D77),
 *     downloadable from the history table for 7 days.
 */
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { ChangesWorkbench } from './changes-workbench';

export function ChangesView({
  lang,
  t,
  draftT,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govChanges'];
  draftT: Dictionary['govDraft'];
  errors: Dictionary['govErrors'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <ChangesWorkbench lang={lang} t={t} draftT={draftT} errors={errors} />
    </div>
  );
}
