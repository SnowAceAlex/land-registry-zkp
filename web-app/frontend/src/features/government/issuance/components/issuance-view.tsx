/**
 * features/government/issuance/components/issuance-view.tsx - UC-1, issue a batch.
 *
 * Implemented in Phase 8; the ordering below is load-bearing (D43) and is what
 * IssuanceWorkbench + publishing/DraftPanel follow:
 *  1. GET /api/government/properties?status=IMPORTED for the selectable rows
 *     (the filter exists since D54's backend change).
 *  2. POST /api/government/issuance-batches -> the backend generates secrets,
 *     builds the tree and stores a durable DRAFT without touching Property.
 *  3. The browser signs publishRoot(newRoot) with Metamask. The backend never
 *     holds the key. The wallet config is features/government/wallet/.
 *  4. POST /api/government/issuance-batches/:id/confirm. It re-reads latestRoot
 *     from the chain and will not take the txHash on trust, so do not bother
 *     trying to shortcut this with a client-reported hash.
 *  5. GET /api/government/issuance-batches/:id/archive for the ZIP, one
 *     <propertyId>/ folder per property (D42).
 *
 *  Only one DRAFT may exist at a time across IssuanceBatch and ChangeSet (D44):
 *  a root commits to the whole tree, so two parallel drafts silently overwrite
 *  each other. The UI must show the existing draft instead of offering to open
 *  a second one — GET /api/government/drafts/open (D53) tells it which.
 */
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { IssuanceWorkbench } from './issuance-workbench';

export function IssuanceView({
  lang,
  t,
  draftT,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govIssuance'];
  draftT: Dictionary['govDraft'];
  errors: Dictionary['govErrors'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <IssuanceWorkbench lang={lang} t={t} draftT={draftT} errors={errors} />
    </div>
  );
}
