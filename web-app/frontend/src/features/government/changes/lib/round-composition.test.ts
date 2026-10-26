import { describe, expect, it } from 'vitest';

import type { IssuanceRequest, PendingChanges, RevocationRow, TransferRequest } from '../../api/types';
import { composeRound } from './round-composition';

const issuance = (id: number, landOfficeCode: string | null): IssuanceRequest => ({
  id,
  landOfficeCode,
}) as IssuanceRequest;
const transfer = (id: number, landOfficeCode: string | null): TransferRequest => ({
  id,
  landOfficeCode,
}) as TransferRequest;
const revocation = (id: number, landOfficeCode: string | null): RevocationRow => ({
  id,
  landOfficeCode,
}) as RevocationRow;

const pending = (over: Partial<PendingChanges>): PendingChanges => ({
  issuances: [],
  transfers: [],
  revocations: [],
  revocationCap: 150,
  ...over,
});

describe('composeRound (D84)', () => {
  it('is empty for an empty queue', () => {
    expect(composeRound(pending({}))).toEqual({
      byKind: { issuance: 0, transfer: 0, revocation: 0 },
      byOffice: [],
      deferredRevocations: 0,
    });
  });

  it('groups by the office owning the plot, unassigned plots last', () => {
    const round = composeRound(
      pending({
        issuances: [issuance(1, 'CN02'), issuance(2, null), issuance(3, 'CN01')],
        transfers: [transfer(1, 'CN02'), transfer(2, 'CN02')],
        revocations: [revocation(1, null), revocation(2, 'CN01')],
      }),
    );

    expect(round.byKind).toEqual({ issuance: 3, transfer: 2, revocation: 2 });
    expect(round.byOffice).toEqual([
      { officeCode: 'CN01', issuance: 1, transfer: 0, revocation: 1 },
      { officeCode: 'CN02', issuance: 1, transfer: 2, revocation: 0 },
      { officeCode: null, issuance: 1, transfer: 0, revocation: 1 },
    ]);
    expect(round.deferredRevocations).toBe(0);
  });

  it('keeps the oldest revocations up to the cap and defers the rest', () => {
    const revocations = [
      revocation(1, 'CN01'),
      revocation(2, 'CN02'),
      revocation(3, 'CN01'),
      revocation(4, 'CN02'),
    ];
    const round = composeRound(pending({ revocations, revocationCap: 3 }));

    expect(round.byKind.revocation).toBe(3);
    expect(round.deferredRevocations).toBe(1);
    expect(round.byOffice).toEqual([
      { officeCode: 'CN01', issuance: 0, transfer: 0, revocation: 2 },
      { officeCode: 'CN02', issuance: 0, transfer: 0, revocation: 1 },
    ]);
  });
});
