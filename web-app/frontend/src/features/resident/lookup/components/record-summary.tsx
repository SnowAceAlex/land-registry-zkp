/**
 * features/resident/lookup/components/record-summary.tsx - the public tier (D50).
 *
 * Exactly the five fields `GET /api/records/:propertyId` returns, and a note
 * saying why the certificate details are not among them. The note is not
 * decoration: a reader who sees a sparse page assumes something is broken,
 * unless told that the sparseness is the design.
 */

import type { Dictionary } from '@/i18n/dictionaries';
import { HashText } from '@/components/ui/hash-text';

import type { RecordPublic } from '../api';

type Strings = Dictionary['residentLookup'];

const STATUS_KEYS = {
  IMPORTED: 'status_IMPORTED',
  ISSUED: 'status_ISSUED',
  REVOKED: 'status_REVOKED',
} as const satisfies Record<RecordPublic['status'], keyof Strings>;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-6">
      <dt className="w-52 shrink-0 text-sm text-steel">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function RecordSummary({ record, t }: { record: RecordPublic; t: Strings }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.recordTitle}</h2>

      <dl className="divide-y divide-hairline rounded-lg border border-hairline bg-surface px-4">
        <Row label={t.fieldStatus}>{t[STATUS_KEYS[record.status]]}</Row>
        <Row label={t.fieldOwner}>
          {record.ownerCommitment ? (
            <HashText value={record.ownerCommitment} />
          ) : (
            <span className="text-steel">{t.noOwnerYet}</span>
          )}
        </Row>
        <Row label={t.fieldLeaf}>
          {record.leaf ? <HashText value={record.leaf} /> : <span className="text-steel">—</span>}
        </Row>
        <Row label={t.fieldRootVersion}>
          {record.rootVersion === null ? (
            <span className="text-steel">{t.notPublishedYet}</span>
          ) : (
            <span className="font-mono">{record.rootVersion}</span>
          )}
        </Row>
      </dl>

      <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.publicTierNote}</p>
    </section>
  );
}
