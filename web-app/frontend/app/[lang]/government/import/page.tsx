/**
 * app/government/import/page.tsx - UC-2, CSV bulk import.
 *
 * TODO (Phase 8):
 *  1. File picker + drag/drop onto the dropzone below. Accept a single .csv.
 *  2. POST multipart to /api/government/import with the x-gov-api-key header
 *     (see lib/gov-session.ts). The route is on GovernmentController.
 *  3. Render per-row results. The backend validates under D35: input must
 *     already be current, so superseded land codes, renamed agencies and
 *     district-tier address segments come back as plain invalid values, not as
 *     something the UI should offer to auto-correct.
 *  4. Surface the administrative_units lookup warning separately - an empty
 *     catalog warns rather than blocking, and that distinction matters to the
 *     officer deciding whether to re-run seed:admin-units.
 *  5. Accepted rows land as IMPORTED and become selectable in UC-1.
 */
import { notFound } from 'next/navigation';
import { FileUp } from 'lucide-react';

import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';

export default async function GovImportPage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  const t = (await getDictionary(lang)).govImport;

  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description}
      />
      <EmptyState
        icon={FileUp}
        title={t.emptyTitle}
        description={t.emptyBody}
      />
    </div>
  );
}
