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
import type {
  ArchiveSummary,
  ChangeSetSummary,
  Me,
  OfficeRow,
  OpenDraft,
  Overview,
  PendingChanges,
  QueueFilter,
  QueueList,
  RegistryStatus,
  TransferRequest,
} from './types';

export const govKeys = {
  status: ['gov', 'status'] as const,
  openDraft: ['gov', 'drafts', 'open'] as const,
  transfers: (status: string) => ['gov', 'transfers', status] as const,
  properties: (status: string, skip: number) => ['gov', 'properties', status, skip] as const,
  me: ['gov', 'me'] as const,
  overview: ['gov', 'operations', 'overview'] as const,
  offices: ['gov', 'operations', 'offices'] as const,
  queueAll: ['gov', 'queue'] as const,
  queue: (filter: QueueFilter) => ['gov', 'queue', filter] as const,
  archives: ['gov', 'archives'] as const,
  issuanceRequests: (status: string) => ['gov', 'issuance-requests', status] as const,
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

/** GET /government/me — the office behind the key and its scope (D86). */
export function useMe() {
  return useQuery({
    queryKey: govKeys.me,
    queryFn: () => govGet<Me>('/government/me'),
    staleTime: Infinity,
  });
}

/** GET /government/operations/overview — registry state, queue totals and coded alerts (D89). */
export function useOverview() {
  return useQuery({
    queryKey: govKeys.overview,
    queryFn: () => govGet<Overview>('/government/operations/overview'),
    refetchInterval: 30_000,
  });
}

/** GET /government/operations/offices — central only, so a branch passes `false`. */
export function useOfficeRows(enabled: boolean) {
  return useQuery({
    queryKey: govKeys.offices,
    queryFn: () => govGet<OfficeRow[]>('/government/operations/offices'),
    enabled,
  });
}

/** GET /government/queue — open items of the three procedures, oldest first (D87). */
export function useQueue(filter: QueueFilter) {
  return useQuery({
    queryKey: govKeys.queue(filter),
    queryFn: () => govGet<QueueList>(`/government/queue${queryString(filter)}`),
  });
}

/** GET /government/changesets — every round, newest first, summary columns only (D77). */
export function useChangeSets() {
  return useQuery({
    queryKey: govKeys.changeSets,
    queryFn: () => govGet<ChangeSetSummary[]>('/government/changesets'),
  });
}

/** GET /government/archives — every round's archives this office may see (D88). */
export function useArchives() {
  return useQuery({
    queryKey: govKeys.archives,
    queryFn: () => govGet<ArchiveSummary[]>('/government/archives'),
  });
}

function queryString(filter: QueueFilter): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}
