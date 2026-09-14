'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';

import { LOCALES, LOCALE_LABEL, type Locale } from '@/i18n/config';
import { persistLocale } from '../locale-cookie';

/**
 * i18n/components/locale-switcher.tsx
 *
 * Swaps the locale segment in place, so switching language keeps the reader on
 * the page they were reading instead of dropping them at the landing page.
 *
 * Persists the choice itself rather than leaving it to the proxy: the proxy
 * only sees the *next* request, and on a client-side navigation there may not
 * be one. Without that write, a switch would not survive a reload.
 */
export function LocaleSwitcher({ current, label }: { current: Locale; label: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function switchTo(next: Locale) {
    if (next === current) return;

    persistLocale(next);

    // pathname is always `/<locale>/...` here: the proxy guarantees a prefix
    // before any page renders.
    const segments = pathname.split('/');
    segments[1] = next;
    startTransition(() => {
      router.push(segments.join('/') || `/${next}`);
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-full border border-hairline bg-white p-0.5"
    >
      <Languages
        className="ml-2 h-3.5 w-3.5 shrink-0 text-steel"
        strokeWidth={1.5}
        aria-hidden
      />
      {LOCALES.map((locale) => {
        const active = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            onClick={() => switchTo(locale)}
            aria-current={active ? 'true' : undefined}
            disabled={isPending}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ui-transition disabled:opacity-60 ${
              active
                ? 'bg-authority text-white'
                : 'text-steel hover:text-ink'
            }`}
          >
            <span className="sr-only">{LOCALE_LABEL[locale]}</span>
            <span aria-hidden>{locale.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
}
