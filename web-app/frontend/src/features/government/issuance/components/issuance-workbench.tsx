'use client';

/**
 * UC-1 interaction. What the screen offers depends on the open draft (D44):
 *   - an issuance draft is open  → DraftPanel: sign, confirm, or discard it;
 *   - a change set draft is open → blocked, with a link to that draft;
 *   - no draft                   → pick IMPORTED properties and create one.
 * The round history with its archive downloads sits underneath in every case.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { type Failure, apiFailure } from '../../api/error-message';
import { govKeys, useOpenDraft, usePendingTransferCount } from '../../api/hooks';
import { type DraftOutcome, DraftPanel } from '../../publishing/components/draft-panel';
import { confirmIssuanceDraft, createIssuanceDraft, discardIssuanceDraft } from '../api';
import { BatchHistory } from './batch-history';
import { PropertyPicker } from './property-picker';

type Message = { tone: 'success' | 'info'; title: string; detail?: string };

export function IssuanceWorkbench({
  lang,
  t,
  draftT,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govIssuance'];
  draftT: Dictionary['govDraft'];
  errors: Dictionary['govErrors'];
}) {
  const queryClient = useQueryClient();
  const openDraft = useOpenDraft();
  const pendingTransfers = usePendingTransferCount();
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: govKeys.openDraft }),
      queryClient.invalidateQueries({ queryKey: govKeys.status }),
      queryClient.invalidateQueries({ queryKey: govKeys.issuanceBatches }),
      queryClient.invalidateQueries({ queryKey: ['gov', 'properties'] }),
    ]);
  }

  async function create(propertyIds: string[]) {
    setCreating(true);
    setFailure(null);
    setMessage(null);
    try {
      const draft = await createIssuanceDraft(propertyIds);
      queryClient.setQueryData(govKeys.openDraft, draft);
      await refresh();
    } catch (error) {
      // 409 is most often another officer's draft opened meanwhile (D44):
      // refreshing turns this screen into the "blocked" view that explains it.
      setFailure(apiFailure(error, errors));
      await refresh();
    } finally {
      setCreating(false);
    }
  }

  async function settled(outcome: DraftOutcome) {
    setMessage(
      outcome.kind === 'confirmed'
        ? {
            tone: 'success',
            title: format(t.confirmedTitle, {
              id: outcome.confirmation.id,
              version: outcome.confirmation.rootVersion,
            }),
            detail: t.confirmedBody,
          }
        : { tone: 'info', title: t.discardedTitle },
    );
    await refresh();
  }

  const draft = openDraft.data;

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        {message ? (
          <Notice tone={message.tone} title={message.title}>
            {message.detail}
          </Notice>
        ) : null}
        {failure ? (
          <Notice tone="danger" title={failure.title}>
            {failure.detail}
          </Notice>
        ) : null}

        {openDraft.isPending ? (
          <Skeleton className="h-48 w-full" />
        ) : openDraft.error ? (
          <Notice tone="danger" title={apiFailure(openDraft.error, errors).title} />
        ) : draft?.kind === 'issuance' ? (
          <DraftPanel
            key={draft.id}
            draft={draft}
            t={draftT}
            errors={errors}
            summary={
              <div className="space-y-2 text-sm">
                <p className="text-ink">{format(t.draftSummary, { count: draft.propertyIds.length })}</p>
                <p className="font-mono text-xs leading-relaxed break-words text-steel">
                  {draft.propertyIds.join(', ')}
                </p>
              </div>
            }
            warnings={
              <>
                <Notice tone="warning" title={t.archiveWarning} />
                {pendingTransfers.data ? (
                  <Notice
                    tone="warning"
                    title={format(draftT.pendingTransfers, { count: pendingTransfers.data })}
                  />
                ) : null}
                <Notice tone="info" title={draftT.invalidatesProofs} />
              </>
            }
            onConfirm={confirmIssuanceDraft}
            onDiscard={discardIssuanceDraft}
            onSettled={settled}
          />
        ) : draft?.kind === 'changeset' ? (
          <Notice
            tone="warning"
            title={format(t.blockedTitle, { id: draft.id })}
            action={
              <Link
                href={`/${lang}/government/changes`}
                className="text-sm font-medium text-authority underline underline-offset-4"
              >
                {t.openChanges}
              </Link>
            }
          >
            {t.blockedBody}
          </Notice>
        ) : (
          <PropertyPicker lang={lang} t={t} creating={creating} onCreate={create} />
        )}
      </div>

      <BatchHistory t={t} errors={errors} />
    </div>
  );
}
