'use client';

/**
 * app/[lang]/resident/nav.tsx
 *
 * Three tabs, inline on desktop and a second row on phones. No wallet connector
 * here on purpose: the resident portal is logged-out by design (D39, D49), and
 * the on-chain half of UC-6 is a read that a public client can make.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileKey, History, ShieldCheck, SquareCheckBig } from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { LocaleSwitcher } from '@/components/locale-switcher';

type NavStrings = Dictionary['residentNav'];

const ITEMS = [
  { slug: 'lookup', icon: History, key: 'history', shortKey: 'historyShort' },
  { slug: 'proof', icon: FileKey, key: 'proof', shortKey: 'proofShort' },
  { slug: 'verify', icon: SquareCheckBig, key: 'verify', shortKey: 'verifyShort' },
] as const satisfies ReadonlyArray<{
  slug: string;
  icon: typeof History;
  key: keyof NavStrings;
  shortKey: keyof NavStrings;
}>;

export function ResidentNav({
  lang,
  t,
  switcherLabel,
}: {
  lang: Locale;
  t: NavStrings;
  switcherLabel: string;
}) {
  const pathname = usePathname();
  const hrefFor = (slug: string) => `/${lang}/resident/${slug}`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-30 border-b border-whisper bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href={`/${lang}`} className="flex items-center gap-2.5 rounded-lg">
          <ShieldCheck
            className="h-5 w-5 shrink-0 text-authority"
            strokeWidth={1.5}
            aria-hidden
          />
          <span className="font-semibold tracking-tight text-ink">{t.brand}</span>
        </Link>

        <div className="flex items-center gap-2">
          <nav aria-label={t.ariaLabel} className="hidden items-center gap-1 sm:flex">
            {ITEMS.map(({ slug, icon: Icon, key }) => {
              const href = hrefFor(slug);
              const active = isActive(href);
              return (
                <Link
                  key={slug}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ui-transition ${
                    active
                      ? 'bg-zinc-100 text-ink'
                      : 'text-steel hover:bg-zinc-50 hover:text-ink'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
                  {t[key]}
                </Link>
              );
            })}
          </nav>
          <LocaleSwitcher current={lang} label={switcherLabel} />
        </div>
      </div>

      {/* Phones: second row instead of a squeezed inline nav. */}
      <nav
        aria-label={t.ariaLabel}
        className="grid grid-cols-3 border-t border-whisper sm:hidden"
      >
        {ITEMS.map(({ slug, icon: Icon, shortKey }) => {
          const href = hrefFor(slug);
          const active = isActive(href);
          return (
            <Link
              key={slug}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center justify-center gap-1.5 px-1 py-3 text-center text-[13px] font-medium ui-transition ${
                active
                  ? 'text-ink shadow-[inset_0_-2px_0_var(--color-authority)]'
                  : 'text-steel'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />
              {t[shortKey]}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
