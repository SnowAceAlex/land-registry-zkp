import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ProofView } from '@/features/resident/proof/components/proof-view';

/** UC-5, generate a proof. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <ProofView
      t={dict.residentProof}
      errors={dict.residentErrors}
      // Sibling features share strings through the route, never through an
      // import: `verify` renders the same signal labels (D66).
      signals={dict.residentSignals}
      shell={dict.residentShell}
    />
  );
}
