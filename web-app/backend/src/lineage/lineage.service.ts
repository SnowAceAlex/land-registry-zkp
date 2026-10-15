import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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

  edgesStatement(edges: LineageEdge[]): Prisma.PrismaPromise<unknown> {
    return this.prisma.propertyLineage.createMany({ data: edges, skipDuplicates: true });
  }
}

function group<T>(
  rows: T[],
  key: (row: T) => string,
  value: (row: T) => string,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const list = result.get(key(row));
    if (list) list.push(value(row));
    else result.set(key(row), [value(row)]);
  }
  return result;
}
