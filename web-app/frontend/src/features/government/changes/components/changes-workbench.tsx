'use client';

/**
 * "Chốt sổ" interaction. The screen follows the open draft (D44, D84):
 *   - a draft is open → DraftPanel (signs publishRootWithRevocations when the
 *     round revokes anything, publishRoot otherwise);
 *   - no draft        → what the round would carry, the overview alerts that
 *     gate it, the waiting items (hold / release) and "Create the round".
 * A draft is immutable: to drop an item, hold it, discard the draft, create again.
 * The history below lists every round with how many of its archives were downloaded.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderSync, LoaderCircle } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { buttonStyles } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { type AlertStrings, alertText } from '../../api/alert-text';
import { type Failure, apiFailure } from '../../api/error-message';
import {
  govKeys,
  useOpenDraft,
  useOverview,
  usePendingChanges,
  usePendingTransferCount,
} from '../../api/hooks';
import type { ChangeSetDraftDetail } from '../../api/types';
import { type DraftOutcome, DraftPanel } from '../../publishing/components/draft-panel';
import { confirmChangeSetDraft, createChangeSetDraft, discardChangeSetDraft } from '../api';
import { composeRound } from '../lib/round-composition';
import { roundGate } from '../lib/round-gate';
import { ChangeSetHistory } from './changeset-history';
import { QueueTable } from './queue-table';

type Strings = Dictionary['govChanges'];
type Message = { tone: 'success' | 'info'; title: string; detail?: string };

const reasonLabel = (t: Strings, code: number) =>
  code >= 1 && code <= 5 ? t[`reason${code as 1 | 2 | 3 | 4 | 5}`] : String(code);

export function ChangesWorkbench({
  lang,
  t,
  draftT,
  alertT,
  errors,
}: {
  lang: Locale;
  t: Strings;
  draftT: Dictionary['govDraft'];
  alertT: AlertStrings;
  errors: Dictionary['govErrors'];
}) {
  const queryClient = useQueryClient();
  const openDraft = useOpenDraft();
  const pendingTransfers = usePendingTransferCount();
  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  /** Revocations the last confirmed round left behind (D56); offers the next round. */
  const [leftover, setLeftover] = useState(0);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: govKeys.openDraft }),
      queryClient.invalidateQueries({ queryKey: govKeys.status }),
      queryClient.invalidateQueries({ queryKey: govKeys.pendingChanges }),
      queryClient.invalidateQueries({ queryKey: govKeys.changeSets }),
      queryClient.invalidateQueries({ queryKey: govKeys.overview }),
      queryClient.invalidateQueries({ queryKey: govKeys.offices }),
      queryClient.invalidateQueries({ queryKey: ['gov', 'queue'] }),
      queryClient.invalidateQueries({ queryKey: ['gov', 'transfers'] }),
    ]);
  }

  async function create() {
    setCreating(true);
    setFailure(null);
    setMessage(null);
    setLeftover(0);
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

  const draft = openDraft.data;

  async function settled(outcome: DraftOutcome) {
    if (outcome.kind === 'confirmed') {
      setLeftover(draft?.deferredRevocations ?? 0);
      setMessage({
        tone: 'success',
        title: format(t.confirmedTitle, {
          id: outcome.confirmation.id,
          version: outcome.confirmation.rootVersion,
        }),
        detail: t.confirmedBody,
      });
    } else {
      setMessage({ tone: 'info', title: t.discardedTitle });
    }
    await refresh();
  }

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
        ) : draft ? (
          <DraftPanel
            key={draft.id}
            draft={draft}
            t={draftT}
            errors={errors}
            summary={<DraftSummary draft={draft} t={t} />}
            warnings={
              <>
                {draft.transferIds.length > 0 || draft.issuanceRequestIds.length > 0 ? (
                  <Notice tone="warning" title={t.archiveWarning} />
                ) : null}
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
        ) : (
          <RoundCreator
            t={t}
            alertT={alertT}
            creating={creating}
            leftover={leftover}
            onCreate={create}
          />
        )}
      </div>

      {!openDraft.isPending && !draft ? <QueueTable t={t} errors={errors} /> : null}

      <ChangeSetHistory lang={lang} t={t} errors={errors} />
    </div>
  );
}

