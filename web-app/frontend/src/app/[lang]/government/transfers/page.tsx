import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { TransfersView } from '@/features/government/transfers/components/transfers-view';

/** UC-3, transfer at the counter. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return <TransfersView t={dict.govTransfers} errors={dict.govErrors} freezeT={dict.govFreeze} />;
}
