/**
 * features/government/transfers/components/transfers-view.tsx - UC-3, transfer
 * at the counter.
 *
 * Implemented in Phase 8 (TransferCounter + TransferQueue); the list below is
 * the spec they follow:
 *  1. All five transfer routes are behind the guard in Phase 7 (D47): the
 *     transfer is an officer's action at the counter, so preview/submit are no
 *     longer public the way D28 left them.
 *  2. The seller's proof is generated in THIS browser (lib/zkp.ts). It is the
 *     officer's machine, not the owner's, which is the caveat to state plainly
 *     in the thesis rather than gloss: the secret passes through a government
 *     machine even though it never reaches the backend.
 *  3. approve only moves PENDING -> APPROVED. It no longer publishes a root.
 *     The publish happens in UC-4 as part of a ChangeSet (D46).
 *  4. Needs a per-row rejection reason, and an inline error when a submitted
 *     transfer's proof has gone stale against a newer root.
 *  5. The buyer's secret is generated at the counter and must be downloaded
 *     before submit; the buyer's receipt is downloaded once PUBLISHED (D51).
 *  6. D80: freeze the seller on chain before proving/submitting; lift it from the Rejected tab.
 */
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { TransferCounter } from './transfer-counter';
import { TransferQueue } from './transfer-queue';

export function TransfersView({
  t,
  errors,
  freezeT,
}: {
  t: Dictionary['govTransfers'];
  errors: Dictionary['govErrors'];
  freezeT: Dictionary['govFreeze'];
}) {
  return (
    <div className="space-y-10">
      <PageHeader title={t.title} description={t.description} />

      <section aria-labelledby="transfer-counter" className="space-y-4">
        <h2 id="transfer-counter" className="text-lg font-semibold tracking-tight">
          {t.counterTitle}
        </h2>
        <TransferCounter t={t} errors={errors} freezeT={freezeT} />
      </section>

      <section aria-labelledby="transfer-queue" className="space-y-4">
        <h2 id="transfer-queue" className="text-lg font-semibold tracking-tight">
          {t.queueTitle}
        </h2>
        <TransferQueue t={t} errors={errors} freezeT={freezeT} />
      </section>
    </div>
  );
}
