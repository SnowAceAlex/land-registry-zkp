import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

/** Placeholder until the archive list lands. */
export function ArchivesView({ t }: { t: Dictionary['govArchives'] }) {
  return <PageHeader title={t.title} description={t.description} />;
}
