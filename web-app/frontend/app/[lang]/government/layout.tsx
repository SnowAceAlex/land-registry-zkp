/**
 * app/[lang]/government/layout.tsx
 *
 * The wallet stack is mounted here rather than in the root layout: only this
 * portal signs on-chain writes (D43), and hoisting it put the whole
 * wagmi/RainbowKit/WalletConnect bundle on the logged-out resident pages.
 *
 * The gate and nav are Client Components, so they receive their strings as
 * props. That keeps the dictionaries server-only: only the handful of strings
 * actually rendered crosses the wire, not the whole file.
 */
import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { Providers } from '@/components/providers';
import { GovernmentGate } from './gate';
import { GovernmentNav } from './nav';

export default async function GovernmentLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <Providers>
      <GovernmentGate lang={lang} t={dict.gate} switcherLabel={dict.localeSwitcher.label}>
        <div className="flex min-h-dvh w-full flex-col bg-canvas text-ink md:flex-row">
          <GovernmentNav lang={lang} t={dict.govNav} switcherLabel={dict.localeSwitcher.label} />
          {/* pb-20 clears the phone tab bar; md:pb-8 drops it back on desktop. */}
          <main className="mx-auto w-full max-w-300 flex-1 px-4 pt-6 pb-20 sm:px-6 md:px-8 md:pt-8 md:pb-8">
            {children}
          </main>
        </div>
      </GovernmentGate>
    </Providers>
  );
}
