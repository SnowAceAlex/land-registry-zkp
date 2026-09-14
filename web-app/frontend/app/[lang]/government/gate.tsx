'use client';

/**
 * app/[lang]/government/gate.tsx - the GOV_API_KEY entry screen (D49).
 *
 * Renders the key form until a key validates, then renders the portal. Keeping
 * it as a wrapper rather than a redirect means a deep link such as
 * /vi/government/issuance survives sign-in: the officer lands where they meant
 * to.
 *
 * Strings arrive as props from the server layout, so the dictionaries stay
 * server-only.
 */

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, TriangleAlert } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { clearGovKey, readGovKey, validateGovKey, writeGovKey } from '@/lib/gov-session';
import { LocaleSwitcher } from '@/components/locale-switcher';

type Phase = 'checking' | 'locked' | 'unlocked';

/** Local copy of the tiny formatter: i18n/dictionaries.ts is server-only. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

export function GovernmentGate({
  children,
  lang,
  t,
  switcherLabel,
}: {
  children: React.ReactNode;
  lang: Locale;
  t: Dictionary['gate'];
  switcherLabel: string;
}) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Revalidate a stored key on mount: it may have been rotated server-side
   * since the tab was opened.
   *
   * The initial phase has to be 'checking' rather than a value read from
   * sessionStorage, because storage does not exist during SSR and seeding from
   * it would desync hydration. Everything below runs inside an async body so no
   * setState happens synchronously in the effect.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = readGovKey();
      if (!stored) {
        if (!cancelled) setPhase('locked');
        return;
      }
      const result = await validateGovKey(stored);
      if (cancelled) return;
      if (result.ok) {
        setPhase('unlocked');
        return;
      }
      // Only a rejection proves the key is bad. A transport failure must not
      // silently discard a key that was fine.
      if (result.reason === 'rejected') clearGovKey();
      setPhase('locked');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!key.trim() || submitting) return;
      setSubmitting(true);
      setError(null);

      const result = await validateGovKey(key.trim());
      if (result.ok) {
        writeGovKey(key.trim());
        setKey('');
        setPhase('unlocked');
      } else if (result.reason === 'rejected') {
        setError(t.errorRejected);
      } else {
        setError(
          result.detail
            ? fill(t.errorUnreachableDetail, { detail: result.detail })
            : t.errorUnreachable,
        );
      }
      setSubmitting(false);
    },
    [key, submitting, t],
  );

  if (phase === 'unlocked') return <>{children}</>;

  return (
    <div className="min-h-dvh bg-canvas px-6 py-16 sm:py-24">
      <div className="mx-auto w-full max-w-104">
        <div className="mb-8 flex items-start justify-between gap-4">
          <span className="inline-flex rounded-xl border border-hairline bg-white p-2.5 whisper-shadow">
            <KeyRound
              className="h-5 w-5 text-authority"
              strokeWidth={1.5}
              aria-hidden
            />
          </span>
          <LocaleSwitcher current={lang} label={switcherLabel} />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-steel">{t.intro}</p>

        {phase === 'checking' ? (
          <div
            className="mt-8 flex items-center gap-2 text-sm text-steel"
            role="status"
          >
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            {t.checking}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-8" noValidate>
            <label
              htmlFor="gov-api-key"
              className="block text-sm font-medium text-ink"
            >
              {t.label}
            </label>
            <input
              id="gov-api-key"
              name="gov-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'gov-api-key-error' : 'gov-api-key-hint'}
              className="mt-2 w-full rounded-lg border border-hairline bg-white px-3.5 py-2.5 font-mono text-sm text-ink ui-transition placeholder:text-zinc-400 focus:border-authority"
            />

            {error ? (
              <p
                id="gov-api-key-error"
                role="alert"
                className="mt-2 flex items-start gap-1.5 text-sm text-red-700"
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {error}
              </p>
            ) : (
              <p id="gov-api-key-hint" className="mt-2 text-sm text-steel">
                {t.hint}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || key.trim().length === 0}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-authority px-4 py-2.5 text-sm font-medium text-white ui-transition tap-active hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  {t.verifying}
                </>
              ) : (
                t.submit
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
