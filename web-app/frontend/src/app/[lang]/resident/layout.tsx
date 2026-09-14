import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ResidentNav } from '@/features/resident/shell/components/resident-nav';

export default async function ResidentLayout({ children, params }: LayoutProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <div className="flex min-h-dvh w-full flex-col bg-canvas text-ink">
      <ResidentNav lang={lang} t={dict.residentNav} switcherLabel={dict.localeSwitcher.label} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 sm:py-12">
        {children}
      </main>
    </div>
  );
}
