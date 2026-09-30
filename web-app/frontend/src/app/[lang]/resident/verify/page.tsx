import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { VerifyView } from '@/features/resident/verify/components/verify-view';

/** UC-6, verify a proof. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <VerifyView
      t={dict.residentVerify}
      errors={dict.residentErrors}
      // Sibling features share strings through the route, never through an
      // import: `proof` and `lookup` use this same slice (D66).
      signals={dict.residentSignals}
      shell={dict.residentShell}
    />
  );
}
