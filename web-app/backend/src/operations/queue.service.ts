import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Actor } from '../common/actor';
import { officeCodes } from '../common/office-codes';
import { assertCanActOn } from '../common/office-scope';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_KINDS, QueueItem, QueueKind, QueueRow, toQueueItem } from './queue-item';

export interface QueueFilter {
  kind?: QueueKind;
  officeCode?: string;
  held?: boolean;
  olderThanDays?: number;
  skip: number;
  take: number;
}

type Row = QueueRow & { changeSetId: number | null };

export const OPEN_STATUSES: Record<QueueKind, string[]> = {
  issuance: ['READY'],
  transfer: ['PENDING', 'APPROVED'],
  revocation: ['PENDING'],
};

// Only what a queue row needs: transfers also hold a proof and a buyer secret.
const QUEUE_SELECT = {
  id: true,
  propertyId: true,
  status: true,
  officeId: true,
  landOfficeId: true,
  heldAt: true,
  heldReason: true,
  changeSetId: true,
  createdAt: true,
} as const;

const CLEAR_HOLD = { heldAt: null, heldReason: null };

const WITHDRAWN_TRANSFER_REASON = 'Withdrawn by the central office';

function parseKind(raw: string): QueueKind {
  if (!(QUEUE_KINDS as readonly string[]).includes(raw)) {
    throw new BadRequestException(`kind must be one of ${QUEUE_KINDS.join(', ')}`);
  }
  return raw as QueueKind;
}

