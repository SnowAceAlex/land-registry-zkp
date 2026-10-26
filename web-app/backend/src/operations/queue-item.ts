import { isFallback } from '../common/office-scope';

export type QueueKind = 'issuance' | 'transfer' | 'revocation';

export const QUEUE_KINDS: readonly QueueKind[] = ['issuance', 'transfer', 'revocation'];

export interface QueueItem {
  kind: QueueKind;
  id: number;
  propertyId: string;
  officeCode: string | null;
  landOfficeCode: string | null;
  status: string;
  ageHours: number;
  held: boolean;
  heldReason: string | null;
  /** A central office filed a transfer or revocation on a plot that belongs to another office. */
  byFallback: boolean;
}

export interface QueueRow {
  id: number;
  propertyId: string;
  status: string;
  officeId: number;
  landOfficeId: number | null;
  heldAt: Date | null;
  heldReason: string | null;
  createdAt: Date;
}

const HOUR_MS = 3_600_000;

// Keys are listed one by one on purpose: the rows behind this also hold secrets (D50/D77).
export function toQueueItem(
  kind: QueueKind,
  row: QueueRow,
  offices: Map<number, string>,
  now: Date,
): QueueItem {
  return {
    kind,
    id: row.id,
    propertyId: row.propertyId,
    officeCode: offices.get(row.officeId) ?? null,
    landOfficeCode: row.landOfficeId === null ? null : (offices.get(row.landOfficeId) ?? null),
    status: row.status,
    ageHours: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / HOUR_MS)),
    held: row.heldAt !== null,
    heldReason: row.heldReason,
    // Issuance always belongs to the central office (D87), so it is never a stand-in.
    byFallback: kind !== 'issuance' && isFallback(row.officeId, row.landOfficeId),
  };
}
