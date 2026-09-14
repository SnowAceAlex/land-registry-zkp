/**
 * app/government/transfers/page.tsx - UC-3, transfer at the counter.
 *
 * TODO (Phase 8):
 *  1. All five transfer routes are behind the guard in Phase 7 (D47): the
 *     transfer is an officer's action at the counter, so preview/submit are no
 *     longer public the way D28 left them.
 *  2. The seller's proof is generated in THIS browser. It is the officer's
 *     machine, not the owner's, which is the caveat to state plainly in the
 *     thesis rather than gloss: the secret passes through a government machine
 *     even though it never reaches the backend.
 *  3. approve only moves PENDING -> APPROVED. It no longer publishes a root.
 *     The publish happens in UC-4 as part of a ChangeSet (D46).
 *  4. Needs a per-row rejection reason, and an inline error when a submitted
 *     transfer's proof has gone stale against a newer root.
 */
import { notFound } from 'next/navigation';
import { ArrowRightLeft } from 'lucide-react';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { buttonStyles } from '@/components/button';

export default async function GovTransfersPage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).govTransfers;

  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description}
        action={
          <button type="button" disabled className={buttonStyles.primary}>
            {t.action}
          </button>
        }
      />
      <EmptyState
        icon={ArrowRightLeft}
        title={t.emptyTitle}
        description={t.emptyBody}
      />
    </div>
  );
}
