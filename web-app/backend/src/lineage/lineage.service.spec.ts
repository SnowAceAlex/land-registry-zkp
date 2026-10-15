import { LineageService } from './lineage.service';
import { PrismaService } from '../prisma/prisma.service';

type Edge = { predecessorPropertyId: string; successorPropertyId: string };

function makeService(edges: Edge[], statuses: Record<string, string> = {}) {
  const lineageFindMany = jest.fn(
    async ({
      where,
    }: {
      where: { successorPropertyId?: { in: string[] }; predecessorPropertyId?: { in: string[] } };
    }) =>
      edges.filter((edge) =>
        where.successorPropertyId
          ? where.successorPropertyId.in.includes(edge.successorPropertyId)
          : where.predecessorPropertyId!.in.includes(edge.predecessorPropertyId),
      ),
  );
  const createMany = jest.fn((args: unknown) => Promise.resolve(args));
  const propertyFindMany = jest.fn(async ({ where }: { where: { propertyId: { in: string[] } } }) =>
    where.propertyId.in
      .filter((propertyId) => propertyId in statuses)
      .map((propertyId) => ({ propertyId, status: statuses[propertyId] })),
  );
  const prisma = {
    propertyLineage: { findMany: lineageFindMany, createMany },
    property: { findMany: propertyFindMany },
  } as unknown as PrismaService;
  return { service: new LineageService(prisma), lineageFindMany, createMany, propertyFindMany };
}

const edge = (predecessorPropertyId: string, successorPropertyId: string): Edge => ({
  predecessorPropertyId,
  successorPropertyId,
});

describe('LineageService', () => {
  const edges = [edge('1', '10'), edge('2', '10'), edge('3', '11')];

  it('maps each successor to its predecessors', async () => {
    const { service } = makeService(edges);

    const result = await service.predecessorsOf(['10', '11', '12']);

    expect(result).toEqual(
      new Map([
        ['10', ['1', '2']],
        ['11', ['3']],
      ]),
    );
  });

  it('maps each predecessor to its successors', async () => {
    const { service } = makeService([...edges, edge('1', '12')]);

    const result = await service.successorsOf(['1', '3']);

    expect(result).toEqual(
      new Map([
        ['1', ['10', '12']],
        ['3', ['11']],
      ]),
    );
  });

  it('does not query for an empty id list', async () => {
    const { service, lineageFindMany } = makeService(edges);

    expect((await service.predecessorsOf([])).size).toBe(0);
    expect((await service.successorsOf([])).size).toBe(0);
    expect((await service.unrevokedPredecessors([])).size).toBe(0);
    expect(lineageFindMany).not.toHaveBeenCalled();
  });

  describe('unrevokedPredecessors', () => {
    it('keeps predecessors that are not REVOKED and drops the revoked ones', async () => {
      const { service } = makeService(edges, { '1': 'REVOKED', '2': 'ISSUED', '3': 'REVOKED' });

      const result = await service.unrevokedPredecessors(['10', '11']);

      // 11's only predecessor is revoked, so it has no entry at all.
      expect(result).toEqual(new Map([['10', ['2']]]));
    });

    it('treats a predecessor with no Property row as unrevoked', async () => {
      const { service } = makeService(edges, { '1': 'REVOKED' });

      const result = await service.unrevokedPredecessors(['10']);

      expect(result).toEqual(new Map([['10', ['2']]]));
    });

    it('returns nothing for a successor with no predecessors', async () => {
      const { service } = makeService(edges);

      expect((await service.unrevokedPredecessors(['99'])).size).toBe(0);
    });
  });

  it('builds an idempotent createMany for the edges', async () => {
    const { service, createMany } = makeService([]);

    await service.edgesStatement([edge('1', '10')]);

    expect(createMany).toHaveBeenCalledWith({ data: [edge('1', '10')], skipDuplicates: true });
  });
});
