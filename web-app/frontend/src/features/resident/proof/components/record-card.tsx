/**
 * features/resident/proof/components/record-card.tsx
 *
 * The owner's own certificate, read from their own file. Worth stating plainly
 * on the page: unlike every other screen in this system, these values were not
 * fetched from anywhere — the registry is never asked about them, and could not
 * answer a logged-out caller if it were (D50).
 */

import type { Dictionary } from '@/i18n/dictionaries';
import type { ReceiptRecord } from '@land-registry/blockchain/shared';

type Strings = Dictionary['residentProof'];

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-44 shrink-0 text-sm text-steel">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{value}</dd>
    </div>
  );
}

export function RecordCard({ record, t }: { record: ReceiptRecord; t: Strings }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.step2}</h2>
      <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.step2Body}</p>

      <dl className="divide-y divide-hairline rounded-lg border border-hairline bg-surface px-4">
        <Row label={t.fieldProperty} value={record.propertyId} />
        <Row label={t.fieldAddress} value={record.address} />
        <Row label={t.fieldArea} value={`${record.area} m²`} />
        <Row label={t.fieldLandUse} value={record.landUseCode} />
        <Row label={t.fieldCertificate} value={record.certificateSerial} />
        <Row label={t.fieldIssuer} value={record.issuingAuthority} />
        <Row label={t.fieldIssueDate} value={record.issueDate} />
      </dl>
    </section>
  );
}
