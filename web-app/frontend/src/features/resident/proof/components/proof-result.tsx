'use client';

/**
 * features/resident/proof/components/proof-result.tsx
 *
 * The finished proof: how long it took, what it discloses, what it never
 * discloses, and the download.
 *
 * Both lists are shown here, before the file leaves the owner's hands, so the
 * owner can see what they are about to hand over. The verifier sees the same
 * two lists on the other side (UC-6), from the same `disclosureFor`.
 */

import { Download } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import type { ProofPackage } from '@land-registry/blockchain/shared';
import { HashText } from '@/components/ui/hash-text';
import { Notice } from '@/components/ui/notice';
import { buttonStyles } from '@/components/ui/button';
import { disclosureFor } from '@/lib/disclosure';
import { downloadJson } from '@/lib/download';

import { type OwnerProofType, proofFileName } from '../lib/owner-witness';

type Strings = Dictionary['residentProof'];
type SignalStrings = Dictionary['residentSignals'];

/** Long field elements are truncated; short ones (a term, a timestamp) are not. */
function SignalValue({ value }: { value: string }) {
  return value.length > 24 ? (
    <HashText value={value} head={10} tail={6} />
  ) : (
    <span className="font-mono">{value}</span>
  );
}

export function ProofResult({
  pkg,
  durationMs,
  type,
  propertyId,
  onProveAgain,
  t,
  signals,
}: {
  pkg: ProofPackage;
  durationMs: number;
  type: OwnerProofType;
  propertyId: string;
  onProveAgain: () => void;
  t: Strings;
  signals: SignalStrings;
}) {
  const { disclosed, withheld } = disclosureFor(pkg.circuitType, pkg.publicSignals);
  const label = (name: string) => signals[name as keyof SignalStrings] ?? name;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.step4}</h2>

      <Notice tone="success" title={t.resultTitle}>
        <p>{t.resultBody}</p>
        <p className="mt-1 text-xs">
          {t.duration} <span className="font-mono">{(durationMs / 1000).toFixed(1)}s</span>
        </p>
      </Notice>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
          <h3 className="text-sm font-medium text-ink">{t.disclosedTitle}</h3>
          <dl className="mt-2 space-y-2">
            {disclosed.map(({ name, value }) => (
              <div key={name} className="flex flex-col gap-0.5">
                <dt className="text-xs text-steel">{label(name)}</dt>
                <dd className="text-sm text-ink">
                  <SignalValue value={value} />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
          <h3 className="text-sm font-medium text-ink">{t.withheldTitle}</h3>
          <ul className="mt-2 space-y-1.5">
            {withheld.map((name) => (
              <li key={name} className="text-sm text-steel">
                {label(`withheld_${name}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Notice tone="warning" title={t.expiryWarning} />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonStyles.primary}
          onClick={() => downloadJson(pkg, proofFileName(type, propertyId))}
        >
          <span className="inline-flex items-center gap-2">
            <Download className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            {t.download}
          </span>
        </button>
        <button type="button" className={buttonStyles.secondary} onClick={onProveAgain}>
          {t.proveAgain}
        </button>
      </div>
    </section>
  );
}
