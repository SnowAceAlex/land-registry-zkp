'use client';

/**
 * features/resident/lookup/components/lookup-search.tsx - the stateful half.
 *
 * Split out so `lookup-view.tsx` stays a Server Component (its TODO asked for
 * exactly this). No wallet and no key: both routes are public (D39/D48/D50).
 *
 * The record and the lineage are fetched together. Either alone is misleading —
 * a history with no current status does not say whether the certificate is
 * revoked *now*, and a status with no history does not say how it got there.
 * The lineage spans every certificate of the land (D90), so a re-issued
 * certificate does not look clean.
 */

import { History, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
// Not from the shared barrel: that re-exports merkleTree.ts, whose top-level
// circomlibjs import would pull ~3 MB of cryptography into a page that hashes
// nothing. treeDimensions.ts is dependency-free for exactly this.
import { MAX_PROPERTY_ID } from '@land-registry/blockchain/shared/treeDimensions';
import { EmptyState } from '@/components/ui/empty-state';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonStyles } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { format } from '@/i18n/format';

import { type RecordPublic, getLineage, getPublicRecord } from '../api';
import { isRevoked } from '../lib/event-summary';
import { type LandTimelineSection, buildLandTimeline } from '../lib/land-timeline';
import { LandTimeline } from './land-timeline';
import { RecordSummary } from './record-summary';
import { residentFailure } from '../../shell/resident-error';

type Strings = Dictionary['residentLookup'];

type State =
  | { status: 'idle' }
  | { status: 'searching' }
  | {
      status: 'found';
      record: RecordPublic;
      sections: LandTimelineSection[];
      truncated: boolean;
    }
  | { status: 'not-found' }
  | { status: 'failed'; title: string; detail?: string };

/** A property id is a leaf index, so the tree's range is the whole validation. */
function invalidId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return true;
  return BigInt(trimmed) > MAX_PROPERTY_ID;
}

export function LookupSearch({
  lang,
  t,
  errors,
  revocation,
}: {
  lang: string;
  t: Strings;
  errors: Dictionary['residentErrors'];
  revocation: Dictionary['residentRevocation'];
}) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });
  const [showInvalid, setShowInvalid] = useState(false);

  const malformed = value.trim() !== '' && invalidId(value);

  // Only the latest search may write state: a slow answer must not replace a newer one.
  const latest = useRef(0);

  // The clicked id button disappears with the old results; put focus on the new ones.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (state.status === 'found') headingRef.current?.focus();
  }, [state]);

  const maxId = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US').format(MAX_PROPERTY_ID);

  async function lookUp(propertyId: string) {
    const ticket = ++latest.current;
    setShowInvalid(false);
    setState({ status: 'searching' });

    try {
      const [record, lineage] = await Promise.all([
        getPublicRecord(propertyId),
        getLineage(propertyId),
      ]);
      if (ticket !== latest.current) return;
      const { sections, truncated } = buildLandTimeline(lineage);
      setState({ status: 'found', record, sections, truncated });
    } catch (error) {
      if (ticket !== latest.current) return;
      // 404 is an answer, not a failure: the plot does not exist.
      if (error instanceof ApiError && error.status === 404) {
        setState({ status: 'not-found' });
        return;
      }
      setState({ status: 'failed', ...residentFailure(error, errors) });
    }
  }

  function search(event: React.FormEvent) {
    event.preventDefault();
    const propertyId = value.trim();

    if (propertyId === '' || invalidId(propertyId)) {
      setShowInvalid(true);
      return;
    }
    void lookUp(propertyId);
  }

  // A certificate id clicked in the timeline: same search, input kept in step.
  function select(propertyId: string) {
    setValue(propertyId);
    void lookUp(propertyId);
  }

  return (
    <div className="space-y-8">
      <form onSubmit={search} className="max-w-xl space-y-2">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="property-id" className="sr-only">
              {t.label}
            </label>
            <input
              id="property-id"
              name="property-id"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="1001"
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setShowInvalid(false);
              }}
              aria-describedby={showInvalid || malformed ? 'property-id-error' : undefined}
              aria-invalid={showInvalid || malformed || undefined}
              className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 font-mono text-sm text-ink ui-transition placeholder:text-zinc-400 focus:border-authority aria-invalid:border-red-400"
            />
          </div>
          <button
            type="submit"
            disabled={state.status === 'searching'}
            className={buttonStyles.primary}
          >
            {state.status === 'searching' ? (
              <span className="inline-flex items-center gap-2">
                <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
                {t.searching}
              </span>
            ) : (
              t.search
            )}
          </button>
        </div>

        {showInvalid || malformed ? (
          <p id="property-id-error" role="alert" className="text-xs text-red-700">
            {format(t.invalidId, { max: maxId })}
          </p>
        ) : null}
      </form>

      {state.status === 'idle' ? (
        <EmptyState icon={History} title={t.emptyTitle} description={format(t.emptyBody, { max: maxId })} />
      ) : null}

      {state.status === 'searching' ? (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {state.status === 'not-found' ? (
        <Notice tone="warning" title={t.notFoundTitle}>
          {t.notFoundBody}
        </Notice>
      ) : null}

      {state.status === 'failed' ? (
        <Notice tone="danger" title={state.title}>
          {state.detail}
        </Notice>
      ) : null}

      {state.status === 'found' ? (
        <div className="space-y-8">
          {/* Stated up front, not left for the reader to infer from the
              timeline: a revoked plot cannot be proven at all. */}
          {isRevoked(state.sections.find((section) => section.isQueried)?.events ?? []) ||
          state.record.status === 'REVOKED' ? (
            <Notice tone="danger" title={t.revokedBannerTitle}>
              {t.revokedBannerBody}
            </Notice>
          ) : null}

          <RecordSummary record={state.record} t={t} headingRef={headingRef} />
          <LandTimeline
            sections={state.sections}
            truncated={state.truncated}
            lang={lang}
            t={t}
            revocation={revocation}
            onSelect={select}
          />
        </div>
      ) : null}
    </div>
  );
}
