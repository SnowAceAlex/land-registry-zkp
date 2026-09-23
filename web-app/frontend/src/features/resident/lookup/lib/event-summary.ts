/**
 * features/resident/lookup/lib/event-summary.ts - read one history event (D48).
 *
 * Pure. The wire type has `detail: unknown` because its shape depends on
 * `kind`, and narrowing it in each component would mean trusting the server's
 * shape in several places. It happens here, once.
 */

import { type RevocationReasonCode, isRevocationReasonCode } from '@/lib/revocation-reason';

import type { PropertyEvent, PropertyEventKind, PropertyHistory } from '../api';

export interface EventSummary {
  kind: PropertyEventKind;
  /** The owner commitment changed — a transfer, or the first issuance. */
  ownerChanged: boolean;
  /** The leaf changed, so this event moved the tree. */
  leafChanged: boolean;
  /**
   * Whether the event has made it on chain. `rootVersion === null` means the
   * event is recorded but its root has not been published — a signed-but-
   * unconfirmed draft, or a crash between the two (D43).
   */
  published: boolean;
  /** REVOKED only, and only when the code is one the contract would accept. */
  reasonCode?: RevocationReasonCode;
  /** REVOKED only. keccak256 of the off-chain reason text (D45). */
  detailHash?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function summariseEvent(event: PropertyEvent): EventSummary {
  const summary: EventSummary = {
    kind: event.kind,
    ownerChanged: event.previousOwnerCommitment !== event.newOwnerCommitment,
    leafChanged: event.previousLeaf !== event.newLeaf,
    published: event.rootVersion !== null,
  };

  if (event.kind !== 'REVOKED' || !isRecord(event.detail)) return summary;

  // Only these two fields are read, whatever else the blob happens to carry.
  // D48 forbids `detailText` here, and a future server bug that sent it anyway
  // must not become a leak on a public page — so it is never picked up.
  if (isRevocationReasonCode(event.detail.reasonCode)) {
    summary.reasonCode = event.detail.reasonCode;
  }
  if (typeof event.detail.detailHash === 'string') {
    summary.detailHash = event.detail.detailHash;
  }
  return summary;
}

/**
 * Whether the plot is revoked as of the last event.
 *
 * Not simply "contains a REVOKED event": the status is the CURRENT one, and a
 * plot can be revoked and later issued again. The last event of either kind
 * decides.
 */
export function isRevoked(history: PropertyHistory): boolean {
  for (let i = history.events.length - 1; i >= 0; i--) {
    const kind = history.events[i].kind;
    if (kind === 'REVOKED') return true;
    if (kind === 'ISSUED') return false;
  }
  return false;
}
