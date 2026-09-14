/**
 * features/resident/lookup/api.ts - public record reads (D48, D50).
 *
 * TODO (Phase 9):
 *  1. Implement getPropertyHistory(propertyId) -> GET /api/records/:propertyId/history
 *     (PropertyHistoryResponseDto: events oldest first, each with kind,
 *     rootVersion, txHash). Unguarded on the same reasoning as D39.
 *  2. Replace `unknown` with the backend response shapes.
 *
 * The public routes return propertyId, ownerCommitment, status, leaf and
 * rootVersion only (D50). Never call GET /api/government/properties/:propertyId
 * from here to enrich the view - that route is behind ApiKeyGuard on purpose.
 */
import { apiFetch } from '@/lib/api-client';

export async function getRecords(): Promise<unknown[]> {
  return apiFetch<unknown[]>('/records');
}

export async function getRecord(propertyId: string): Promise<unknown> {
  return apiFetch<unknown>(`/records/${propertyId}`);
}
