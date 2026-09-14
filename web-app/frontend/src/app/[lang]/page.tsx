import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { LandingView } from '@/features/landing/components/landing-view';

/** Landing (D49). The UI lives in features/landing; this file only routes. */
export default async function Home({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return <LandingView lang={lang} t={dict.landing} switcherLabel={dict.localeSwitcher.label} />;
}
