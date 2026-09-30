/**
 * features/government/revocations/components/revocations-view.tsx - request a
 * certificate revocation (D45), split out of the Changes page.
 *
 *  1. POST /api/government/revocations queues the request: reason code 1–5 plus
 *     free text whose keccak256 is the only part that reaches the chain.
 *  2. Nothing changes on chain until the next change set publishes
 *     (/government/changes, D46); then the leaf is removed and the plot can no
 *     longer produce a proof.
 *  3. The list below is the queue from GET /api/government/pending-changes —
 *     the same query the Changes page reads, so both agree.
 */
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { PendingRevocations } from './pending-revocations';
import { RevocationForm } from './revocation-form';

export function RevocationsView({
  t,
  errors,
  freezeT,
}: {
  t: Dictionary['govRevocations'];
  errors: Dictionary['govErrors'];
  freezeT: Dictionary['govFreeze'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <RevocationForm t={t} errors={errors} freezeT={freezeT} />
      <PendingRevocations t={t} />
    </div>
  );
}
