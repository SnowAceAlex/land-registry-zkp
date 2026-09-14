/**
 * The per-row verdict of an import (D52): four counts, the empty-catalog notice
 * once, and the rejected rows with the backend's own reason.
 *
 * No auto-correction is offered for any row (D35): input must already be
 * current, so a superseded land code is simply an invalid value to fix at the
 * source.
 */

import type { Dictionary } from '@/i18n/dictionaries';
import { Notice } from '@/components/ui/notice';

import type { ImportResult } from '../../api/types';

type Strings = Dictionary['govImport'];

export function ImportReport({ result, t }: { result: ImportResult; t: Strings }) {
  const stats = [
    { label: t.statReady, value: result.imported, emphasis: true },
    { label: t.statExisting, value: result.skipped },
    { label: t.statErrors, value: result.errors.length, danger: result.errors.length > 0 },
    { label: t.statWarnings, value: result.warnings.length },
  ];

  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-4">
        {stats.map(({ label, value, emphasis, danger }) => (
          <div key={label} className="bg-white px-4 py-3">
            <dt className="text-xs text-steel">{label}</dt>
            <dd
              className={`mt-1 font-mono text-2xl tracking-tight ${
                danger ? 'text-red-700' : emphasis ? 'text-authority' : 'text-ink'
              }`}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {result.catalogEmpty ? (
        <Notice tone="warning" title={t.catalogEmptyTitle}>
          {t.catalogEmptyBody}
        </Notice>
      ) : null}

      {result.errors.length > 0 ? (
        <RowTable title={t.errorsTitle} description={t.errorsBody} rows={result.errors} t={t} />
      ) : null}

      {result.warnings.length > 0 ? (
        <RowTable title={t.warningsTitle} rows={result.warnings} t={t} />
      ) : null}
    </div>
  );
}

function RowTable({
  title,
  description,
  rows,
  t,
}: {
  title: string;
  description?: string;
  rows: ImportResult['errors'];
  t: Strings;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-medium text-ink">{title}</h3>
        {description ? <p className="mt-1 max-w-prose text-sm text-steel">{description}</p> : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="border-b border-hairline text-xs text-steel">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">{t.columnRow}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t.columnProperty}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t.columnMessage}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-whisper">
            {rows.map((row, index) => (
              <tr key={`${row.row}-${index}`} className="align-top">
                <td className="px-4 py-2 font-mono text-xs text-steel">{row.row}</td>
                <td className="px-4 py-2 font-mono text-xs">{row.propertyId ?? '—'}</td>
                <td className="px-4 py-2 text-ink">{row.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
