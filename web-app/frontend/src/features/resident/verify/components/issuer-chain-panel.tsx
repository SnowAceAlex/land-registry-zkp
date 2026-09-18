'use client';

/**
 * features/resident/verify/components/issuer-chain-panel.tsx — D30, four links.
 *
 * ⚠️ Link 1 renders with a NEUTRAL icon, never a green tick. The PoC
 *    certificate is self-signed, so "the certificate is genuine" is a claim
 *    this deployment cannot make, and it is the most load-bearing claim on the
 *    page. Saying so plainly — with what IS checked listed next to it — is the
 *    honest presentation, and the same one `verifyReceipt.ts` uses on the Node
 *    side.
 *
 * The receipt input is optional and visibly secondary, with the disclosure
 * warning attached: a receipt reveals the whole certificate, including the term
 * and encumbrance that mortgage.circom exists to hide. The identity check and
 * selective disclosure genuinely pull against each other here, and the screen
 * says which persona should accept that trade.
 */

import { Check, CircleHelp, CircleSlash, FileText, X } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { buttonStyles } from '@/components/ui/button';

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
  onChooseReceipt,
  t,
}: {
  report: IssuerChainReport | null;
  /** Whether receipt.contractAddress matches the registry this page reads. */
  contractMatches: boolean | undefined;
  onChooseReceipt: () => void;
  t: Strings;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.issuerTitle}</h2>
      <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.issuerBody}</p>

      {report === null ? (
        <div className="space-y-3">
          <Notice tone="info" title={t.issuerNeedsReceipt}>
            {t.issuerReceiptDisclosureWarning}
          </Notice>
          <button type="button" className={buttonStyles.secondary} onClick={onChooseReceipt}>
            <span className="inline-flex items-center gap-2">
              <FileText className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              {t.chooseReceipt}
            </span>
          </button>
        </div>
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
                    {link === 'certificate' && state === 'not-verifiable' ? (
                      <p className="mt-1 text-xs leading-relaxed text-steel">
                        {t.link_certificateSelfSigned}
                      </p>
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
