import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { LookupView } from '@/features/resident/lookup/components/lookup-view';

/** D48, public property history. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <LookupView
      lang={lang}
      t={dict.residentLookup}
      errors={dict.residentErrors}
      // Sibling features share strings through the route, never through an
      // import: `verify` uses this same slice (D66).
      revocation={dict.residentRevocation}
    />
  );
}
