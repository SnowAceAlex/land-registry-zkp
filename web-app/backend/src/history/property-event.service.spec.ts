import { PropertyEventService } from './property-event.service';

describe('PropertyEventService', () => {
  const createMany = jest.fn().mockReturnValue({ __statement: true });
  const findMany = jest.fn();
  const prisma = { propertyEvent: { createMany, findMany } } as never;
  const service = new PropertyEventService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('records one ISSUED event per property, carrying the new leaf', () => {
    service.issuedStatements(
      [
        { propertyId: '1001', ownerCommitment: 'c1', leaf: 'l1' },
        { propertyId: '1002', ownerCommitment: 'c2', leaf: 'l2' },
      ],
      { rootVersion: 3, txHash: '0xabc' },
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          propertyId: '1001',
          kind: 'ISSUED',
          rootVersion: 3,
          txHash: '0xabc',
          newOwnerCommitment: 'c1',
          newLeaf: 'l1',
        },
        {
          propertyId: '1002',
          kind: 'ISSUED',
          rootVersion: 3,
          txHash: '0xabc',
          newOwnerCommitment: 'c2',
          newLeaf: 'l2',
        },
      ],
    });
  });

  it('returns the createMany statement from issuedStatements, for the caller to transact', () => {
    const result = service.issuedStatements(
      [{ propertyId: '1001', ownerCommitment: 'c1', leaf: 'l1' }],
      { rootVersion: 3, txHash: '0xabc' },
    );

    expect(result).toEqual([{ __statement: true }]);
  });

  it('returns [] and never calls createMany when issuedStatements gets no inputs', () => {
    const result = service.issuedStatements([], { rootVersion: 3, txHash: '0xabc' });

    expect(result).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('records a TRANSFERRED event keeping both commitments, so the chain of owners survives', () => {
    service.transferredStatements(
      [
        {
          propertyId: '1001',
          previousOwnerCommitment: 'old',
          newOwnerCommitment: 'new',
          previousLeaf: 'lo',
          newLeaf: 'ln',
        },
      ],
      { rootVersion: 4, txHash: '0xdef' },
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          propertyId: '1001',
          kind: 'TRANSFERRED',
          rootVersion: 4,
          txHash: '0xdef',
          previousOwnerCommitment: 'old',
          newOwnerCommitment: 'new',
          previousLeaf: 'lo',
          newLeaf: 'ln',
        },
      ],
    });
  });

  it('returns the createMany statement from transferredStatements, for the caller to transact', () => {
    const result = service.transferredStatements(
      [
        {
          propertyId: '1001',
          previousOwnerCommitment: 'old',
          newOwnerCommitment: 'new',
          previousLeaf: 'lo',
          newLeaf: 'ln',
        },
      ],
      { rootVersion: 4, txHash: '0xdef' },
    );

    expect(result).toEqual([{ __statement: true }]);
  });

  it('returns [] and never calls createMany when transferredStatements gets no inputs', () => {
    const result = service.transferredStatements([], { rootVersion: 4, txHash: '0xdef' });

    expect(result).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('records a REVOKED event with the reason in detail', () => {
    service.revokedStatements(
      [{ propertyId: '1001', previousLeaf: 'lo', reasonCode: 3, detailHash: '0xaa' }],
      { rootVersion: 5, txHash: '0x123' },
    );

    expect(createMany).toHaveBeenCalledWith({
      data: [
        {
          propertyId: '1001',
          kind: 'REVOKED',
          rootVersion: 5,
          txHash: '0x123',
          previousLeaf: 'lo',
          detail: { reasonCode: 3, detailHash: '0xaa' },
        },
      ],
    });
  });

  it('returns the createMany statement from revokedStatements, for the caller to transact', () => {
    const result = service.revokedStatements(
      [{ propertyId: '1001', previousLeaf: 'lo', reasonCode: 3, detailHash: '0xaa' }],
      { rootVersion: 5, txHash: '0x123' },
    );

    expect(result).toEqual([{ __statement: true }]);
  });

  it('returns [] and never calls createMany when revokedStatements gets no inputs', () => {
    const result = service.revokedStatements([], { rootVersion: 5, txHash: '0x123' });

    expect(result).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('lists a property history oldest-first', async () => {
    findMany.mockResolvedValue([]);
    await service.listFor('1001');
    expect(findMany).toHaveBeenCalledWith({
      where: { propertyId: '1001' },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
  });
});
