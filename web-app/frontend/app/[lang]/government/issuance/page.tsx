/**
 * app/government/issuance/page.tsx - UC-1, issue a batch.
 *
 * TODO (Phase 8), and the ordering here is load-bearing (D43):
 *  1. GET /api/government/properties?status=IMPORTED for the selectable rows.
 *  2. POST /api/government/issuance-batches -> the backend generates secrets,
 *     builds the tree and stores a durable DRAFT without touching Property.
 *  3. The browser signs publishRoot(newRoot) with Metamask. The backend never
 *     holds the key.
 *  4. POST /api/government/issuance-batches/:id/confirm. It re-reads latestRoot
 *     from the chain and will not take the txHash on trust, so do not bother
 *     trying to shortcut this with a client-reported hash.
 *  5. GET /api/government/issuance-batches/:id/archive for the ZIP, one
 *     <propertyId>/ folder per property (D42).
 *
 *  Only one DRAFT may exist at a time across IssuanceBatch and ChangeSet (D44):
 *  a root commits to the whole tree, so two parallel drafts silently overwrite
 *  each other. The UI must show the existing draft instead of offering to open
 *  a second one.
 */
import { notFound } from 'next/navigation';
import { FileSignature } from 'lucide-react';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { buttonStyles } from '@/components/button';

export default async function GovIssuancePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).govIssuance;

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
        icon={FileSignature}
        title={t.emptyTitle}
        description={t.emptyBody}
      />
    </div>
  );
}
