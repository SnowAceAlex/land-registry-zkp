'use client';

import type { Dictionary } from '@/i18n/dictionaries';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

import { useMe } from '../../api/hooks';

/**
 * Body of a central-office page (D86). A branch sees a notice instead, so the
 * page's queries never run. The backend still enforces the scope: if `me`
 * cannot be read, the page renders and the first guarded call answers 403.
 */
export function CentralOnly({
  t,
  children,
}: {
  t: Dictionary['govErrors'];
  children: React.ReactNode;
}) {
  const me = useMe();

  if (me.isPending) return <Skeleton className="h-24 w-full" />;
  if (me.data?.scope === 'BRANCH') return <Notice tone="warning" title={t.centralScopeRequired} />;
  return <>{children}</>;
}
