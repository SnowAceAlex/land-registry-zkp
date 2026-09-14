import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ChangesView } from '@/features/government/changes/components/changes-view';

/** UC-4, batch changes and revocations. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).govChanges;

  return <ChangesView t={t} />;
}
