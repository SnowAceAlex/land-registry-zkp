'use client';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

import { apiFailure } from '../../api/error-message';
import { useMe, useOfficeRows, useOverview } from '../../api/hooks';
import type { Me, Overview, OfficeRow } from '../../api/types';
import { AlertList } from './alert-list';
import { OfficeTable } from './office-table';
import { RecentRounds } from './recent-rounds';
import { RegistryCard } from './registry-card';

/** The operations page (D89): register state, coded alerts, the queue per office, recent rounds. */
export function OperationsView({
  lang,
  t,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govOperations'];
  errors: Dictionary['govErrors'];
}) {
  const overview = useOverview();
  const me = useMe();
  const isCentral = me.data?.scope === 'CENTRAL';
  const offices = useOfficeRows(isCentral);

  const failure = overview.error ?? me.error;

  return (
    <div className="space-y-10">
      <PageHeader title={t.title} description={t.description} />

      {failure ? (
        <Notice tone="danger" title={apiFailure(failure, errors).title} />
      ) : !overview.data || !me.data ? (
        <div className="space-y-6">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          <RegistryCard overview={overview.data} isCentral={isCentral} lang={lang} t={t} />
          <AlertList alerts={overview.data.alerts} t={t} />

          <section aria-labelledby="ops-queue" className="space-y-3">
            <h2 id="ops-queue" className="font-medium text-ink">
              {isCentral ? t.queueTitle : t.queueSummaryTitle}
            </h2>
            {isCentral ? (
              offices.isPending ? (
                <Skeleton className="h-48 w-full" />
              ) : offices.error ? (
                <Notice tone="danger" title={apiFailure(offices.error, errors).title} />
              ) : (
                <OfficeTable rows={offices.data} alerts={overview.data.alerts} linkCounts lang={lang} t={t} />
              )
            ) : (
              <>
                <OfficeTable
                  rows={[branchRow(me.data, overview.data.queue)]}
                  alerts={overview.data.alerts}
                  summary
                  linkCounts={false}
                  lang={lang}
                  t={t}
                />
                {overview.data.roundsNeeded > 1 ? (
                  <p className="text-sm text-steel">
                    {format(t.roundsNeeded, { rounds: overview.data.roundsNeeded })}
                  </p>
                ) : null}
              </>
            )}
          </section>

          <RecentRounds chainId={overview.data.registry.chainId} lang={lang} t={t} errors={errors} />
        </>
      )}
    </div>
  );
}

// A branch's summary is its own queue totals, shaped like one office-table row.
function branchRow({ office }: Me, queue: Overview['queue']): OfficeRow {
  return {
    officeCode: office.code,
    officeName: office.name,
    kind: office.kind,
    ...queue,
    fallback: 0,
    oldestAgeHours: null,
  };
}
