/**
 * app/resident/proof/page.tsx - UC-5, generate a proof.
 *
 * Carries forward the implementation spec from the former app/owner/page.tsx,
 * which D49 folded into /resident.
 *
 * PRIVACY CONSTRAINT (not negotiable):
 *   snarkjs.groth16.fullProve runs in THIS browser. The owner's private witness
 *   (ownerSecret, the full record) never goes over the network. Only the proof
 *   and the public signals leave the page.
 *
 * TODO (Phase 9):
 *  1. Read the bundle ZIP the owner received: receipt.json + the owner secret
 *     file. Reconstruct the record with receiptToLURRecord() from
 *     @land-registry/blockchain/shared - never re-derive the field order here,
 *     and never re-implement the area number-to-2dp-string bridge.
 *  2. GET /api/proof/:propertyId to refresh the Merkle proof. The cached one in
 *     the bundle is stale the moment any root is published, because one leaf
 *     change alters every node on every other leaf's path.
 *  3. Let the owner pick ownership or mortgage (clean-title plus sufficient
 *     remaining term, per D6 - it is not a valuation range proof).
 *  4. Build the witness through shared/circuitInputs.ts. It owns
 *     PUBLIC_SIGNAL_ORDER and is the only place circuit signal names appear in
 *     TypeScript (D25). Do not hand-write the input object.
 *  5. Fetch wasm + zkey from /public/circuits/<type>/. Run fullProve in a Web
 *     Worker: it takes seconds and will otherwise freeze the tab.
 *  6. Show real progress, then offer proof.json for download.
 *
 * STATES TO BUILD: no bundle / parsing / bad bundle / proving (with progress) /
 * done / stale-proof-needs-refresh.
 */
import { notFound } from 'next/navigation';
import { Package } from 'lucide-react';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { buttonStyles } from '@/components/button';

export default async function ResidentProofPage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).residentProof;

  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description}
      />
      <EmptyState
        icon={Package}
        title={t.emptyTitle}
        description={t.emptyBody}
        action={
          <button type="button" disabled className={buttonStyles.primary}>
            {t.action}
          </button>
        }
      />
    </div>
  );
}
