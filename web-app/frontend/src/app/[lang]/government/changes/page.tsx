import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ChangesView } from '@/features/government/changes/components/changes-view';

/** UC-4, publish a change set. Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <ChangesView
      lang={lang}
      t={dict.govChanges}
      draftT={dict.govDraft}
      errors={dict.govErrors}
      freezeT={dict.govFreeze}
    />
  );
}
