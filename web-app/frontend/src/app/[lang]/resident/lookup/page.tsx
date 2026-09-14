import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { LookupView } from '@/features/resident/lookup/components/lookup-view';

/** D48, public property history. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).residentLookup;

  return <LookupView t={t} />;
}
