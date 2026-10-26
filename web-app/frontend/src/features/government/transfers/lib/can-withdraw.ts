import type { Me, TransferRequest } from '../../api/types';

/** Only the central office withdraws, and only an APPROVED transfer; a PENDING one is rejected instead (D87). */
export function canWithdrawTransfer(
  me: Me | undefined,
  row: Pick<TransferRequest, 'status' | 'landOfficeCode'>,
): boolean {
  return me?.scope === 'CENTRAL' && row.status === 'APPROVED';
}
