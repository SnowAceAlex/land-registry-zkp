import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { RevocationsView } from '@/features/government/revocations/components/revocations-view';

/** UC-4, queue a revocation. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <RevocationsView t={dict.govRevocations} errors={dict.govErrors} freezeT={dict.govFreeze} />
  );
}
