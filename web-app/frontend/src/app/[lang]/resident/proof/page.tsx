import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ProofView } from '@/features/resident/proof/components/proof-view';

/** UC-5, generate a proof. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).residentProof;

  return <ProofView t={t} />;
}
