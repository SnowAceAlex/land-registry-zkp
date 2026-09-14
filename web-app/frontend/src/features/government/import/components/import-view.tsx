/**
 * features/government/import/components/import-view.tsx - UC-2, CSV bulk import.
 *
 * TODO (Phase 8):
 *  1. File picker + drag/drop onto the dropzone below. Accept a single .csv.
 *  2. POST multipart to /api/government/import with the x-gov-api-key header
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
import { FileUp } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

export function ImportView({ t }: { t: Dictionary['govImport'] }) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />
      <EmptyState icon={FileUp} title={t.emptyTitle} description={t.emptyBody} />
    </div>
  );
}
