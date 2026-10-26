/**
 * features/resident/lookup/components/land-timeline.tsx - the land's history
 * across certificates (D48, D90).
 *
 * One section per certificate. A re-issued certificate gets a new number, so
 * one piece of land's history spans several. A revocation shows its reason CODE
 * and the hash of the written explanation — never the explanation, which stays
 * off chain and off this route by design (D45).
 */

import { FileCheck2, FileX2, Repeat2, ScrollText, Timer } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';

import type { PropertyEvent, PropertyEventKind } from '../api';
import { summariseEvent } from '../lib/event-summary';
import type { LandTimelineSection } from '../lib/land-timeline';

type Strings = Dictionary['residentLookup'];
type RevocationStrings = Dictionary['residentRevocation'];

const KINDS = {
  ISSUED: { label: 'event_ISSUED', icon: FileCheck2 },
  TRANSFERRED: { label: 'event_TRANSFERRED', icon: Repeat2 },
  REVOKED: { label: 'event_REVOKED', icon: FileX2 },
  ENCUMBRANCE_CHANGED: { label: 'event_ENCUMBRANCE_CHANGED', icon: ScrollText },
  VALIDITY_CHANGED: { label: 'event_VALIDITY_CHANGED', icon: Timer },
} as const satisfies Record<PropertyEventKind, { label: keyof Strings; icon: unknown }>;

const STATUS_KEYS = {
  IMPORTED: 'status_IMPORTED',
  ISSUED: 'status_ISSUED',
  REVOKED: 'status_REVOKED',
} as const satisfies Record<LandTimelineSection['status'], keyof Strings>;

/** The five reason codes are dictionary keys; anything else is unrecorded. */
function reasonLabel(code: number | undefined, t: RevocationStrings): string {
  const key = `reason_${code}` as keyof RevocationStrings;
  return code !== undefined && key in t ? t[key] : t.reason_unknown;
}

function formatWhen(iso: string, lang: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function EventRow({
  event,
  lang,
  t,
  revocation,
}: {
  event: PropertyEvent;
  lang: string;
  t: Strings;
  revocation: RevocationStrings;
}) {
  const summary = summariseEvent(event);
  const { label, icon: Icon } = KINDS[event.kind];

  return (
    <li className="rounded-lg border border-hairline bg-surface px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Icon className="h-4 w-4 shrink-0 translate-y-0.5 text-steel" strokeWidth={1.75} aria-hidden />
        <p className="text-sm font-medium text-ink">{t[label]}</p>
        <p className="text-xs text-steel">{formatWhen(event.occurredAt, lang)}</p>
        {summary.published ? (
          <p className="text-xs text-steel">
            {t.colRootVersion} <span className="font-mono">{event.rootVersion}</span>
          </p>
        ) : (
          // Recorded but never published: a signed-but-unconfirmed
          // draft, or a crash between signing and confirming (D43).
          <p className="text-xs text-amber-700">{t.notPublishedYet}</p>
        )}
      </div>

      <dl className="mt-2 space-y-1 pl-7 text-xs text-steel">
        {summary.ownerChanged && event.newOwnerCommitment ? (
          <div className="flex flex-wrap gap-x-2">
            <dt>{t.ownerChanged}</dt>
            <dd className="text-ink">
              <HashText value={event.newOwnerCommitment} head={10} tail={6} />
            </dd>
          </div>
        ) : null}

        {summary.leafChanged && event.newLeaf ? (
          <div className="flex flex-wrap gap-x-2">
            <dt>{t.leafChanged}</dt>
            <dd className="text-ink">
              <HashText value={event.newLeaf} head={10} tail={6} />
            </dd>
          </div>
        ) : null}

        {event.kind === 'REVOKED' ? (
          <>
            <div className="flex flex-wrap gap-x-2">
              <dt>{revocation.reasonLabel}</dt>
              <dd className="text-ink">{reasonLabel(summary.reasonCode, revocation)}</dd>
            </div>
            {summary.detailHash ? (
              <div className="flex flex-wrap gap-x-2">
                <dt>{revocation.detailHash}</dt>
                <dd className="text-ink">
                  <HashText value={summary.detailHash} head={10} tail={6} />
                </dd>
              </div>
            ) : null}
          </>
        ) : null}

        <div className="flex flex-wrap gap-x-2">
          <dt>{t.colTransaction}</dt>
          <dd className="text-ink">
            {event.txHash ? (
              <HashText value={event.txHash} head={10} tail={8} />
            ) : (
              <span className="text-steel">{t.noTransaction}</span>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function IdLinks({
  label,
  ids,
  t,
  onSelect,
}: {
  label: string;
  ids: string[];
  t: Strings;
  onSelect: (propertyId: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-steel">
      <span>{label}</span>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          aria-label={format(t.openCertificate, { id })}
          className="font-mono text-authority underline underline-offset-2 ui-transition hover:text-ink"
        >
          {id}
        </button>
      ))}
    </p>
  );
}

export function LandTimeline({
  sections,
  truncated,
  lang,
  t,
  revocation,
  onSelect,
}: {
  sections: LandTimelineSection[];
  truncated: boolean;
  lang: string;
  t: Strings;
  revocation: RevocationStrings;
  onSelect: (propertyId: string) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium tracking-tight text-ink">{t.timelineTitle}</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.reissueNote}</p>
      </div>

      {truncated ? (
        <Notice tone="warning" title={t.truncatedTitle}>
          {t.truncatedBody}
        </Notice>
      ) : null}

      <ol className="space-y-6">
        {sections.map((section) => (
          <li
            key={section.propertyId}
            aria-current={section.isQueried ? 'true' : undefined}
            className={`space-y-3 rounded-lg border px-4 py-4 ${
              section.isQueried ? 'border-authority bg-white' : 'border-hairline'
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-sm font-medium text-ink">
                {format(t.certificateTitle, { id: section.propertyId })}
              </h3>
              <p className="text-xs text-steel">{t[STATUS_KEYS[section.status]]}</p>
              {section.isQueried ? (
                <p className="text-xs font-medium text-authority">{t.queriedBadge}</p>
              ) : null}
            </div>

            <IdLinks label={t.replacesLabel} ids={section.replaces} t={t} onSelect={onSelect} />
            <IdLinks label={t.replacedByLabel} ids={section.replacedBy} t={t} onSelect={onSelect} />

            {section.events.length === 0 ? (
              <p className="text-sm text-steel">{t.timelineEmpty}</p>
            ) : (
              <ol className="space-y-3">
                {section.events.map((event, index) => (
                  <EventRow
                    key={`${event.occurredAt}-${index}`}
                    event={event}
                    lang={lang}
                    t={t}
                    revocation={revocation}
                  />
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
