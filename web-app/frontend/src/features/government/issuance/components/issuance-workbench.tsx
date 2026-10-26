'use client';

/**
 * UC-1 interaction: pick IMPORTED properties and queue them for issuance (D87).
 * Nothing is signed here; the round that publishes them is closed on the Changes page.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { Notice } from '@/components/ui/notice';

import { type Failure, apiFailure } from '../../api/error-message';
import { govKeys } from '../../api/hooks';
import { requestIssuance } from '../api';
import { PropertyPicker } from './property-picker';
import { ReadyRequests } from './ready-requests';

export function IssuanceWorkbench({
  lang,
  t,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govIssuance'];
  errors: Dictionary['govErrors'];
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [queued, setQueued] = useState<number | null>(null);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: govKeys.issuanceRequests('READY') }),
      queryClient.invalidateQueries({ queryKey: ['gov', 'properties'] }),
      queryClient.invalidateQueries({ queryKey: govKeys.overview }),
    ]);
  }

  async function create(propertyIds: string[]): Promise<boolean> {
    setCreating(true);
    setFailure(null);
    setQueued(null);
    try {
      const requests = await requestIssuance(propertyIds);
      setQueued(requests.length);
      return true;
    } catch (error) {
      setFailure(apiFailure(error, errors));
      return false;
    } finally {
      setCreating(false);
      await refresh();
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        {queued !== null ? (
          <Notice tone="success" title={format(t.queuedTitle, { count: queued })} />
        ) : null}
        {failure ? (
          <Notice tone="danger" title={failure.title}>
            {failure.detail}
          </Notice>
        ) : null}
        <PropertyPicker lang={lang} t={t} creating={creating} onCreate={create} />
      </div>
      <ReadyRequests
        t={t}
        errors={errors}
        onChanged={async () => {
          setQueued(null);
          await refresh();
        }}
      />
    </div>
  );
}
