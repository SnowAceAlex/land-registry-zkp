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
 *
 * D68: two of `mortgage.circom`'s constraints are mirrored here as interface
 * state rather than left to fail inside the prover. `mortgageEncumbered`
 * disables the whole option — an encumbered title can never satisfy the circuit
 * whatever number is typed — while `termTooLong` sits under the field, because
 * it is the number itself that is wrong and the owner can simply lower it.
 * Neither is a security control; the circuit still decides.
 *
 * D70: the field does NOT change shape for a perpetual plot. Hiding it, or
 * filling it in, would put a distinctive value into public signal [4] and hand
 * the verifier the `tenureType` this proof exists to withhold — so a perpetual
 * title gets one extra sentence and the identical input. The same reasoning
 * gives the field a ceiling: see MAX_TERM_YEARS.
 */

import { format } from '@/i18n/format';
import type { Dictionary } from '@/i18n/dictionaries';
import { MAX_TERM_YEARS, type TermYearsError } from '@/lib/term';

import type { OwnerProofType } from '../lib/owner-witness';

type Strings = Dictionary['residentProof'];

export function ProofTypePicker({
  value,
  onChange,
  years,
  onYears,
  yearsError,
  perpetualTenure,
  mortgageEncumbered,
  termTooLong,
  disabled,
  t,
}: {
  value: OwnerProofType;
  onChange: (type: OwnerProofType) => void;
  years: string;
  onYears: (years: string) => void;
  /** Which rule the typed number broke, or null while it is usable. */
  yearsError: TermYearsError | null;
  /** The title has no term at all, so every threshold is already met (D5). */
  perpetualTenure: boolean;
  /** The record carries a mortgage or dispute, so mortgage.circom cannot pass. */
  mortgageEncumbered: boolean;
  /** More years were asked for than the title has left. */
  termTooLong: boolean;
  disabled?: boolean;
  t: Strings;
}) {
  const options: { type: OwnerProofType; title: string; body: string; blocked: string | null }[] = [
    { type: 'ownership', title: t.typeOwnership, body: t.typeOwnershipBody, blocked: null },
    {
      type: 'mortgage',
      title: t.typeMortgage,
      body: t.typeMortgageBody,
      blocked: mortgageEncumbered ? t.mortgageEncumbered : null,
    },
  ];

  /**
   * What the line under the field says, worst first. The three refusals are red
   * and carry `role="alert"`; the perpetual note is neither, because nothing is
   * wrong — it is the ordinary hint, with one plot's fact added.
   */
  const fieldNote: { text: string; problem: boolean } =
    yearsError === 'not-whole'
      ? { text: t.termInvalid, problem: true }
      : yearsError === 'above-max'
        ? { text: format(t.termAboveMax, { max: MAX_TERM_YEARS }), problem: true }
        : termTooLong
          ? // Deliberately does not say how many years ARE left: that figure is
            // the private one the mortgage proof exists to withhold, and
            // printing it here would put it on screen for whoever is standing
            // next to the owner.
            { text: t.termTooLong, problem: true }
          : perpetualTenure
            ? { text: t.termPerpetual, problem: false }
            : { text: t.termHint, problem: false };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.step3}</h2>
      <p className="max-w-3xl text-xs leading-relaxed text-steel">{t.step3Body}</p>

      <fieldset className="space-y-3" disabled={disabled}>
        <legend className="sr-only">{t.step3}</legend>

        {options.map(({ type, title, body, blocked }) => {
          const selected = value === type;
          return (
            <label
              key={type}
              className={`block rounded-lg border px-4 py-3 ui-transition ${
                blocked
                  ? 'cursor-not-allowed border-hairline bg-surface opacity-60'
                  : selected
                    ? 'cursor-pointer border-authority bg-whisper'
                    : 'cursor-pointer border-hairline bg-surface'
              }`}
            >
              <span className="flex items-start gap-3">
                <input
                  type="radio"
                  name="proof-type"
                  value={type}
                  checked={selected}
                  disabled={blocked !== null}
                  onChange={() => onChange(type)}
                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-authority)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-steel">{body}</span>
                  {blocked ? (
                    <span className="mt-2 block text-xs leading-relaxed text-red-700">
                      {blocked}
                    </span>
                  ) : null}
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
                    aria-invalid={yearsError !== null || termTooLong || undefined}
                    className="mt-1.5 w-32 rounded-lg border border-hairline bg-white px-3 py-2 font-mono text-sm text-ink ui-transition focus:border-authority aria-invalid:border-red-400"
                  />
                  <span
                    id="min-years-hint"
                    className="mt-1.5 block max-w-xl text-xs leading-relaxed text-steel"
                  >
                    {fieldNote.problem ? (
                      <span role="alert" className="text-red-700">
                        {fieldNote.text}
                      </span>
                    ) : (
                      fieldNote.text
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
