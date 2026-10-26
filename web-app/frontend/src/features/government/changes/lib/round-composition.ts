import type { PendingChanges, QueueKind } from '../../api/types';

export interface OfficeShare {
  /** The office owning the plot's area; `null` is the unassigned plots. */
  officeCode: string | null;
  issuance: number;
  transfer: number;
  revocation: number;
}

export interface RoundComposition {
  byKind: Record<QueueKind, number>;
  byOffice: OfficeShare[];
  deferredRevocations: number;
}

/**
 * What the next round would carry. Revocations past the cap wait (the backend
 * keeps the oldest, and the list arrives oldest first), so they are counted as
 * deferred rather than as part of the round.
 */
export function composeRound(pending: PendingChanges): RoundComposition {
  const kept = pending.revocations.slice(0, pending.revocationCap);
  const offices = new Map<string | null, OfficeShare>();

  const bump = (officeCode: string | null, kind: QueueKind) => {
    let share = offices.get(officeCode);
    if (!share) {
      share = { officeCode, issuance: 0, transfer: 0, revocation: 0 };
      offices.set(officeCode, share);
    }
    share[kind] += 1;
  };

  for (const item of pending.issuances) bump(item.landOfficeCode, 'issuance');
  for (const item of pending.transfers) bump(item.landOfficeCode, 'transfer');
  for (const item of kept) bump(item.landOfficeCode, 'revocation');

  const byOffice = [...offices.values()].sort((a, b) => {
    if (a.officeCode === b.officeCode) return 0;
    if (a.officeCode === null) return 1;
    if (b.officeCode === null) return -1;
    return a.officeCode < b.officeCode ? -1 : 1;
  });

  return {
    byKind: {
      issuance: pending.issuances.length,
      transfer: pending.transfers.length,
      revocation: kept.length,
    },
    byOffice,
    deferredRevocations: pending.revocations.length - kept.length,
  };
}
