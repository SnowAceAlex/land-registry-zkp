import { Injectable } from '@nestjs/common';

import { ChainService } from '../chain/chain.service';
import { Actor } from '../common/actor';
import { DraftLockService } from '../common/draft-lock.service';
import { isFallback } from '../common/office-scope';
import { revocationCap } from '../government/changeset.service';
import { PrismaService } from '../prisma/prisma.service';
import { AttestationService } from '../proof/attestation.service';
import { OperationsSnapshot, alertsForActor, deriveAlerts } from './alerts';
import { OfficeRowDto, OpenDraftSummaryDto, OverviewDto } from './dto/operations.dto';
import { QUEUE_KINDS, QueueKind } from './queue-item';
import { OPEN_STATUSES } from './queue.service';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const ARCHIVE_WARNING_DAYS = 2;
const DEFAULT_STALE_DAYS = 2;

type OfficeId = number | null;
type Group = {
  landOfficeId: OfficeId;
  officeId?: number;
  _count: number;
  _min?: { createdAt: Date | null };
};

interface Bucket {
  issuance: number;
  transfer: number;
  revocation: number;
  held: number;
  heldRevocation: number;
  oldest: Date | null;
}

const emptyBucket = (): Bucket => ({
  issuance: 0,
  transfer: 0,
  revocation: 0,
  held: 0,
  heldRevocation: 0,
  oldest: null,
});

/** QUEUE_STALE_DAYS as a positive integer, else the default. */
function staleDays(): number {
  const raw = process.env.QUEUE_STALE_DAYS?.trim() ?? '';
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_STALE_DAYS;
}

function add<K>(map: Map<K, number>, key: K, n: number): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

