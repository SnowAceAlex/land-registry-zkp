import type { Me, RevocationRow } from '../../api/types';

/** A PENDING revocation: the central office anywhere, a branch only on its own area (D86, D87). */
export function canWithdrawRevocation(
  me: Me | undefined,
  row: Pick<RevocationRow, 'status' | 'landOfficeCode'>,
): boolean {
  if (!me || row.status !== 'PENDING') return false;
  return (
    me.scope === 'CENTRAL' || (row.landOfficeCode !== null && row.landOfficeCode === me.office.code)
  );
}
