/**
 * features/government/issuance/components/issuance-view.tsx - UC-1, issue a batch.
 *
 * Since D84/D87 this page only QUEUES plots for issuance:
 *  1. GET /api/government/properties?status=IMPORTED for the selectable rows.
 *  2. POST /api/government/issuance-requests — the backend generates each owner
 *     secret now and keeps it on the request; the plot stays IMPORTED.
 *  3. The next round (a change set, signed on the publishing page with Metamask,
 *     D43) puts the queued plots, approved transfers and revocations under one
 *     root; its per-office archives carry the bundles (D88).
 */
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { IssuanceWorkbench } from './issuance-workbench';

export function IssuanceView({
  lang,
  t,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govIssuance'];
  errors: Dictionary['govErrors'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <IssuanceWorkbench lang={lang} t={t} errors={errors} />
    </div>
  );
}