// D89: the operations page. Every number is a groupBy over indexed columns, never a row load.
@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
    private readonly attestation: AttestationService,
    private readonly draftLock: DraftLockService,
  ) {}

  async overview(actor: Actor, now = new Date()): Promise<OverviewDto> {
    const cap = revocationCap();
    const [
      chainRoot,
      dbRoot,
      openDraft,
      offices,
      buckets,
      stale,
      pending,
      archives,
      unassignedProperties,
      authorityHasRole,
      attesterHasRole,
    ] = await Promise.all([
      this.chain.getRoot(),
      this.prisma.merkleRoot.findFirst({ orderBy: { version: 'desc' } }),
      this.loadOpenDraft(),
      this.loadOffices(),
      this.bucketsByOffice(),
      this.staleByOffice(now),
      this.pendingTransfersByOffice(),
      this.archiveWindows(now),
      this.prisma.property.count({ where: { landOfficeId: null, status: { not: 'REVOKED' } } }),
      this.chain.hasAuthorityRole(this.chain.authorityAddress).catch(() => false),
      this.chain.hasAttesterRole(this.attestation.address).catch(() => false),
    ]);

    const codes = new Map(offices.map((o) => [o.id, o.code]));
    const named = (counts: Map<OfficeId, number>) =>
      [...counts].map(([id, count]) => ({
        officeCode: id === null ? null : (codes.get(id) ?? null),
        count,
      }));
    const archiveRows = (rows: { changeSetId: number; officeId: number }[]) =>
      rows.flatMap((r) => {
        const officeCode = codes.get(r.officeId);
        return officeCode ? [{ officeCode, changeSetId: r.changeSetId }] : [];
      });

    const all = [...buckets.values()];
    const sum = (pick: (b: Bucket) => number) => all.reduce((n, b) => n + pick(b), 0);
    const chainRootText = chainRoot.root.toString();

    const snapshot: OperationsSnapshot = {
      chainRoot: chainRootText,
      dbLatestRoot: dbRoot?.root ?? null,
      openDraftRoot: openDraft?.newRoot ?? null,
      pendingTransfers: named(pending),
      revocationsWaiting: sum((b) => b.revocation - b.heldRevocation),
      revocationCap: cap,
      staleItems: named(stale),
      archivesNearExpiry: archiveRows(archives.nearExpiry),
      archivesExpiredUndownloaded: archiveRows(archives.expired),
      unassignedProperties,
      heldItems: sum((b) => b.held),
      authorityHasRole,
      attesterHasRole,
    };

    // D86: a branch's totals are its own area only.
    const scoped = actor.scope === 'BRANCH' ? [buckets.get(actor.officeId) ?? emptyBucket()] : all;
    const total = (pick: (b: Bucket) => number) => scoped.reduce((n, b) => n + pick(b), 0);
    const waiting = total((b) => b.revocation - b.heldRevocation);

    return {
      registry: {
        network: this.chain.network,
        chainId: this.chain.chainId,
        onChainVersion: chainRoot.version,
        onChainRoot: chainRootText,
        dbVersion: dbRoot?.version ?? null,
        lastPublishedAt: dbRoot?.publishedAt ?? null,
        lastTxHash: dbRoot?.txHash ?? null,
        // Same rule as the registry status route.
        inSync: dbRoot ? dbRoot.root === chainRootText : chainRoot.version === 0,
      },
      openDraft,
      queue: {
        issuance: total((b) => b.issuance),
        transfer: total((b) => b.transfer),
        revocation: total((b) => b.revocation),
        held: total((b) => b.held),
      },
      revocationCap: cap,
      roundsNeeded: Math.ceil(waiting / cap),
      alerts: alertsForActor(deriveAlerts(snapshot), actor),
    };
  }

  /** One row per office plus the unassigned row; counts follow the plot's area. */
  async offices(now = new Date()): Promise<OfficeRowDto[]> {
    const [offices, buckets, fallback] = await Promise.all([
      this.loadOffices(),
      this.bucketsByOffice(),
      this.fallbackByOffice(),
    ]);
    const row = (
      id: OfficeId,
      office: { code: string; name: string; kind: OfficeRowDto['kind'] } | null,
    ): OfficeRowDto => {
      const b = buckets.get(id) ?? emptyBucket();
      return {
        officeCode: office?.code ?? null,
        officeName: office?.name ?? null,
        kind: office?.kind ?? null,
        issuance: b.issuance,
        transfer: b.transfer,
        revocation: b.revocation,
        held: b.held,
        fallback: fallback.get(id) ?? 0,
        oldestAgeHours:
          b.oldest === null
            ? null
            : Math.max(0, Math.floor((now.getTime() - b.oldest.getTime()) / HOUR_MS)),
      };
    };
    return [...offices.map((o) => row(o.id, o)), row(null, null)];
  }

  private loadOffices() {
    return this.prisma.landOffice.findMany({
      select: { id: true, code: true, name: true, kind: true },
      orderBy: { id: 'asc' },
    });
  }

  private async loadOpenDraft(): Promise<OpenDraftSummaryDto | null> {
    const open = await this.draftLock.openDraft();
    if (!open) return null;
    const row = await this.prisma.changeSet.findUnique({
      where: { id: open.id },
      select: { newRoot: true, createdAt: true },
    });
    return row ? { id: open.id, newRoot: row.newRoot, createdAt: row.createdAt } : null;
  }

  /** Open counts, held counts and the oldest createdAt per plot area, over all three tables. */
  private async bucketsByOffice(): Promise<Map<OfficeId, Bucket>> {
    const buckets = new Map<OfficeId, Bucket>();
    const bucket = (id: OfficeId) => {
      const b = buckets.get(id) ?? emptyBucket();
      buckets.set(id, b);
      return b;
    };

    await Promise.all(
      QUEUE_KINDS.map(async (kind) => {
        const status = { in: OPEN_STATUSES[kind] };
        const [opened, held] = await Promise.all([
          this.group(kind, {
            by: ['landOfficeId'],
            where: { status },
            _count: true,
            _min: { createdAt: true },
          }),
          this.group(kind, {
            by: ['landOfficeId'],
            where: { status, heldAt: { not: null } },
            _count: true,
          }),
        ]);
        for (const g of opened) {
          const b = bucket(g.landOfficeId);
          b[kind] += g._count;
          const created = g._min?.createdAt ?? null;
          if (created && (b.oldest === null || created < b.oldest)) b.oldest = created;
        }
        for (const g of held) {
          const b = bucket(g.landOfficeId);
          b.held += g._count;
          if (kind === 'revocation') b.heldRevocation += g._count;
        }
      }),
    );
    return buckets;
  }

  private async staleByOffice(now: Date): Promise<Map<OfficeId, number>> {
    const cutoff = new Date(now.getTime() - staleDays() * DAY_MS);
    const counts = new Map<OfficeId, number>();
    const perKind = await Promise.all(
      QUEUE_KINDS.map((kind) =>
        this.group(kind, {
          by: ['landOfficeId'],
          where: { status: { in: OPEN_STATUSES[kind] }, createdAt: { lt: cutoff } },
          _count: true,
        }),
      ),
    );
    for (const g of perKind.flat()) add(counts, g.landOfficeId, g._count);
    return counts;
  }

  private async pendingTransfersByOffice(): Promise<Map<OfficeId, number>> {
    const counts = new Map<OfficeId, number>();
    const groups = await this.group('transfer', {
      by: ['landOfficeId'],
      where: { status: 'PENDING' },
      _count: true,
    });
    for (const g of groups) add(counts, g.landOfficeId, g._count);
    return counts;
  }

  // Only transfers and revocations: an issuance is always filed by the central office.
  private async fallbackByOffice(): Promise<Map<OfficeId, number>> {
    const counts = new Map<OfficeId, number>();
    const perKind = await Promise.all(
      (['transfer', 'revocation'] as const).map((kind) =>
        this.group(kind, {
          by: ['landOfficeId', 'officeId'],
          where: { status: { in: OPEN_STATUSES[kind] } },
          _count: true,
        }),
      ),
    );
    for (const g of perKind.flat()) {
      if (isFallback(g.officeId!, g.landOfficeId)) add(counts, g.landOfficeId, g._count);
    }
    return counts;
  }

  private async archiveWindows(now: Date) {
    const select = { changeSetId: true, officeId: true };
    const [nearExpiry, expired] = await Promise.all([
      this.prisma.changeSetArchive.findMany({
        where: {
          firstDownloadedAt: null,
          zip: { not: null },
          expiresAt: { gt: now, lte: new Date(now.getTime() + ARCHIVE_WARNING_DAYS * DAY_MS) },
        },
        select,
      }),
      this.prisma.changeSetArchive.findMany({
        where: { firstDownloadedAt: null, expiresAt: { lte: now } },
        select,
      }),
    ]);
    return { nearExpiry, expired };
  }

  // The three delegates share groupBy; Prisma's generated types cannot express that.
  private group(kind: QueueKind, args: object): Promise<Group[]> {
    const delegates = {
      issuance: this.prisma.issuanceRequest,
      transfer: this.prisma.transferRequest,
      revocation: this.prisma.revocation,
    };
    return (delegates[kind] as unknown as { groupBy(a: object): Promise<Group[]> }).groupBy(args);
  }
}
