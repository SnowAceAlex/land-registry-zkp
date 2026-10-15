import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';

/** Placeholder until the operations console lands. */
export function OperationsView({ t }: { t: Dictionary['govOperations'] }) {
  return <PageHeader title={t.title} description={t.description} />;
}
