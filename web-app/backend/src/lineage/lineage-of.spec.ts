import { LineageService, MAX_LINEAGE_NODES } from './lineage.service';
import { PrismaService } from '../prisma/prisma.service';

type Edge = { predecessorPropertyId: string; successorPropertyId: string };
type Where = { propertyId?: { in: string[] } };

const edge = (predecessorPropertyId: string, successorPropertyId: string): Edge => ({
  predecessorPropertyId,
  successorPropertyId,
});

function makeService(edges: Edge[], known: string[], statuses: Record<string, string> = {}) {
  const lineageFindMany = jest.fn(
    async ({
      where,
    }: {
      where: { successorPropertyId?: { in: string[] }; predecessorPropertyId?: { in: string[] } };
    }) =>
      edges.filter((e) =>
        where.successorPropertyId
          ? where.successorPropertyId.in.includes(e.successorPropertyId)
          : where.predecessorPropertyId!.in.includes(e.predecessorPropertyId),
      ),
  );
  const propertyFindMany = jest.fn(async ({ where }: { where: Where }) =>
    where
      .propertyId!.in.filter((id) => known.includes(id))
      .map((id) => ({ propertyId: id, status: statuses[id] ?? 'ISSUED' })),
  );
  const eventFindMany = jest.fn(async ({ where }: { where: Where }) =>
    where.propertyId!.in.map((id, index) => ({
      id: index + 1,
      propertyId: id,
      kind: 'ISSUED',
      rootVersion: 1,
      txHash: null,
      previousOwnerCommitment: null,
      newOwnerCommitment: `c${id}`,
      previousLeaf: null,
      newLeaf: `l${id}`,
      detail: null,
      occurredAt: new Date(0),
    })),
  );
  const prisma = {
    propertyLineage: { findMany: lineageFindMany },
    property: { findMany: propertyFindMany },
    propertyEvent: { findMany: eventFindMany },
  } as unknown as PrismaService;
  return {
    service: new LineageService(prisma),
    lineageFindMany,
    propertyFindMany,
    eventFindMany,
  };
}

const summary = (nodes: { propertyId: string; generation: number }[]) =>
  nodes.map((n) => `${n.propertyId}@${n.generation}`);

describe('LineageService.lineageOf', () => {
  it('walks a 1 -> 1 chain of three generations from the middle', async () => {
    const { service } = makeService([edge('1', '2'), edge('2', '3')], ['1', '2', '3'], {
      '1': 'REVOKED',
      '2': 'REVOKED',
    });

    const result = await service.lineageOf('2');

    expect(result!.propertyId).toBe('2');
    expect(result!.truncated).toBe(false);
    expect(summary(result!.nodes)).toEqual(['1@-1', '2@0', '3@1']);
    expect(result!.nodes[0].status).toBe('REVOKED');
    expect(result!.nodes[1]).toMatchObject({ predecessors: ['1'], successors: ['3'] });
    expect(result!.nodes[0].events).toHaveLength(1);
  });

  it('from one child of a split: includes the parent but not the sibling', async () => {
    const { service } = makeService([edge('1', '10'), edge('1', '11')], ['1', '10', '11']);

    const result = await service.lineageOf('10');

    expect(summary(result!.nodes)).toEqual(['1@-1', '10@0']);
    expect(result!.nodes[0].successors).toEqual(['10', '11']);
  });

  it('from the child of a merge: includes both parents at generation -1', async () => {
    const { service } = makeService([edge('1', '10'), edge('2', '10')], ['1', '2', '10']);

    const result = await service.lineageOf('10');

    expect(summary(result!.nodes)).toEqual(['1@-1', '2@-1', '10@0']);
    expect(result!.nodes[2].predecessors).toEqual(['1', '2']);
  });

  it('sorts same-generation nodes numerically, not lexically', async () => {
    const { service } = makeService([edge('9', '50'), edge('10', '50')], ['9', '10', '50']);

    const result = await service.lineageOf('50');

    expect(summary(result!.nodes)).toEqual(['9@-1', '10@-1', '50@0']);
  });

  it('terminates on a cycle in bad data', async () => {
    const { service } = makeService([edge('1', '2'), edge('2', '1')], ['1', '2']);

    const result = await service.lineageOf('1');

    expect(summary(result!.nodes)).toEqual(['2@-1', '1@0']);
    expect(result!.truncated).toBe(false);
  });

  it('batches one lineage query per BFS layer, plus one per missing direction', async () => {
    const { service, lineageFindMany, propertyFindMany, eventFindMany } = makeService(
      [edge('1', '2'), edge('2', '3'), edge('3', '4')],
      ['1', '2', '3', '4'],
    );

    await service.lineageOf('2');

    // ancestors {2},{1}; descendants {2},{3},{4}; then successors of ancestors, predecessors of descendants
    expect(lineageFindMany).toHaveBeenCalledTimes(7);
    expect(propertyFindMany).toHaveBeenCalledTimes(1);
    expect(eventFindMany).toHaveBeenCalledTimes(1);
  });

  it('truncates at MAX_LINEAGE_NODES and says so', async () => {
    const count = MAX_LINEAGE_NODES + 50;
    const ids = Array.from({ length: count }, (_, i) => String(i + 1));
    const edges = ids.slice(1).map((id, i) => edge(ids[i], id));
    const { service } = makeService(edges, ids);

    const result = await service.lineageOf('1');

    expect(result!.nodes).toHaveLength(MAX_LINEAGE_NODES);
    expect(result!.truncated).toBe(true);
  });

  it('is not truncated when the chain is exactly the cap', async () => {
    const ids = Array.from({ length: MAX_LINEAGE_NODES }, (_, i) => String(i + 1));
    const edges = ids.slice(1).map((id, i) => edge(ids[i], id));
    const { service } = makeService(edges, ids);

    const result = await service.lineageOf('1');

    expect(result!.nodes).toHaveLength(MAX_LINEAGE_NODES);
    expect(result!.truncated).toBe(false);
  });

  it('returns null for an unknown property', async () => {
    const { service, eventFindMany } = makeService([], []);

    expect(await service.lineageOf('404')).toBeNull();
    expect(eventFindMany).not.toHaveBeenCalled();
  });

  it('returns a lone node for a plot with no lineage', async () => {
    const { service } = makeService([], ['5']);

    const result = await service.lineageOf('5');

    expect(summary(result!.nodes)).toEqual(['5@0']);
    expect(result!.nodes[0]).toMatchObject({ predecessors: [], successors: [] });
  });
});
