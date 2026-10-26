import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { LineageNodeDto, LineageResponseDto } from '../history/dto/history.response.dto';
import { toPropertyEventDto } from '../history/property-event.serializer';
import { PrismaService } from '../prisma/prisma.service';

/** Longest chain the portal walks in either direction before cutting it off (D90). */
export const MAX_LINEAGE_NODES = 200;

export interface LineageEdge {
  predecessorPropertyId: string;
  successorPropertyId: string;
}

@Injectable()
export class LineageService {
  constructor(private readonly prisma: PrismaService) {}

  /** successor → its predecessors */
  async predecessorsOf(propertyIds: string[]): Promise<Map<string, string[]>> {
    if (propertyIds.length === 0) return new Map();
    const rows = await this.prisma.propertyLineage.findMany({
      where: { successorPropertyId: { in: propertyIds } },
    });
    return group(
      rows,
      (row) => row.successorPropertyId,
      (row) => row.predecessorPropertyId,
    );
  }

  /** predecessor → its successors */
  async successorsOf(propertyIds: string[]): Promise<Map<string, string[]>> {
    if (propertyIds.length === 0) return new Map();
    const rows = await this.prisma.propertyLineage.findMany({
      where: { predecessorPropertyId: { in: propertyIds } },
    });
    return group(
      rows,
      (row) => row.predecessorPropertyId,
      (row) => row.successorPropertyId,
    );
  }

  /** successor → predecessors not yet REVOKED; successors with none are left out. */
  async unrevokedPredecessors(propertyIds: string[]): Promise<Map<string, string[]>> {
    const predecessors = await this.predecessorsOf(propertyIds);
    const all = [...new Set([...predecessors.values()].flat())];
    if (all.length === 0) return new Map();

    const rows = await this.prisma.property.findMany({
      where: { propertyId: { in: all } },
      select: { propertyId: true, status: true },
    });
    const revoked = new Set(
      rows.filter((row) => row.status === 'REVOKED').map((row) => row.propertyId),
    );

    const result = new Map<string, string[]>();
    for (const [successor, list] of predecessors) {
      const open = list.filter((id) => !revoked.has(id));
      if (open.length > 0) result.set(successor, open);
    }
    return result;
  }

  /** D90: a re-issued certificate waits until every one it supersedes is REVOKED. */
  async assertPredecessorsRevoked(propertyIds: string[]): Promise<void> {
    const blocked = await this.unrevokedPredecessors(propertyIds);
    if (blocked.size === 0) return;
    throw new ConflictException({
      reason: 'PredecessorNotRevoked',
      message: `Superseded certificates are not revoked yet: ${[...blocked.keys()].join(', ')}`,
      details: Object.fromEntries([...blocked].map(([id, preds]) => [id, preds.join(',')])),
    });
  }

  /**
   * D90: the chain of certificates around one plot. Ancestors are reached only through
   * predecessor edges and descendants only through successor edges, so a sibling under a
   * shared parent is listed in the parent's `successors` but not returned as a node.
   * Events are read through Prisma, not PropertyEventService: HistoryModule imports this
   * module and the reverse import would be a cycle.
   */
  async lineageOf(propertyId: string): Promise<LineageResponseDto | null> {
    const generations = new Map<string, number>([[propertyId, 0]]);
    const preds = new Map<string, string[]>();
    const succs = new Map<string, string[]>();
    let truncated = false;

    const walk = async (
      step: 1 | -1,
      lookup: (ids: string[]) => Promise<Map<string, string[]>>,
      into: Map<string, string[]>,
    ) => {
      let frontier = [propertyId];
      let generation = 0;
      while (frontier.length > 0) {
        const found = await lookup(frontier);
        generation += step;
        const next: string[] = [];
        for (const [id, neighbours] of found) {
          into.set(id, neighbours);
          for (const neighbour of neighbours) {
            if (generations.has(neighbour)) continue;
            if (generations.size >= MAX_LINEAGE_NODES) {
              truncated = true;
              continue;
            }
            generations.set(neighbour, generation);
            next.push(neighbour);
          }
        }
        frontier = next;
      }
    };

    await walk(-1, (ids) => this.predecessorsOf(ids), preds);
    await walk(1, (ids) => this.successorsOf(ids), succs);

    // The direction each side's walk did not read, so every node lists both neighbour sets.
    const ancestors = [...generations].filter(([, g]) => g < 0).map(([id]) => id);
    const descendants = [...generations].filter(([, g]) => g > 0).map(([id]) => id);
    for (const [id, list] of await this.successorsOf(ancestors)) succs.set(id, list);
    for (const [id, list] of await this.predecessorsOf(descendants)) preds.set(id, list);

    const ids = [...generations.keys()];
    const properties = await this.prisma.property.findMany({
      where: { propertyId: { in: ids } },
      select: { propertyId: true, status: true },
    });
    const statusOf = new Map(properties.map((row) => [row.propertyId, row.status]));
    if (!statusOf.has(propertyId)) return null;

    const events = await this.prisma.propertyEvent.findMany({
      where: { propertyId: { in: ids } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
    const eventsOf = group(
      events,
      (event) => event.propertyId,
      (event) => toPropertyEventDto(event),
    );

    const nodes: LineageNodeDto[] = ids
      .filter((id) => statusOf.has(id))
      .map((id) => ({
        propertyId: id,
        status: statusOf.get(id)!,
        generation: generations.get(id)!,
        predecessors: sortedIds(preds.get(id)),
        successors: sortedIds(succs.get(id)),
        events: eventsOf.get(id) ?? [],
      }))
      .sort((a, b) => a.generation - b.generation || compareIds(a.propertyId, b.propertyId));

    return { propertyId, nodes, truncated };
  }

  edgesStatement(edges: LineageEdge[]): Prisma.PrismaPromise<unknown> {
    return this.prisma.propertyLineage.createMany({ data: edges, skipDuplicates: true });
  }
}

// propertyId is a string column: compare numerically, never lexically.
function compareIds(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function sortedIds(ids: string[] | undefined): string[] {
  return [...(ids ?? [])].sort(compareIds);
}

function group<T, V = string>(
  rows: T[],
  key: (row: T) => string,
  value: (row: T) => V,
): Map<string, V[]> {
  const result = new Map<string, V[]>();
  for (const row of rows) {
    const list = result.get(key(row));
    if (list) list.push(value(row));
    else result.set(key(row), [value(row)]);
  }
  return result;
}
