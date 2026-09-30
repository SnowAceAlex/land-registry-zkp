import { ConflictException, NotFoundException } from '@nestjs/common';

import { FreezeService } from './freeze.service';

describe('FreezeService (D80)', () => {
  const findUnique = jest.fn();
  const findMany = jest.fn();
  const transferFindFirst = jest.fn();
  const revocationFindFirst = jest.fn();
  const getFrozenOwners = jest.fn();

  const prisma = {
    property: { findUnique, findMany },
    transferRequest: { findFirst: transferFindFirst },
    revocation: { findFirst: revocationFindFirst },
  } as never;
  const service = new FreezeService(prisma, { getFrozenOwners } as never);

  /** The chain freezes exactly these commitments; every other plot reads 0n. */
  const frozenAs = (entries: Record<string, bigint>) =>
    getFrozenOwners.mockImplementation(
      async (ids: string[]) => new Map(ids.map((id) => [id, entries[id] ?? 0n])),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ propertyId: '1001', status: 'ISSUED', ownerCommitment: '111' });
    transferFindFirst.mockResolvedValue(null);
    revocationFindFirst.mockResolvedValue(null);
    frozenAs({});
  });

  describe('status', () => {
    it('offers the freeze calldata for a plot that is not frozen', async () => {
      await expect(service.status('1001')).resolves.toEqual({
        propertyId: '1001',
        ownerCommitment: '111',
        frozenOnChain: false,
        openProcedure: null,
        freezeCalldata: { propertyIds: ['1001'], ownerCommitments: ['111'] },
        unfreezeAllowed: false,
      });
    });

    it('allows an unfreeze only when frozen AND no procedure is open', async () => {
      frozenAs({ '1001': 111n });
      expect((await service.status('1001')).unfreezeAllowed).toBe(true);

      transferFindFirst.mockResolvedValue({ id: 7, status: 'APPROVED' });
      const status = await service.status('1001');
      expect(status.openProcedure).toEqual({ kind: 'transfer', id: 7, status: 'APPROVED' });
      expect(status.unfreezeAllowed).toBe(false);
    });

    it('reports a pending revocation as the open procedure', async () => {
      revocationFindFirst.mockResolvedValue({ id: 3 });
      expect((await service.status('1001')).openProcedure).toEqual({ kind: 'revocation', id: 3 });
    });

    it('does not count a freeze of a PREVIOUS owner as this owner frozen', async () => {
      frozenAs({ '1001': 999n });
      expect((await service.status('1001')).frozenOnChain).toBe(false);
    });

    // F11: 0n is the contract's "not frozen" default, never a real commitment.
    it('never reports frozen when the commitment itself is 0', async () => {
      findUnique.mockResolvedValueOnce({ propertyId: '1001', status: 'ISSUED', ownerCommitment: '0' });
      expect((await service.status('1001')).frozenOnChain).toBe(false);
    });

    it('404s an unknown plot and 409s one that is not issued', async () => {
      findUnique.mockResolvedValueOnce(null);
      await expect(service.status('9')).rejects.toBeInstanceOf(NotFoundException);

      findUnique.mockResolvedValueOnce({ propertyId: '9', status: 'REVOKED', ownerCommitment: '1' });
      await expect(service.status('9')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('assertFrozen', () => {
    it('passes when the chain freezes exactly that commitment', async () => {
      frozenAs({ '1001': 111n });
      await expect(service.assertFrozen('1001', '111')).resolves.toBeUndefined();
    });

    it('throws the OwnerNotFrozen 409 otherwise', async () => {
      frozenAs({ '1001': 222n });
      await expect(service.assertFrozen('1001', '111')).rejects.toMatchObject({
        status: 409,
        response: { reason: 'OwnerNotFrozen', details: { propertyIds: '1001' } },
      });
    });

    // F11: a commitment of "0" must never pass just because it equals the default.
    it('rejects a claimed commitment of 0 even though that matches the default', async () => {
      await expect(service.assertFrozen('1001', '0')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('unfrozenAmong', () => {
    it('returns the plots whose current owner is not frozen, in input order', async () => {
      findMany.mockResolvedValue([
        { propertyId: '3', ownerCommitment: '33' },
        { propertyId: '1', ownerCommitment: '11' },
        { propertyId: '2', ownerCommitment: '22' },
      ]);
      frozenAs({ '2': 22n, '3': 999n });

      await expect(service.unfrozenAmong(['1', '2', '3', '1'])).resolves.toEqual({
        propertyIds: ['1', '3'],
        ownerCommitments: ['11', '33'],
      });
    });

    it('reads nothing for an empty queue', async () => {
      await expect(service.unfrozenAmong([])).resolves.toEqual({
        propertyIds: [],
        ownerCommitments: [],
      });
      expect(getFrozenOwners).not.toHaveBeenCalled();
    });
  });
});
