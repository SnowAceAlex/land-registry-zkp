import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { IssuanceView } from '@/features/government/issuance/components/issuance-view';

/** UC-1: queue imported plots for issuance; they publish in the next registration round (D87). */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <IssuanceView lang={lang} t={dict.govIssuance} errors={dict.govErrors} />
  );
}
