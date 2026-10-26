/**
 * "Chốt sổ" (D84): one registration round publishes issuance, transfers and
 * revocations. A draft is immutable: discard it, hold the item, create again.
 */
import { Suspense } from 'react';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';

import type { AlertStrings } from '../../api/alert-text';
import { CentralOnly } from '../../shell/components/central-only';
import { ChangesWorkbench } from './changes-workbench';

export function ChangesView({
  lang,
  t,
  draftT,
  alertT,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govChanges'];
  draftT: Dictionary['govDraft'];
  alertT: AlertStrings;
  errors: Dictionary['govErrors'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <CentralOnly t={errors}>
        {/* The queue table reads the query string, which needs a Suspense boundary. */}
        <Suspense fallback={<Skeleton className="h-48 w-full" />}>
          <ChangesWorkbench lang={lang} t={t} draftT={draftT} alertT={alertT} errors={errors} />
        </Suspense>
      </CentralOnly>
    </div>
  );
}
