import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ImportView } from '@/features/government/import/components/import-view';

/** UC-2, CSV bulk import. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).govImport;

  return <ImportView t={t} />;
}
