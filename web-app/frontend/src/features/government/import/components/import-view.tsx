/**
 * features/government/import/components/import-view.tsx - UC-2, CSV bulk import.
 *
 * Implemented in Phase 8 (D52) — the list below is the spec it follows:
 *  1. File picker + drag/drop onto the dropzone below. Accept a single .csv.
 *  2. POST multipart to /api/government/import with the x-gov-api-key header,
 *     first with ?dryRun=true (D52) and only then for real
 *     (see features/government/auth/lib/gov-session.ts). The route is on
 *     GovernmentController. Put the call in ../api.ts, not inline here.
 *  3. Render per-row results. The backend validates under D35: input must
 *     already be current, so superseded land codes, renamed agencies and
 *     district-tier address segments come back as plain invalid values, not as
 *     something the UI should offer to auto-correct.
 *  4. Surface the administrative_units lookup warning separately - an empty
 *     catalog warns rather than blocking, and that distinction matters to the
 *     officer deciding whether to re-run seed:admin-units.
 *  5. Accepted rows land as IMPORTED and become selectable in UC-1.
 */
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

import { ImportWorkbench } from './import-workbench';

export function ImportView({
  lang,
  t,
  errors,
}: {
  lang: Locale;
  t: Dictionary['govImport'];
  errors: Dictionary['govErrors'];
}) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <ImportWorkbench lang={lang} t={t} errors={errors} />
    </div>
  );
}
