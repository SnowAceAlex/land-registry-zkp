'use client';

/**
 * features/resident/verify/components/revocation-panel.tsx — D45.
 *
 * Read straight from the chain's `revocations` mapping, not from the registry's
 * API: this is a fact a verifier should not have to take anyone's word for.
 *
 * It is NOT one of the four checks. A revoked plot can still carry a
 * cryptographically perfect proof — what changed is the title, not the
 * mathematics — so it is rendered alongside them and folded into the verdict by
 * `trust-summary.ts` instead.
 *
 * Only the reason CODE and a hash of the written explanation are on chain. The
 * explanation itself stays with the authority (D45), and the panel says so, so
 * a reader knows there is something further to ask for rather than assuming the
 * system is being evasive.
 */

import type { Dictionary } from '@/i18n/dictionaries';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import type { RevocationEntry } from '@/lib/registry-reads';

type Strings = Dictionary['residentVerify'];
type RevocationStrings = Dictionary['residentRevocation'];

function formatWhen(seconds: bigint): string {
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function RevocationPanel({
  entry,
  t,
  revocation,
}: {
  /** null = not revoked; undefined = the chain was not readable. */
  entry: RevocationEntry | null | undefined;
  t: Strings;
  revocation: RevocationStrings;
}) {
  if (entry === undefined) return null;

  const reasonKey = `reason_${entry?.reasonCode}` as keyof RevocationStrings;
  const reason = entry && reasonKey in revocation ? revocation[reasonKey] : revocation.reason_unknown;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.revocationTitle}</h2>

      {entry === null ? (
        <p className="text-sm text-steel">{t.revocationNone}</p>
      ) : (
        <>
          <Notice tone="danger" title={t.revocationActive} />

          <dl className="divide-y divide-hairline rounded-lg border border-hairline bg-surface px-4">
            <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-52 shrink-0 text-sm text-steel">{revocation.reasonLabel}</dt>
              <dd className="text-sm text-ink">{reason}</dd>
            </div>
            <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-52 shrink-0 text-sm text-steel">{revocation.revokedAt}</dt>
              <dd className="font-mono text-sm text-ink">{formatWhen(entry.revokedAt)}</dd>
            </div>
            <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-52 shrink-0 text-sm text-steel">{revocation.rootVersion}</dt>
              <dd className="font-mono text-sm text-ink">{entry.rootVersion}</dd>
            </div>
            <div className="flex flex-col gap-1 py-2.5 sm:flex-row sm:gap-6">
              <dt className="w-52 shrink-0 text-sm text-steel">{revocation.detailHash}</dt>
              <dd className="text-sm text-ink">
                <HashText value={entry.detailHash} head={10} tail={8} />
              </dd>
            </div>
          </dl>

          <p className="max-w-3xl text-xs leading-relaxed text-steel">
            {revocation.detailOffChainNote}
          </p>
        </>
      )}
    </section>
  );
}
