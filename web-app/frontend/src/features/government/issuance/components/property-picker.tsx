'use client';

/**
 * Choose the IMPORTED properties to queue for issuance.
 *
 * The list is filtered server-side (`?status=IMPORTED`) so paging counts only
 * issuable plots; the selection survives paging. Plots with a READY request
 * stay IMPORTED until their round, so they show as queued and cannot be picked.
 */

import { useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileSignature, LoaderCircle } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { govKeys } from '../../api/hooks';
import { ISSUANCE_PAGE_SIZE, listImportedProperties, listIssuanceRequests } from '../api';
import { queuedPropertyIds, requestablePicks } from '../lib/queued';

export function PropertyPicker({
  lang,
  t,
  creating,
  onCreate,
}: {
  lang: Locale;
  t: Dictionary['govIssuance'];
  creating: boolean;
  onCreate: (propertyIds: string[]) => Promise<boolean>;
}) {
  const [skip, setSkip] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const page = useQuery({
    queryKey: govKeys.properties('IMPORTED', skip),
    queryFn: () => listImportedProperties(skip),
    placeholderData: keepPreviousData,
  });
  const ready = useQuery({
    queryKey: govKeys.issuanceRequests('READY'),
    queryFn: () => listIssuanceRequests('READY'),
  });
  const queued = queuedPropertyIds(ready.data);

  if (page.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  if (page.error) {
    return <Notice tone="danger" title={t.loadError} />;
  }

  const { items, total } = page.data;
  if (total === 0) {
    return (
      <EmptyState
        icon={FileSignature}
        title={t.emptyTitle}
        description={t.emptyBody}
        action={
          <Link href={`/${lang}/government/import`} className={buttonStyles.secondary}>
            {t.goToImport}
          </Link>
        }
      />
    );
  }

  const pageIds = items.map((item) => item.propertyId).filter((id) => !queued.has(id));
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggle(ids: string[], on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  const picks = requestablePicks(selected, queued);

  async function submit() {
    if (await onCreate(picks)) setSelected(new Set());
  }

  return (
    <section className="space-y-4">
      <h2 className="font-medium text-ink">{t.pickerTitle}</h2>

      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="border-b border-hairline text-xs text-steel">
            <tr>
              <th scope="col" className="w-10 px-4 py-2">
                <input
                  type="checkbox"
                  aria-label={t.selectAllOnPage}
                  checked={allOnPage}
                  disabled={creating || pageIds.length === 0}
                  onChange={(event) => toggle(pageIds, event.target.checked)}
                  className="h-4 w-4 accent-authority"
                />
              </th>
              <th scope="col" className="px-4 py-2 font-medium">{t.columnProperty}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t.columnLandUse}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t.columnAddress}</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">{t.columnArea}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t.columnTenure}</th>
              <th scope="col" className="px-4 py-2 font-medium">{t.columnEncumbrance}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-whisper">
            {items.map((item) => (
              <tr key={item.propertyId} className={selected.has(item.propertyId) ? 'bg-zinc-50' : ''}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label={format(t.selectRow, { id: item.propertyId })}
                    checked={selected.has(item.propertyId) && !queued.has(item.propertyId)}
                    disabled={creating || queued.has(item.propertyId)}
                    onChange={(event) => toggle([item.propertyId], event.target.checked)}
                    className="h-4 w-4 accent-authority"
                  />
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {item.propertyId}
                  {queued.has(item.propertyId) ? (
                    <span className="ml-2 rounded-full border border-hairline bg-zinc-50 px-2 py-0.5 font-sans text-steel">
                      {t.alreadyQueued}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{item.landUseCode}</td>
                <td className="max-w-[18rem] truncate px-4 py-2" title={item.address}>
                  {item.address}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">{item.area.toFixed(2)}</td>
                <td className="px-4 py-2 font-mono text-xs text-steel">{item.tenureType}</td>
                <td className="px-4 py-2 font-mono text-xs text-steel">{item.encumbranceStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 text-sm text-steel">
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={skip === 0 || page.isFetching}
            onClick={() => setSkip(Math.max(0, skip - ISSUANCE_PAGE_SIZE))}
          >
            {t.previous}
          </button>
          <span className="font-mono text-xs">
            {format(t.pageRange, { from: skip + 1, to: skip + items.length, total })}
          </span>
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={skip + ISSUANCE_PAGE_SIZE >= total || page.isFetching}
            onClick={() => setSkip(skip + ISSUANCE_PAGE_SIZE)}
          >
            {t.next}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-sm text-steel">{format(t.selectedCount, { count: picks.length })}</span>
          <button
            type="button"
            className={buttonStyles.primary}
            disabled={picks.length === 0 || creating}
            onClick={() => void submit()}
          >
            {creating ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                {t.requesting}
              </>
            ) : (
              t.request
            )}
          </button>
        </div>
      </div>
    </section>
  );
}
