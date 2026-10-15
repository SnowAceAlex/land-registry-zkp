'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

import { apiFailure } from '../../api/error-message';
import { govKeys, useArchives, useMe } from '../../api/hooks';
import type { ArchiveSummary } from '../../api/types';
import { downloadArchive } from '../api';
import { ArchiveTable } from './archive-table';

/** Round archives (D88): each office downloads its own; the central office may fetch any as a fallback. */
export function ArchivesView({
  lang,
  t,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govArchives'];
  errors: Dictionary['govErrors'];
}) {
  const archives = useArchives();
  const me = useMe();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<string | null>(null);

  const download = useMutation({
    mutationFn: (a: ArchiveSummary) => downloadArchive(a.changeSetId, a.officeCode),
    // Even a failed download can change the picture (a 410 means it just expired).
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: govKeys.archives }),
        queryClient.invalidateQueries({ queryKey: govKeys.overview }),
      ]),
  });

  function onDownload(a: ArchiveSummary) {
    setActive(`${a.changeSetId}:${a.officeCode}`);
    download.mutate(a, { onSettled: () => setActive(null) });
  }

  const failure = archives.error ?? me.error;

  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />

      <Notice tone="warning" title={t.warningTitle}>
        {t.warning}
      </Notice>

      {download.error ? <Notice tone="danger" title={apiFailure(download.error, errors).title} /> : null}

      {failure ? (
        <Notice tone="danger" title={apiFailure(failure, errors).title} />
      ) : !archives.data || !me.data ? (
        <Skeleton className="h-48 w-full" />
      ) : archives.data.length === 0 ? (
        <p className="text-sm text-steel">{t.empty}</p>
      ) : (
        <ArchiveTable
          rows={archives.data}
          showOffice={me.data.scope === 'CENTRAL'}
          now={new Date()}
          lang={lang}
          t={t}
          downloading={active}
          onDownload={onDownload}
        />
      )}
    </div>
  );
}