@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: QueueFilter, actor: Actor): Promise<{ total: number; items: QueueItem[] }> {
    const offices = await officeCodes(this.prisma);
    const landOfficeId = this.resolveOfficeFilter(filter.officeCode, offices, actor);
    const now = new Date();

    const kinds = filter.kind ? [filter.kind] : [...QUEUE_KINDS];
    // Merged list: each table must supply enough rows to fill the window after the sort.
    const window = filter.kind
      ? { skip: filter.skip, take: filter.take }
      : { skip: 0, take: filter.skip + filter.take };

    const results = await Promise.all(
      kinds.map(async (kind) => {
        const where = this.where(kind, filter, landOfficeId, now);
        const [rows, total] = await Promise.all([
          this.table(kind).findMany({
            where,
            select: QUEUE_SELECT,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            ...window,
          }) as Promise<Row[]>,
          this.table(kind).count({ where }) as Promise<number>,
        ]);
        return { kind, rows, total };
      }),
    );

    const merged = results
      .flatMap(({ kind, rows }) => rows.map((row) => ({ kind, row })))
      .sort((a, b) => a.row.createdAt.getTime() - b.row.createdAt.getTime() || a.row.id - b.row.id);
    const page = filter.kind ? merged : merged.slice(filter.skip, filter.skip + filter.take);

    return {
      total: results.reduce((sum, r) => sum + r.total, 0),
      items: page.map(({ kind, row }) => toQueueItem(kind, row, offices, now)),
    };
  }

  async hold(rawKind: string, id: number, reason: string, _actor: Actor): Promise<QueueItem> {
    const kind = parseKind(rawKind);
    await this.loadOpen(kind, id);
    return this.guardedUpdate(kind, id, { heldAt: new Date(), heldReason: reason });
  }

  async release(rawKind: string, id: number, _actor: Actor): Promise<QueueItem> {
    const kind = parseKind(rawKind);
    await this.loadOpen(kind, id);
    return this.guardedUpdate(kind, id, { heldAt: null, heldReason: null });
  }

  async withdraw(rawKind: string, id: number, actor: Actor): Promise<QueueItem> {
    const kind = parseKind(rawKind);
    // D86: issuance and transfer are central; a revocation is also open to the plot's branch.
    if (kind !== 'revocation' && actor.scope !== 'CENTRAL') {
      throw new ForbiddenException({
        reason: 'CentralScopeRequired',
        message: `Withdrawing a ${kind} is restricted to the head office and its sites (D86)`,
      });
    }
    const row = await this.load(kind, id);
    if (kind === 'revocation') assertCanActOn(actor, row);
    this.assertOpen(kind, id, row);

    if (kind === 'transfer' && row.status === 'PENDING') {
      throw new ConflictException(
        `Transfer ${id} is still PENDING; reject it through /transfers/${id}/reject`,
      );
    }

    const data = {
      issuance: { status: 'WITHDRAWN', ownerSecret: null, ...CLEAR_HOLD },
      transfer: {
        ...CLEAR_HOLD,
        status: 'REJECTED',
        newOwnerSecret: null,
        rejectReason: WITHDRAWN_TRANSFER_REASON,
        decidedAt: new Date(),
      },
      revocation: { status: 'REJECTED', ...CLEAR_HOLD },
    }[kind];
    return this.guardedUpdate(kind, id, data);
  }

  private resolveOfficeFilter(
    officeCode: string | undefined,
    offices: Map<number, string>,
    actor: Actor,
  ): number | undefined {
    if (actor.scope === 'BRANCH') {
      if (officeCode !== undefined && officeCode !== actor.officeCode) {
        throw new ForbiddenException({
          reason: 'OutsideOfficeArea',
          message: `Office ${actor.officeCode} may list only its own queue`,
          details: { officeCode },
        });
      }
      return actor.officeId;
    }
    if (officeCode === undefined) return undefined;
    const id = [...offices].find(([, code]) => code === officeCode)?.[0];
    if (id === undefined) throw new BadRequestException(`Unknown office code ${officeCode}`);
    return id;
  }

  private where(
    kind: QueueKind,
    filter: QueueFilter,
    landOfficeId: number | undefined,
    now: Date,
  ): Record<string, unknown> {
    const open = OPEN_STATUSES[kind];
    return {
      status: open.length === 1 ? open[0] : { in: open },
      ...(landOfficeId !== undefined && { landOfficeId }),
      ...(filter.held !== undefined && { heldAt: filter.held ? { not: null } : null }),
      ...(filter.olderThanDays !== undefined && {
        createdAt: { lt: new Date(now.getTime() - filter.olderThanDays * 86_400_000) },
      }),
    };
  }

  private async load(kind: QueueKind, id: number): Promise<Row> {
    const row = (await this.table(kind).findUnique({ where: { id } })) as Row | null;
    if (!row) throw new NotFoundException(`No ${kind} item ${id}`);
    return row;
  }

  private assertOpen(kind: QueueKind, id: number, row: Row): void {
    if (!OPEN_STATUSES[kind].includes(row.status)) {
      throw new ConflictException(`The ${kind} item ${id} is ${row.status}, not open`);
    }
    if (row.changeSetId !== null) {
      throw new ConflictException({
        reason: 'ItemInOpenDraft',
        message: `The ${kind} item ${id} is already in an open draft`,
        details: { kind, id },
      });
    }
  }

  private async loadOpen(kind: QueueKind, id: number): Promise<Row> {
    const row = await this.load(kind, id);
    this.assertOpen(kind, id, row);
    return row;
  }

  // A round may connect the item between our read and this write; the guard makes that lose.
  private async guardedUpdate(kind: QueueKind, id: number, data: object): Promise<QueueItem> {
    const table = this.table(kind);
    const { count } = (await table.updateMany({
      where: { id, status: { in: OPEN_STATUSES[kind] }, changeSetId: null },
      data,
    })) as { count: number };
    if (count === 0) {
      await this.loadOpen(kind, id);
      throw new ConflictException(`The ${kind} item ${id} changed while it was being updated`);
    }
    const row = await this.load(kind, id);
    return toQueueItem(kind, row, await officeCodes(this.prisma), new Date());
  }

  // The three delegates share these calls; Prisma's generated types cannot express that.
  private table(kind: QueueKind) {
    const delegates = {
      issuance: this.prisma.issuanceRequest,
      transfer: this.prisma.transferRequest,
      revocation: this.prisma.revocation,
    };
    return delegates[kind] as unknown as {
      findMany(args: object): Promise<unknown>;
      count(args: object): Promise<unknown>;
      findUnique(args: object): Promise<unknown>;
      updateMany(args: object): Promise<unknown>;
    };
  }
}
