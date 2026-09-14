import Link from 'next/link';
import { ArrowRight, Landmark, ShieldCheck } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { LocaleSwitcher } from '@/i18n/components/locale-switcher';

/**
 * features/landing/components/landing-view.tsx
 *
 * Landing (D49): two portals, not three. Owner and Verifier merged into
 * Resident because they are the same logged-out visitor, and a buyer usually
 * plays both parts in one sitting.
 */
export function LandingView({
  lang,
  t,
  switcherLabel,
}: {
  lang: Locale;
  t: Dictionary['landing'];
  switcherLabel: string;
}) {
  return (
    <main className="grid min-h-dvh w-full grid-cols-1 bg-canvas md:grid-cols-[3fr_2fr]">
      <section className="relative z-10 flex flex-col justify-center bg-surface px-6 py-16 shadow-[4px_0_24px_-4px_rgba(0,0,0,0.02)] sm:px-10 md:px-16 lg:px-24">
        <div className="absolute top-6 right-6 md:hidden">
          <LocaleSwitcher current={lang} label={switcherLabel} />
        </div>

        <div className="max-w-xl">
          <span className="inline-flex rounded-xl border border-hairline bg-zinc-50 p-3">
            <ShieldCheck
              className="h-6 w-6 text-authority"
              strokeWidth={1.5}
              aria-hidden
            />
          </span>

          <h1 className="mt-6 text-4xl leading-tight font-semibold tracking-tight text-balance text-ink md:text-5xl">
            {t.residentTitle}
          </h1>

          <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-steel">
            {t.residentBody}
          </p>

          <Link
            href={`/${lang}/resident/lookup`}
            className="group mt-9 inline-flex items-center gap-3 rounded-full bg-authority px-6 py-3 font-medium text-white ui-transition tap-active hover:bg-zinc-800"
          >
            {t.residentCta}
            <ArrowRight
              className="h-4 w-4 spring-transition group-hover:translate-x-1"
              strokeWidth={2}
              aria-hidden
            />
          </Link>

          <div className="mt-14 border-t border-whisper pt-6">
            <h2 className="text-xs font-medium tracking-wider text-steel uppercase">
              {t.shortcutsLabel}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {[
                { href: `/${lang}/resident/proof`, label: t.shortcutProof },
                { href: `/${lang}/resident/verify`, label: t.shortcutVerify },
                { href: `/${lang}/resident/lookup`, label: t.shortcutHistory },
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="rounded text-steel ui-transition hover:text-ink"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Government. Narrower, quieter: a much smaller audience knows it is theirs. */}
      <section className="relative flex flex-col justify-center border-t border-whisper bg-canvas px-6 py-16 sm:px-10 md:border-t-0 md:px-12 lg:px-16">
        <div className="absolute top-6 right-6 hidden md:block">
          <LocaleSwitcher current={lang} label={switcherLabel} />
        </div>

        <div className="max-w-md">
          <span className="inline-flex rounded-xl border border-hairline bg-white p-3 whisper-shadow">
            <Landmark className="h-6 w-6 text-ink" strokeWidth={1.5} aria-hidden />
          </span>

          <h2 className="mt-6 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
            {t.govTitle}
          </h2>

          <p className="mt-4 leading-relaxed text-steel">{t.govBody}</p>

          <Link
            href={`/${lang}/government`}
            className="group mt-8 inline-flex items-center gap-3 rounded-full border border-hairline bg-white px-6 py-3 font-medium text-ink whisper-shadow ui-transition tap-active hover:border-zinc-300"
          >
            {t.govCta}
            <ArrowRight
              className="h-4 w-4 text-steel spring-transition group-hover:translate-x-1"
              strokeWidth={2}
              aria-hidden
            />
          </Link>
        </div>
      </section>
    </main>
  );
}