function DraftSummary({ draft, t }: { draft: ChangeSetDraftDetail; t: Strings }) {
  const { propertyIds, reasonCodes } = draft.revocationCalldata;
  return (
    <div className="space-y-3 text-sm">
      {draft.issuanceRequestIds.length > 0 ? (
        <p className="text-ink">
          {format(t.draftIssuances, { count: draft.issuanceRequestIds.length })}
        </p>
      ) : null}
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
                <span className="font-mono text-ink">{propertyId}</span> —{' '}
                {reasonLabel(t, reasonCodes[index])}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {draft.deferredRevocations > 0 ? (
        <Notice
          tone="info"
          title={format(t.draftDeferred, {
            count: draft.deferredRevocations,
            cap: propertyIds.length,
          })}
        />
      ) : null}
    </div>
  );
}

function RoundCreator({
  t,
  alertT,
  creating,
  leftover,
  onCreate,
}: {
  t: Strings;
  alertT: AlertStrings;
  creating: boolean;
  leftover: number;
  onCreate: () => void;
}) {
  const pending = usePendingChanges();
  const overview = useOverview();
  const [acknowledged, setAcknowledged] = useState(false);

  if (pending.isPending) return <Skeleton className="h-40 w-full" />;
  if (pending.error) return <Notice tone="danger" title={t.loadError} />;

  const round = composeRound(pending.data);
  const total = round.byKind.issuance + round.byKind.transfer + round.byKind.revocation;

  if (total === 0) {
    return <EmptyState icon={FolderSync} title={t.emptyTitle} description={t.emptyBody} />;
  }

  const gate = overview.data ? roundGate(overview.data.alerts) : null;
  const canCreate =
    gate !== null && (gate.state === 'clear' || (gate.state === 'needs-ack' && acknowledged));

  return (
    <section className="space-y-6">
      <h2 className="font-medium text-ink">{t.composeTitle}</h2>

      {leftover > 0 ? <Notice tone="info" title={format(t.nextRoundHint, { count: leftover })} /> : null}

      <Composition round={round} cap={pending.data.revocationCap} t={t} />

      {overview.error ? <Notice tone="danger" title={t.gateError} /> : null}
      {gate && gate.state !== 'clear' ? (
        <div className="space-y-2">
          <Notice
            tone={gate.state === 'blocked' ? 'danger' : 'warning'}
            title={gate.state === 'blocked' ? t.gateBlockedTitle : t.gateAckTitle}
          />
          <ul className="space-y-2">
            {gate.reasons.map((alert) => {
              const { tone, title } = alertText(alert, alertT);
              return (
                <li key={`${alert.code}:${alert.officeCode ?? ''}:${alert.ref ?? ''}`}>
                  <Notice tone={tone} title={title} />
                </li>
              );
            })}
          </ul>
          {gate.state === 'needs-ack' ? (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              {t.gateAck}
            </label>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className={buttonStyles.primary}
        disabled={creating || !canCreate}
        onClick={onCreate}
      >
        {creating ? (
          <>
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            {t.creating}
          </>
        ) : leftover > 0 ? (
          t.createNext
        ) : (
          t.createDraft
        )}
      </button>
    </section>
  );
}

function Composition({
  round,
  cap,
  t,
}: {
  round: ReturnType<typeof composeRound>;
  cap: number;
  t: Strings;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full text-left text-sm">
            <caption className="px-4 pt-3 text-left text-xs font-medium text-steel">
              {t.byKindTitle}
            </caption>
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t.colKind}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colCount}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              <tr>
                <td className="px-4 py-2">{t.kindIssuance}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{round.byKind.issuance}</td>
              </tr>
              <tr>
                <td className="px-4 py-2">{t.kindTransfer}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{round.byKind.transfer}</td>
              </tr>
              <tr>
                <td className="px-4 py-2">{t.kindRevocation}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{round.byKind.revocation}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
          <table className="w-full text-left text-sm">
            <caption className="px-4 pt-3 text-left text-xs font-medium text-steel">
              {t.byOfficeTitle}
            </caption>
            <thead className="border-b border-hairline text-xs text-steel">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">{t.colOffice}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colIssuance}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colTransfers}</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">{t.colRevocations}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-whisper">
              {round.byOffice.map((row) => (
                <tr key={row.officeCode ?? 'unassigned'}>
                  <td className="px-4 py-2 font-mono text-xs">{row.officeCode ?? t.unassigned}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{row.issuance}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{row.transfer}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{row.revocation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {round.deferredRevocations > 0 ? (
        <Notice
          tone="info"
          title={format(t.deferredNote, {
            count: round.deferredRevocations,
            cap,
          })}
        />
      ) : null}
    </div>
  );
}
