'use client';

/**
 * UC-1 interaction: pick IMPORTED properties and queue them for issuance (D87).
 * The signing step moved to the round (D84); Task 4 of Phase 10 rebuilds this screen.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { Notice } from '@/components/ui/notice';

import { type Failure, apiFailure } from '../../api/error-message';
import { requestIssuance } from '../api';
import { PropertyPicker } from './property-picker';

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

  async function create(propertyIds: string[]) {
    setCreating(true);
    setFailure(null);
    setQueued(null);
    try {
      const requests = await requestIssuance(propertyIds);
      setQueued(requests.length);
      await queryClient.invalidateQueries({ queryKey: ['gov'] });
    } catch (error) {
      setFailure(apiFailure(error, errors));
    } finally {
      setCreating(false);
    }
  }

  return (
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
  );
}
