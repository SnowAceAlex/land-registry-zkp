'use client';

/**
 * features/resident/proof/components/proof-type-picker.tsx
 *
 * The owner chooses which claim to make. Each card says what the proof reveals,
 * because that is the decision being made — the two circuits differ in exactly
 * one disclosed signal and one hidden predicate, and nobody can infer that.
 *
 * D16: the mortgage threshold is the owner's own number, typed here. There is
 * no bank-side request/response flow in this system; the owner is told to enter
 * the figure the bank asked for rather than their real remaining term, since
 * the point is to disclose the minimum that satisfies the bank.
 *
 * D6: framed as clean title plus sufficient remaining term. It is not a
 * range-proof about the plot's value, and the copy says so.
 */

import type { Dictionary } from '@/i18n/dictionaries';

import type { OwnerProofType } from '../lib/owner-witness';

type Strings = Dictionary['residentProof'];

export function ProofTypePicker({
  value,
  onChange,
  years,
  onYears,
  yearsInvalid,
  disabled,
  t,
}: {
  value: OwnerProofType;
  onChange: (type: OwnerProofType) => void;
  years: string;
  onYears: (years: string) => void;
  yearsInvalid: boolean;
  disabled?: boolean;
  t: Strings;
}) {
  const options: { type: OwnerProofType; title: string; body: string }[] = [
    { type: 'ownership', title: t.typeOwnership, body: t.typeOwnershipBody },
    { type: 'mortgage', title: t.typeMortgage, body: t.typeMortgageBody },
  ];

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.step3}</h2>
      <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.step3Body}</p>

      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="sr-only">{t.step3}</legend>

        {options.map(({ type, title, body }) => {
          const selected = value === type;
          return (
            <label
              key={type}
              className={`block cursor-pointer rounded-lg border px-4 py-3 ui-transition ${
                selected ? 'border-authority bg-whisper' : 'border-hairline bg-surface'
              }`}
            >
              <span className="flex items-start gap-3">
                <input
                  type="radio"
                  name="proof-type"
                  value={type}
                  checked={selected}
                  onChange={() => onChange(type)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-authority)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-steel">{body}</span>
                </span>
              </span>

              {type === 'mortgage' && selected ? (
                <span className="mt-3 block border-t border-hairline pt-3 pl-7">
                  <label htmlFor="min-years" className="block text-sm text-ink">
                    {t.termLabel}
                  </label>
                  <input
                    id="min-years"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={years}
                    onChange={(event) => onYears(event.target.value)}
                    aria-describedby="min-years-hint"
                    aria-invalid={yearsInvalid || undefined}
                    className="mt-1.5 w-32 rounded-lg border border-hairline bg-white px-3 py-2 font-mono text-sm text-ink ui-transition focus:border-authority aria-invalid:border-red-400"
                  />
                  <span id="min-years-hint" className="mt-1.5 block text-xs text-steel">
                    {yearsInvalid ? (
                      <span role="alert" className="text-red-700">
                        {t.termInvalid}
                      </span>
                    ) : (
                      t.termHint
                    )}
                  </span>
                </span>
              ) : null}
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
