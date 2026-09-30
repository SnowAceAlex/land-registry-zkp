'use client';

/**
 * features/resident/verify/components/issuer-chain-panel.tsx — D30, four links.
 *
 * ⚠️ Link 1 is a green tick only when the certificate chains to the root CA
 *    this verifier pins (D78), and the tick names that root. Without a pinned
 *    root it renders with a NEUTRAL icon: "the certificate is genuine" is then
 *    a claim this build cannot make, and it is the most load-bearing claim on
 *    the page. `verifyReceipt.ts` makes the same distinction on the Node side.
 *
 * Rendered on the agency tab only: a receipt reveals the whole certificate,
 * including the term and encumbrance mortgage.circom exists to hide, so the
 * standard tab (buyer, bank) never asks for one.
 */

import { Check, CircleHelp, CircleSlash, LoaderCircle, X } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { format } from '@/i18n/format';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';

import type { IssuerChainReport, IssuerLink, LinkState } from '../lib/issuer-chain';

type Strings = Dictionary['residentVerify'];

const LINKS = {
  certificate: 'link_certificate',
  organization: 'link_organization',
  signature: 'link_signature',
  role: 'link_role',
} as const satisfies Record<IssuerLink, keyof Strings>;

const STATES = {
  pass: { icon: Check, tone: 'text-emerald-600' },
  fail: { icon: X, tone: 'text-red-600' },
  unavailable: { icon: CircleSlash, tone: 'text-amber-600' },
  // Neutral on purpose: not a pass, and not a failure either.
  'not-verifiable': { icon: CircleHelp, tone: 'text-steel' },
} as const satisfies Record<LinkState, { icon: unknown; tone: string }>;

function formatDate(date: Date | undefined): string {
  return date ? date.toISOString().slice(0, 10) : '—';
}

export function IssuerChainPanel({
  report,
  contractMatches,
  pending,
  t,
}: {
  report: IssuerChainReport | null;
  /** Whether receipt.contractAddress matches the registry this page reads. */
  contractMatches: boolean | undefined;
  /** The check is still running; a null report afterwards means it could not run. */
  pending: boolean;
  t: Strings;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.issuerTitle}</h2>
      <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.issuerBody}</p>

      {report === null ? (
        pending ? (
          <p className="inline-flex items-center gap-2 text-sm text-steel">
            <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.75} aria-hidden />
            {t.issuerChecking}
          </p>
        ) : (
          <p className="text-sm text-steel">{t.issuerNotChecked}</p>
        )
      ) : (
        <div className="space-y-3">
          <dl className="divide-y divide-hairline rounded-lg border border-hairline bg-surface px-4">
            <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-40 shrink-0 text-sm text-steel">{t.issuerOrganization}</dt>
              <dd className="text-sm text-ink">{report.organizationName ?? '—'}</dd>
            </div>
            <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-40 shrink-0 text-sm text-steel">{t.issuerAccount}</dt>
              <dd className="text-sm text-ink">
                <HashText value={report.account} head={10} tail={8} />
              </dd>
            </div>
            <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-40 shrink-0 text-sm text-steel">{t.issuerValidity}</dt>
              <dd className="font-mono text-sm text-ink">
                {formatDate(report.notBefore)} → {formatDate(report.notAfter)}
              </dd>
            </div>
          </dl>

          <ul className="space-y-2">
            {(Object.keys(LINKS) as IssuerLink[]).map((link) => {
              const state = report.links[link];
              const { icon: Icon, tone } = STATES[state];
              return (
                <li key={link} className="flex items-start gap-2.5 text-sm">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} strokeWidth={2} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-ink">{t[LINKS[link]]}</p>
                    {link === 'certificate' ? (
                      <CertificateNote state={state} issuedBy={report.issuedBy} t={t} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* verifyReceipt.ts step 1, in the browser: a look-alike deployment
              is caught by the receipt naming a different contract. */}
          {contractMatches === false ? (
            <Notice tone="danger" title={t.contractMismatch} />
          ) : contractMatches === true ? (
            <p className="text-xs text-steel">{t.contractMatches}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Who issued the certificate — or why that could not be said. */
function CertificateNote({
  state,
  issuedBy,
  t,
}: {
  state: LinkState;
  issuedBy: string | undefined;
  t: Strings;
}) {
  const text =
    state === 'pass' && issuedBy
      ? format(t.link_certificateIssuedBy, { issuer: issuedBy })
      : state === 'fail'
        ? t.link_certificateRejected
        : state === 'not-verifiable'
          ? t.link_certificateNoAnchor
          : null;

  return text ? <p className="mt-1 text-xs leading-relaxed text-steel">{text}</p> : null;
}
