/**
 * features/government/changes/components/changes-view.tsx - "Chốt sổ": close the
 * register with one registration round (D84).
 *
 * Implemented in Phase 8, widened in Phase 10 (ChangesWorkbench +
 * publishing/DraftPanel):
 *  1. One round carries everything waiting: issuance requests, approved
 *     transfers and queued revocations. The page shows what it would carry
 *     (by procedure and by office) before the central office creates it.
 *  2. The overview alerts gate the round: an error blocks it, a warning needs
 *     an acknowledgement (round-gate.ts).
 *  3. POST /api/government/changesets drafts the round, Metamask signs, then
 *     POST /api/government/changesets/:id/confirm. A draft is immutable: to drop
 *     an item, hold it, discard the draft and create it again.
 *  4. Revocations call publishRootWithRevocations(newRoot, propertyIds[],
 *     reasonCodes[], detailHashes[]) (D45). Enforcement already comes free from
 *     removing the leaf - no Merkle path exists, so no proof can be built. The
 *     on-chain list exists for public auditability, which is why the reason is
 *     a uint8 code plus an off-chain detail hash and not free text.
 *  5. Every root publish invalidates EVERY issued Merkle proof, not only the
 *     changed ones. Since D72 the backend stores the tree itself, so owners
 *     pick up their new path when they next ask.
 *  6. A round carries at most `revocationCap` revocations (D56 + D73); the rest
 *     wait and the draft reports them as deferredRevocations.
 *  7. The bundles of a round are archived per office (D88) and downloaded from
 *     the archives page.
 */
import { Suspense } from 'react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

import type { AlertStrings } from '../../api/alert-text';
import { CentralOnly } from '../../shell/components/central-only';
import { ChangesWorkbench } from './changes-workbench';

export function ChangesView({
  lang,
  t,
  draftT,
  alertT,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govChanges'];
  draftT: Dictionary['govDraft'];
  alertT: AlertStrings;
  errors: Dictionary['govErrors'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <CentralOnly t={errors}>
        {/* The queue table reads the query string, which needs a Suspense boundary. */}
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <ChangesWorkbench lang={lang} t={t} draftT={draftT} alertT={alertT} errors={errors} />
        </Suspense>
      </CentralOnly>
    </div>
  );
}
