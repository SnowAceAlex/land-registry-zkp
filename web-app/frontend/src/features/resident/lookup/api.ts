/**
 * features/resident/lookup/api.ts - public record reads (D48, D50).
 *
 * Both routes are unguarded on the same reasoning as D39: they return only
 * pseudonymous commitments, Poseidon hashes and root versions.
 *
 * ⚠️ The public tier returns propertyId, ownerCommitment, status, leaf and
 *    rootVersion only (D50). The eight descriptive certificate fields sit
 *    behind ApiKeyGuard at GET /api/government/properties/:propertyId, because
 *    publishing `encumbranceStatus` and `validityPeriod` would make
 *    mortgage.circom pointless — those two are exactly what it exists to hide.
 *    Never call that route from here to enrich this view.
 *
 * There is deliberately no list call. The stub had `getRecords()`, but a
 * browsable index of every plot is the scrape D50 pushed back on, and this
 * screen looks a plot up by id.
 */

import { apiFetch } from '@/lib/api-client';

export type PropertyStatus = 'IMPORTED' | 'ISSUED' | 'REVOKED';

/** The five public fields — GET /api/records/:propertyId (D50). */
export interface RecordPublic {
  propertyId: string;
  ownerCommitment: string | null;
  status: PropertyStatus;
  leaf: string | null;
  rootVersion: number | null;
}

export type PropertyEventKind =
  | 'ISSUED'
  | 'TRANSFERRED'
  | 'REVOKED'
  | 'ENCUMBRANCE_CHANGED'
  | 'VALIDITY_CHANGED';

/**
 * One append-only event (D48).
 *
 * `detail` is `unknown` on the wire because its shape depends on `kind`. For a
 * REVOKED event it carries `{ reasonCode, detailHash }` and **never**
 * `detailText`: the free-text reason is exactly what D45 kept off the chain and
 * out of this route. `lib/event-summary.ts` narrows it, once.
 */
export interface PropertyEvent {
  kind: PropertyEventKind;
  rootVersion: number | null;
  txHash: string | null;
  previousOwnerCommitment: string | null;
  newOwnerCommitment: string | null;
  previousLeaf: string | null;
  newLeaf: string | null;
  detail: unknown;
  occurredAt: string;
}

export interface PropertyHistory {
  propertyId: string;
  events: PropertyEvent[];
}

/** GET /api/records/:propertyId/history — oldest event first, no pagination. */
export async function getPropertyHistory(propertyId: string): Promise<PropertyHistory> {
  return apiFetch<PropertyHistory>(`/records/${propertyId}/history`);
}

/** GET /api/records/:propertyId — the five-field public tier (D50). */
export async function getPublicRecord(propertyId: string): Promise<RecordPublic> {
  return apiFetch<RecordPublic>(`/records/${propertyId}`);
}
