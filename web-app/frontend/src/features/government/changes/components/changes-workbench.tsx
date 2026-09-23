'use client';

/**
 * UC-4 interaction. Like issuance, the screen follows the open draft (D44):
 *   - a change set draft is open → DraftPanel (signs publishRootWithRevocations
 *     when the round revokes anything, publishRoot otherwise);
 *   - an issuance draft is open  → blocked, with a link to it;
 *   - no draft                   → the queue and "Draft a change set".
 * Revocation requests can be queued in every state; they wait for a round.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderSync, LoaderCircle } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { type Failure, apiFailure } from '../../api/error-message';
import { govKeys, useOpenDraft, usePendingTransferCount } from '../../api/hooks';
import type { ChangeSetDraftDetail, PendingChanges } from '../../api/types';
import { type DraftOutcome, DraftPanel } from '../../publishing/components/draft-panel';
import {
  confirmChangeSetDraft,
  createChangeSetDraft,
  discardChangeSetDraft,
  getPendingChanges,
} from '../api';
import { RevocationForm } from './revocation-form';

type Strings = Dictionary['govChanges'];
type Message = { tone: 'success' | 'info'; title: string; detail?: string };

const reasonLabel = (t: Strings, code: number) =>
  code >= 1 && code <= 5 ? t[`reason${code as 1 | 2 | 3 | 4 | 5}`] : String(code);

export function ChangesWorkbench({
  lang,
  t,
  draftT,
  errors,
}: {
  lang: Locale;
  t: Strings;
  draftT: Dictionary['govDraft'];
  errors: Dictionary['govErrors'];
}) {
  const queryClient = useQueryClient();
  const openDraft = useOpenDraft();
  const pendingTransfers = usePendingTransferCount();
  const pending = useQuery({ queryKey: govKeys.pendingChanges, queryFn: getPendingChanges });
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: govKeys.openDraft }),
      queryClient.invalidateQueries({ queryKey: govKeys.status }),
      queryClient.invalidateQueries({ queryKey: govKeys.pendingChanges }),
      queryClient.invalidateQueries({ queryKey: ['gov', 'transfers'] }),
    ]);
  }

  async function create() {
    setCreating(true);
    setFailure(null);
    setMessage(null);
    try {
      const draft = await createChangeSetDraft();
      queryClient.setQueryData(govKeys.openDraft, draft);
      await refresh();
    } catch (error) {
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
        ) : draft?.kind === 'changeset' ? (
          <DraftPanel
            key={draft.id}
            draft={draft}
            t={draftT}
            errors={errors}
            summary={<DraftSummary draft={draft} t={t} />}
            warnings={
              <>
                {draft.revocationIds.length > 0 ? (
                  <Notice tone="warning" title={t.revocationsPermanent} />
                ) : null}
                {pendingTransfers.data ? (
                  <Notice
                    tone="warning"
                    title={format(draftT.pendingTransfers, { count: pendingTransfers.data })}
                  />
                ) : null}
                <Notice tone="info" title={draftT.invalidatesProofs} />
              </>
            }
            onConfirm={confirmChangeSetDraft}
            onDiscard={discardChangeSetDraft}
            onSettled={settled}
          />
        ) : draft?.kind === 'issuance' ? (
          <Notice
            tone="warning"
            title={format(t.blockedTitle, { id: draft.id })}
            action={
              <Link
                href={`/${lang}/government/issuance`}
                className="text-sm font-medium text-authority underline underline-offset-4"
              >
                {t.openIssuance}
              </Link>
            }
          >
            {t.blockedBody}
          </Notice>
        ) : pending.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : pending.error ? (
          <Notice tone="danger" title={t.loadError} />
        ) : (
          <PendingQueue pending={pending.data} t={t} creating={creating} onCreate={create} />
        )}
      </div>

      <RevocationForm t={t} errors={errors} />
    </div>
  );
}

function DraftSummary({ draft, t }: { draft: ChangeSetDraftDetail; t: Strings }) {
  const { propertyIds, reasonCodes } = draft.revocationCalldata;
  return (
    <div className="space-y-3 text-sm">
      {draft.transferIds.length > 0 ? (
        <p className="text-ink">
          {format(t.draftTransfers, {
            count: draft.transferIds.length,
            ids: draft.transferIds.map((id) => `#${id}`).join(', '),
          })}
        </p>
      ) : null}
      {propertyIds.length > 0 ? (
        <div>
          <p className="text-ink">{format(t.draftRevocations, { count: propertyIds.length })}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-steel">
            {propertyIds.map((propertyId, index) => (
              <li key={propertyId}>
                <span className="font-mono text-ink">{propertyId}</span> — {reasonLabel(t, reasonCodes[index])}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {draft.deferredRevocations > 0 ? (
        <Notice tone="info" title={format(t.draftDeferred, { count: draft.deferredRevocations })} />
      ) : null}
    </div>
  );
}

function PendingQueue({
  pending,
  t,
  creating,
  onCreate,
}: {
  pending: PendingChanges;
  t: Strings;
  creating: boolean;
  onCreate: () => void;
}) {
  const { transfers, revocations } = pending;

  if (transfers.length === 0 && revocations.length === 0) {
    return <EmptyState icon={FolderSync} title={t.emptyTitle} description={t.emptyBody} />;
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-medium text-ink">{t.pendingTitle}</h2>
          {revocations.length > 50 ? <p className="mt-1 text-sm text-steel">{t.capNote}</p> : null}
        </div>
        <button type="button" className={buttonStyles.primary} disabled={creating} onClick={onCreate}>
          {creating ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              {t.creating}
            </>
          ) : (
            t.createDraft
          )}
        </button>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-ink">{t.transfersTitle}</h3>
        {transfers.length === 0 ? (
          <p className="text-sm text-steel">{t.noTransfers}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-hairline text-xs text-steel">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colRequest}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colProperty}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colBuyer}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colApproved}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-whisper">
                {transfers.map((transfer) => (
                  <tr key={transfer.id}>
                    <td className="px-4 py-2 font-mono text-xs">#{transfer.id}</td>
                    <td className="px-4 py-2 font-mono text-xs">{transfer.propertyId}</td>
                    <td className="px-4 py-2">
                      <HashText value={transfer.newOwnerCommitment} />
                    </td>
                    <td className="px-4 py-2 text-xs text-steel">
                      {transfer.decidedAt ? new Date(transfer.decidedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-ink">{t.revocationsTitle}</h3>
        {revocations.length === 0 ? (
          <p className="text-sm text-steel">{t.noRevocations}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-hairline text-xs text-steel">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colProperty}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colReason}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colDetail}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colDetailHash}</th>
                  <th scope="col" className="px-4 py-2 font-medium">{t.colRequested}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-whisper">
                {revocations.map((revocation) => (
                  <tr key={revocation.id} className="align-top">
                    <td className="px-4 py-2 font-mono text-xs">{revocation.propertyId}</td>
                    <td className="px-4 py-2">{reasonLabel(t, revocation.reasonCode)}</td>
                    <td className="max-w-[16rem] px-4 py-2 break-words text-ink">{revocation.detailText}</td>
                    <td className="px-4 py-2">
                      <HashText value={revocation.detailHash} />
                    </td>
                    <td className="px-4 py-2 text-xs text-steel">
                      {new Date(revocation.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
