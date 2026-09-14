/**
 * app/government/changes/page.tsx - UC-4, batch changes and revocations.
 *
 * TODO (Phase 8):
 *  1. GET /api/government/pending-changes for approved transfers plus queued
 *     revocations.
 *  2. POST /api/government/changesets to draft, sign with Metamask, then
 *     POST /api/government/changesets/:id/confirm. Same two-phase shape as
 *     issuance, same D44 single-draft rule.
 *  3. Revocation calls publishRootWithRevocations(newRoot, propertyIds[],
 *     reasonCodes[], detailHashes[]) (D45). Enforcement already comes free from
 *     removing the leaf - no Merkle path exists, so no proof can be built. The
 *     on-chain list exists for public auditability, which is why the reason is
 *     a uint8 code plus an off-chain detail hash and not free text.
 *  4. Warn before publishing: every root publish invalidates EVERY issued
 *     Merkle proof, not only the changed ones. RootService rewrites the whole
 *     proof cache in the same transaction.
 */
import { notFound } from 'next/navigation';
import { FolderSync } from 'lucide-react';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { buttonStyles } from '@/components/button';

export default async function GovChangesPage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).govChanges;

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
        icon={FolderSync}
        title={t.emptyTitle}
        description={t.emptyBody}
      />
    </div>
  );
}
