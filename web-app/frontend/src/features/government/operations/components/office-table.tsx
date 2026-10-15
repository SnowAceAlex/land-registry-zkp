'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';

import type { OfficeRow, QueueKind } from '../../api/types';
import { type OfficeSortKey, type SortDir, sortOfficeRows } from '../lib/office-sort';

type T = Dictionary['govOperations'];

const COLUMNS: { key: OfficeSortKey; label: keyof T; kind?: QueueKind; summary: boolean }[] = [
  { key: 'officeCode', label: 'colOffice', summary: true },
  { key: 'issuance', label: 'colIssuance', kind: 'issuance', summary: true },
  { key: 'transfer', label: 'colTransfer', kind: 'transfer', summary: true },
  { key: 'revocation', label: 'colRevocation', kind: 'revocation', summary: true },
  { key: 'held', label: 'colHeld', summary: true },
  { key: 'fallback', label: 'colFallback', summary: false },
  { key: 'oldestAgeHours', label: 'colOldest', summary: false },
];

function ageText(hours: number | null, t: T): string {
  if (hours === null) return t.noValue;
  return hours < 48
    ? format(t.ageHours, { hours: Math.floor(hours) })
    : format(t.ageDays, { days: Math.floor(hours / 24) });
}

/**
 * The queue per office. `summary` is a branch's own single row, which has no
 * fallback or age figures; counts link to the close-the-register queue only
 * for the central office, the one that has that page.
 */
export function OfficeTable({
  rows,
  summary = false,
  linkCounts,
  lang,
  t,
}: {
  rows: OfficeRow[];
  summary?: boolean;
  linkCounts: boolean;
  lang: Locale;
  t: T;
}) {
  const [sort, setSort] = useState<{ key: OfficeSortKey; dir: SortDir }>({ key: 'officeCode', dir: 'asc' });
  const sorted = useMemo(() => sortOfficeRows(rows, sort.key, sort.dir), [rows, sort]);
  const columns = COLUMNS.filter((c) => !summary || c.summary);
  const numbers = new Intl.NumberFormat(lang);

  function toggle(key: OfficeSortKey) {
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  }

  function count(row: OfficeRow, kind: QueueKind | undefined, value: number) {
    const text = numbers.format(value);
    if (!linkCounts || !kind || value === 0 || row.officeCode === null) return text;
    const query = new URLSearchParams({ office: row.officeCode, kind });
    return (
      <Link
        href={`/${lang}/government/changes?${query}`}
        className="text-authority underline underline-offset-4"
      >
        {text}
      </Link>
    );
  }

  if (rows.length === 0) return <p className="text-sm text-steel">{t.queueEmpty}</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="border-b border-hairline text-xs text-steel">
          <tr>
            {columns.map((c) => {
              const active = sort.key === c.key;
              const label = t[c.label] as string;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className={`px-4 py-2 font-medium ${c.key === 'officeCode' ? '' : 'text-right'}`}
                >
                  {rows.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      aria-label={format(t.sortBy, { column: label })}
                      className="inline-flex items-center gap-1 hover:text-ink"
                    >
                      {label}
                      {active ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp className="h-3 w-3" aria-hidden />
                        ) : (
                          <ArrowDown className="h-3 w-3" aria-hidden />
                        )
                      ) : null}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-whisper">
          {sorted.map((row) => (
            <tr key={row.officeCode ?? 'unassigned'}>
              {columns.map((c) =>
                c.key === 'officeCode' ? (
                  <th key={c.key} scope="row" className="px-4 py-2 text-left font-normal">
                    {row.officeCode ? (
                      <>
                        <span className="font-mono text-xs">{row.officeCode}</span>
                        {row.officeName ? <span className="ml-2 text-steel">{row.officeName}</span> : null}
                      </>
                    ) : (
                      <span className="text-steel">{t.unassigned}</span>
                    )}
                  </th>
                ) : (
                  <td key={c.key} className="px-4 py-2 text-right font-mono text-xs">
                    {c.key === 'oldestAgeHours'
                      ? ageText(row.oldestAgeHours, t)
                      : count(row, c.kind, row[c.key])}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
