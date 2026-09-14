/**
 * features/resident/lookup/components/lookup-view.tsx - D48, public property
 * history.
 *
 * TODO (Phase 9):
 *  1. GET /api/records/:propertyId/history via ../api.ts. Unguarded on the same
 *     reasoning as D39: it returns only pseudonymous commitments and Poseidon
 *     hashes.
 *  2. Note what the two-tier read split means here (D50). The public route
 *     returns propertyId, ownerCommitment, status, leaf and rootVersion only.
 *     The eight descriptive certificate fields sit behind ApiKeyGuard at
 *     GET /api/government/properties/:propertyId, because publishing
 *     encumbranceStatus and validityPeriod would make mortgage.circom pointless.
 *     Do not reach for the government route to enrich this view.
 *  3. Render the lifecycle as events: issued, transferred, revoked, with the
 *     root version each was published under. font-mono for ids and hashes.
 *  4. States: idle / searching / found / not found / API unreachable.
 *     The search form needs state, so split it into a 'use client' component
 *     in this folder and keep this view a Server Component.
 */
import { History } from 'lucide-react';

import type { Dictionary } from '@/i18n/dictionaries';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonStyles } from '@/components/ui/button';

export function LookupView({ t }: { t: Dictionary['residentLookup'] }) {
  return (
    <div className="space-y-8">
      <PageHeader title={t.title} description={t.description} />

      <form className="flex max-w-xl flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="property-id" className="sr-only">
            {t.label}
          </label>
          <input
            id="property-id"
            name="property-id"
            type="text"
            inputMode="numeric"
            placeholder="1001"
            className="w-full rounded-lg border border-hairline bg-white px-4 py-2.5 font-mono text-sm text-ink ui-transition placeholder:text-zinc-400 focus:border-authority"
          />
        </div>
        <button type="submit" disabled className={buttonStyles.primary}>
          {t.search}
        </button>
      </form>

      <EmptyState icon={History} title={t.emptyTitle} description={t.emptyBody} />
    </div>
  );
}
