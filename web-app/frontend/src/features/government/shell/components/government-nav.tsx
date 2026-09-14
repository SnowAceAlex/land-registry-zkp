'use client';

/**
 * features/government/shell/components/government-nav.tsx - sidebar on desktop, bottom tab bar on phones.
 *
 * Client-side only because the active item needs the pathname. A nav where all
 * four items render identically regardless of location is the defect this
 * fixes; `aria-current` carries the same information to screen readers.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowRightLeft,
  FileSignature,
  FileUp,
  FolderSync,
  Landmark,
  LogOut,
} from 'lucide-react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { clearGovKey } from '@/features/government/auth/lib/gov-session';
import { LocaleSwitcher } from '@/i18n/components/locale-switcher';

type NavStrings = Dictionary['govNav'];

/** Slug and UC tag are not translated: they are route and spec identifiers. */
const ITEMS = [
  { slug: 'import', uc: 'UC-2', icon: FileUp, key: 'import' },
  { slug: 'issuance', uc: 'UC-1', icon: FileSignature, key: 'issuance' },
  { slug: 'transfers', uc: 'UC-3', icon: ArrowRightLeft, key: 'transfers' },
  { slug: 'changes', uc: 'UC-4', icon: FolderSync, key: 'changes' },
] as const satisfies ReadonlyArray<{
  slug: string;
  uc: string;
  icon: typeof FileUp;
  key: keyof NavStrings;
}>;

export function GovernmentNav({
  lang,
  t,
  switcherLabel,
}: {
  lang: Locale;
  t: NavStrings;
  switcherLabel: string;
}) {
  const pathname = usePathname();
  const hrefFor = (slug: string) => `/${lang}/government/${slug}`;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  function signOut() {
    clearGovKey();
    // Full reload so every provider and cached query is dropped with the key.
    window.location.assign(`/${lang}/government`);
  }

  return (
    <>
      {/* Desktop: fixed-width rail */}
      <aside className="hidden w-62.5 shrink-0 flex-col border-r border-whisper bg-white md:flex">
        <div className="border-b border-whisper p-6">
          <Link href={`/${lang}`} className="flex items-center gap-3 rounded-lg">
            <span className="rounded-lg border border-hairline bg-zinc-50 p-2">
              <Landmark className="h-5 w-5 text-ink" strokeWidth={1.5} aria-hidden />
            </span>
            <span>
              <span className="block text-sm font-semibold tracking-tight">{t.brand}</span>
              <span className="block text-xs text-steel">{t.brandSub}</span>
            </span>
          </Link>
        </div>

        <nav aria-label={t.ariaLabel} className="flex-1 space-y-1 p-4">
          <h2 className="mb-2 px-3 text-xs font-medium tracking-wider text-steel uppercase">
            {t.operations}
          </h2>
          {ITEMS.map(({ slug, uc, icon: Icon, key }) => {
            const href = hrefFor(slug);
            const active = isActive(href);
            return (
              <Link
                key={slug}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ui-transition ${
                  active
                    ? 'bg-zinc-100 text-ink'
                    : 'text-steel hover:bg-zinc-50 hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
                <span className="flex-1">{t[key]}</span>
                <span className="font-mono text-[10px] text-zinc-400">{uc}</span>
              </Link>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-whisper p-4">
          <LocaleSwitcher current={lang} label={switcherLabel} />
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-steel ui-transition hover:bg-zinc-50 hover:text-red-700"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            {t.signOut}
          </button>
        </div>
      </aside>

      {/* Phones: header + bottom tab bar, so the 250px rail never eats the
          content column. Four tabs fit a 320px viewport without scrolling. */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-whisper bg-white px-4 md:hidden">
        <Link href={`/${lang}`} className="flex items-center gap-2 rounded-lg">
          <Landmark className="h-4 w-4 text-ink" strokeWidth={1.5} aria-hidden />
          <span className="text-sm font-semibold tracking-tight">{t.brand}</span>
        </Link>
        <div className="flex items-center gap-1">
          <LocaleSwitcher current={lang} label={switcherLabel} />
          <button
            type="button"
            onClick={signOut}
            className="rounded-md p-2 text-steel ui-transition hover:text-red-700"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            <span className="sr-only">{t.signOut}</span>
          </button>
        </div>
      </header>

      <nav
        aria-label={t.ariaLabel}
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-whisper bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {ITEMS.map(({ slug, icon: Icon, key }) => {
          const href = hrefFor(slug);
          const active = isActive(href);
          return (
            <Link
              key={slug}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center gap-1 px-1 py-2.5 text-center text-[11px] leading-tight font-medium ui-transition ${
                active ? 'text-ink' : 'text-steel'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
              {t[key]}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
