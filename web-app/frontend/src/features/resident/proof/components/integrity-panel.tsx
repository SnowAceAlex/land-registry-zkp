/**
 * features/resident/proof/components/integrity-panel.tsx
 *
 * The four checks `checkBundleIntegrity` runs, each shown as passed or failed,
 * plus the registry-position banners.
 *
 * Every check is listed even when they all pass. The owner is being asked to
 * trust that their file is intact before they hand a proof to a bank; a silent
 * green page does not earn that, and a failure would otherwise appear with no
 * context for what was being checked.
 */

import { Check, X } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { Notice } from '@/components/ui/notice';

import type { IntegrityIssue } from '../lib/bundle-integrity';

type Strings = Dictionary['residentProof'];

/** Which issue invalidates which line. */
const CHECKS: { label: keyof Strings; issues: IntegrityIssue[] }[] = [
  { label: 'check_leaf', issues: ['leaf-mismatch'] },
  { label: 'check_secret', issues: ['secret-mismatch'] },
  { label: 'check_merkle', issues: ['merkle-mismatch'] },
  { label: 'check_depth', issues: ['depth-retired', 'depth-mismatch', 'property-mismatch'] },
];

const ISSUE_KEYS = {
  'leaf-mismatch': 'issue_leaf-mismatch',
  'secret-mismatch': 'issue_secret-mismatch',
  'merkle-mismatch': 'issue_merkle-mismatch',
  'depth-retired': 'issue_depth-retired',
  'depth-mismatch': 'issue_depth-mismatch',
  'property-mismatch': 'issue_property-mismatch',
} as const satisfies Record<IntegrityIssue, keyof Strings>;

export function IntegrityPanel({ issues, t }: { issues: IntegrityIssue[]; t: Strings }) {
  const failed = new Set(issues);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium tracking-tight text-ink">{t.integrityTitle}</h2>

      <ul className="space-y-1.5">
        {CHECKS.map(({ label, issues: owned }) => {
          const broken = owned.some((issue) => failed.has(issue));
          return (
            <li key={label} className="flex items-start gap-2 text-sm">
              {broken ? (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-red-600" strokeWidth={2} aria-hidden />
              ) : (
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                  strokeWidth={2}
                  aria-hidden
                />
              )}
              <span className={broken ? 'text-red-900' : 'text-ink'}>{t[label]}</span>
            </li>
          );
        })}
      </ul>

      {issues.length > 0 ? (
        <Notice tone="danger" title={t.integrityFailedTitle}>
          <ul className="list-disc space-y-1 pl-4">
            {issues.map((issue) => (
              <li key={issue}>{t[ISSUE_KEYS[issue]]}</li>
            ))}
          </ul>
          <p className="mt-2">{t.integrityFailedBody}</p>
        </Notice>
      ) : null}
    </section>
  );
}
