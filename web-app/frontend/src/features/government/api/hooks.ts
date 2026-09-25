'use client';

/**
 * features/government/api/hooks.ts - reads more than one use case needs.
 *
 * Registry status and the open draft are portal-wide facts: the status bar
 * shows them on every page, and both publishing screens decide what to offer
 * from them. They live in one query cache (the QueryClientProvider mounted by
 * wallet-providers.tsx) so every screen agrees and a mutation that changes
 * them invalidates one key.
 */

import { useQuery } from '@tanstack/react-query';

import { govGet } from './gov-client';
import type { OpenDraft, PendingChanges, RegistryStatus, TransferRequest } from './types';

export const govKeys = {
  status: ['gov', 'status'] as const,
  openDraft: ['gov', 'drafts', 'open'] as const,
  transfers: (status: string) => ['gov', 'transfers', status] as const,
  properties: (status: string, skip: number) => ['gov', 'properties', status, skip] as const,
  issuanceBatches: ['gov', 'issuance-batches'] as const,
  pendingChanges: ['gov', 'pending-changes'] as const,
  changeSets: ['gov', 'changesets'] as const,
};

/** GET /government/status — chain identity (D54) and the on-chain root. */
export function useRegistryStatus() {
  return useQuery({
    queryKey: govKeys.status,
    queryFn: () => govGet<RegistryStatus>('/government/status'),
    refetchInterval: 20_000,
  });
}

/** GET /government/drafts/open — `null` when nothing is waiting (D53). */
export function useOpenDraft() {
  return useQuery({
    queryKey: govKeys.openDraft,
    queryFn: async () => (await govGet<{ draft: OpenDraft | null }>('/government/drafts/open')).draft,
  });
}

/**
 * Transfers proven against the current root and not yet approved. Any publish
 * moves the root, and approve() then auto-rejects them with RootMismatch — so
 * both publishing screens warn with this count before signing.
 */
export function usePendingTransferCount() {
  return useQuery({
    queryKey: govKeys.transfers('PENDING'),
    queryFn: () => govGet<TransferRequest[]>('/transfers?status=PENDING'),
    select: (transfers) => transfers.length,
  });
}

/**
 * GET /government/pending-changes — what the next change set would publish
 * (D46), plus the revocation cap (D73). Read by the Changes page (the round)
 * and the Revocations page (what is already queued), so both share one key.
 */
export function usePendingChanges() {
  return useQuery({
    queryKey: govKeys.pendingChanges,
    queryFn: () => govGet<PendingChanges>('/government/pending-changes'),
  });
}
