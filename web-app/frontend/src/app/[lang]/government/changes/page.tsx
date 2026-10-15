import { notFound } from 'next/navigation';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { ChangesView } from '@/features/government/changes/components/changes-view';

/** "Chốt sổ": publish one registration round (D84). Spec and UI live in the feature; this file only routes. */
export default async function Page({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  const { alerts, alertNoOffice } = dict.govOperations;

  return (
    <ChangesView
      lang={lang}
      t={dict.govChanges}
      draftT={dict.govDraft}
      alertT={{ alerts, alertNoOffice }}
      errors={dict.govErrors}
    />
  );
}
