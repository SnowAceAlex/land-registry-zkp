import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ArchivesView } from '@/features/government/archives/components/archives-view';

export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return <ArchivesView lang={lang} t={dict.govArchives} errors={dict.govErrors} />;
}
