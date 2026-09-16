import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { IssuanceView } from '@/features/government/issuance/components/issuance-view';

/** UC-1, issue a batch. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <IssuanceView lang={lang} t={dict.govIssuance} draftT={dict.govDraft} errors={dict.govErrors} />
  );
}
