'use client';

/**
 * features/resident/verify/components/disclosure-panel.tsx
 *
 * The two lists: what the proof discloses and what it withholds.
 *
 * The "tells you nothing about" half is the one that earns its place. A
 * verifier handed four numbers cannot tell whether the silence about the expiry
 * date is deliberate or a gap — and the difference is the entire system.
 */

import type { Dictionary } from '@/i18n/dictionaries';
import type { CircuitType } from '@land-registry/blockchain/shared/circuitInputs';
import { HashText } from '@/components/ui/hash-text';
import { disclosureFor } from '@/lib/disclosure';

type Strings = Dictionary['residentVerify'];
type SignalStrings = Dictionary['residentSignals'];

const CLAIMS = {
  ownership: 'detected_ownership',
  mortgage: 'detected_mortgage',
  transfer: 'detected_transfer',
} as const satisfies Record<CircuitType, keyof Strings>;

export function DisclosurePanel({
  circuitType,
  publicSignals,
  t,
  signals,
}: {
  circuitType: CircuitType;
  publicSignals: readonly string[];
  t: Strings;
  signals: SignalStrings;
}) {
  const { disclosed, withheld } = disclosureFor(circuitType, publicSignals);
  const label = (name: string) => signals[name as keyof SignalStrings] ?? name;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium tracking-tight text-ink">{t.detectedTitle}</h2>
        <p className="mt-1 text-sm text-ink">{t[CLAIMS[circuitType]]}</p>
        {circuitType === 'transfer' ? (
          <p className="mt-1 text-xs leading-relaxed text-steel">{t.transferSpentNote}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
          <h3 className="text-sm font-medium text-ink">{t.disclosedTitle}</h3>
          <p className="mt-1 text-xs leading-relaxed text-steel">{t.disclosedBody}</p>
          <dl className="mt-3 space-y-2">
            {disclosed.map(({ name, value }) => (
              <div key={name} className="flex flex-col gap-0.5">
                <dt className="text-xs text-steel">{label(name)}</dt>
                <dd className="text-sm text-ink">
                  {value.length > 24 ? (
                    <HashText value={value} head={10} tail={6} />
                  ) : (
                    <span className="font-mono">{value}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
          <h3 className="text-sm font-medium text-ink">{t.withheldTitle}</h3>
          <p className="mt-1 text-xs leading-relaxed text-steel">{t.withheldBody}</p>
          <ul className="mt-3 space-y-1.5">
            {withheld.map((name) => (
              <li key={name} className="text-sm text-steel">
                {label(`withheld_${name}`)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
