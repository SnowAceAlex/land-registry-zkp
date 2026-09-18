/**
 * features/resident/proof/components/proof-view.tsx - UC-5, generate a proof.
 *
 * PRIVACY CONSTRAINT (not negotiable):
 *   snarkjs.groth16.fullProve runs in THIS browser. The owner's private witness
 *   (ownerSecret, the full record) never goes over the network. Only the proof
 *   and the public signals leave the page — and on this screen, only as a file
 *   the owner chooses to download.
 *
 * Implemented in Phase 9. What the original TODO asked for, and where it went:
 *
 *  1. The bundle is read by `lib/bundle.ts` and the record rebuilt with
 *     `receiptToLURRecordAsync()` from the shared package — the field order and
 *     the area 2dp bridge are never re-derived here (`lib/bundle-integrity.ts`).
 *  2. `GET /api/proof/:propertyId` refreshes the Merkle proof (`../api.ts`).
 *     The cached one in the bundle is stale the moment any root is published,
 *     because one leaf change alters every node on every other leaf's path.
 *  3. Ownership or mortgage — the latter framed per D6 as clean title plus
 *     sufficient remaining term, not a valuation range proof
 *     (`proof-type-picker.tsx`), with the year threshold the owner picks (D16).
 *  4. The witness goes through `shared/circuitInputs.ts`, which owns
 *     PUBLIC_SIGNAL_ORDER and is the only place circuit signal names appear in
 *     TypeScript (D25). `lib/owner-witness.ts` chooses the builder and converts
 *     units; it writes no signal name, and neither does its test.
 *  5. wasm + zkey are fetched from /public/circuits/<type>/ and fullProve runs
 *     in a Web Worker (`lib/zkp.ts`), so the tab never freezes.
 *  6. Progress is real, and the finished proof is offered for download beside
 *     the two lists that say what it reveals and what it never reveals.
 *
 *  The states the TODO listed — no bundle / parsing / bad bundle / proving /
 *  done / stale-proof-needs-refresh — are the pure stage machine in
 *  `lib/proof-stage.ts`, which also keeps the two meanings of "stale" apart
 *  (D64).
 */

import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { ProofWorkbench } from './proof-workbench';

export function ProofView({
  t,
  errors,
  signals,
  shell,
}: {
  t: Dictionary['residentProof'];
  errors: Dictionary['residentErrors'];
  signals: Dictionary['residentSignals'];
  shell: Dictionary['residentShell'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <ProofWorkbench t={t} errors={errors} signals={signals} shell={shell} />
    </div>
  );
}
