'use client';

/**
 * features/government/shell/components/registry-status-bar.tsx
 *
 * The facts every operation depends on, visible on every government page:
 * which chain the registry is on (D54), the published root version, whether
 * the database agrees with the chain, and whether a draft is already waiting
 * (D44 — at most one, so it blocks the next publish wherever it was started).
 * The wallet button lives here too: signing is a portal-wide concern, not a
 * per-page one.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from '@rainbow-me/rainbowkit';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { useOpenDraft, useRegistryStatus } from '../../api/hooks';

export function RegistryStatusBar({ lang, t }: { lang: Locale; t: Dictionary['govShell'] }) {
  const status = useRegistryStatus();
  const openDraft = useOpenDraft();
  const pathname = usePathname();

  const draft = openDraft.data;
  const draftHref = draft
    ? `/${lang}/government/${draft.kind === 'issuance' ? 'issuance' : 'changes'}`
    : null;
  const onDraftPage = draftHref !== null && pathname.startsWith(draftHref);

  return (
    <div className="mb-8 space-y-3">
      <div className="flex flex-col gap-3 border-b border-whisper pb-4 sm:flex-row sm:items-center sm:justify-between">
        {status.data ? (
          <ul
            aria-label={t.network}
            className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-steel"
          >
            <li className="font-mono">
              <span className="text-ink">{status.data.network}</span>{' '}
              {format(t.chain, { chainId: status.data.chainId })}
            </li>
            <li className="font-mono">
              {status.data.onChain.version > 0
                ? format(t.rootVersion, { version: status.data.onChain.version })
                : t.noRoot}
            </li>
            {status.data.inSync ? <li>{t.inSync}</li> : null}
          </ul>
        ) : status.isPending ? (
          <Skeleton className="h-4 w-64" />
        ) : (
          <span />
        )}
        <ConnectButton label={t.connectWallet} showBalance={false} chainStatus="icon" accountStatus="address" />
      </div>

      {status.error ? (
        <Notice tone="danger" title={t.statusUnavailable} />
      ) : null}

      {status.data && !status.data.inSync ? (
        <Notice tone="warning" title={t.outOfSyncTitle}>
          {t.outOfSyncBody}
        </Notice>
      ) : null}

      {draft && draftHref && !onDraftPage ? (
        <Notice
          tone="info"
          title={format(draft.kind === 'issuance' ? t.draftOpenIssuance : t.draftOpenChangeset, {
            id: draft.id,
          })}
          action={
            <Link href={draftHref} className="text-sm font-medium text-authority underline underline-offset-4">
              {t.openDraft}
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
