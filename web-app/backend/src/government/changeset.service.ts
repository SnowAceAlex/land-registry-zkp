import {
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ChangeSet,
  DraftStatus,
  IssuanceRequest,
  Property,
  Revocation,
  TransferRequest,
} from '@prisma/client';
import { type TreeOverlay, hashRecord } from '@land-registry/blockchain/shared';

import { ChainService } from '../chain/chain.service';
import { Actor } from '../common/actor';
import { DraftLockService } from '../common/draft-lock.service';
import { ARCHIVE_TTL_DAYS, ArchiveEntry, ArchiveService } from '../issuance/archive.service';
import { IssuanceRequestDto } from '../issuance/dto/issuance-request.dto';
import { toIssuanceRequestDto } from '../issuance/issuance-request.serializer';
import { IssuanceService } from '../issuance/issuance.service';
import { PropertyEventService } from '../history/property-event.service';
import { LineageService } from '../lineage/lineage.service';
import { PrismaService } from '../prisma/prisma.service';
import { NodeStoreService } from '../tree/node-store.service';
import { toLURRecord } from '../records/record.mapper';
import { TransferRequestDto } from '../transfers/dto/transfer.response.dto';
import { officeCodes } from '../common/office-codes';
import { toTransferRequestDto } from '../transfers/transfer-request.serializer';
import { RootService } from './root.service';

/**
 * Most revocations one round carries (D56/D73) — past the block gas limit the
 * publish reverts wholesale. 150 is the largest measured rung under half of a
 * 30M block on Hardhat (~93k gas each); see RootRegistry.revocation.test.ts.
 */
export const DEFAULT_REVOCATION_CAP = 150;

/** REVOCATION_CAP as a positive integer, else the default. Sepolia needs ≤ 60 (~448k gas each). */
export function revocationCap(): number {
  const raw = process.env.REVOCATION_CAP?.trim() ?? '';
  const value = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_REVOCATION_CAP;
}

/** Arguments for `RootRegistry.publishRootWithRevocations`, index-aligned. */
export interface RevocationCalldata {
  propertyIds: string[];
  reasonCodes: number[];
  detailHashes: string[];
}

/** Summary row for `list()` — deliberately excludes `archiveZip` (D77). */
export interface ChangeSetSummary {
  id: number;
  status: DraftStatus;
  newRoot: string;
  rootVersion: number | null;
  txHash: string | null;
  createdAt: Date;
  publishedAt: Date | null;
  archiveExpiresAt: Date | null;
  transferCount: number;
  revocationCount: number;
}

/** What a portal needs to sign (or resume signing) a change-set draft (D53). */
export interface ChangeSetDraftDetail {
  kind: 'changeset';
  id: number;
  newRoot: string;
  createdAt: Date;
  issuanceRequestIds: number[];
  transferIds: number[];
  revocationIds: number[];
  revocationCalldata: RevocationCalldata;
  /** Pending revocations left for a later round by the cap (D56). */
  deferredRevocations: number;
}

type IssuanceItem = Pick<IssuanceRequest, 'id' | 'propertyId' | 'ownerCommitment'>;
type TransferItem = Pick<TransferRequest, 'id' | 'propertyId' | 'newOwnerCommitment'>;

/**
 * The one publishing round (D84): READY issuances, APPROVED transfers and PENDING
 * revocations projected into a single root. Same draft → sign → confirm shape as D43:
 * a draft only `connect`s its items, and confirm() re-checks against the chain before
 * writing anything. Transfer proofs are authorisation evidence only — the tree is
 * always rebuilt from the database with the whole round applied.
 */
@Injectable()
export class ChangeSetService {
  private readonly logger = new Logger(ChangeSetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodeStoreService,
    private readonly chain: ChainService,
    private readonly roots: RootService,
    private readonly lock: DraftLockService,
    private readonly events: PropertyEventService,
    private readonly issuance: IssuanceService,
    private readonly archive: ArchiveService,
    private readonly lineage: LineageService,
  ) {}

  /**
   * Everything eligible for the next round, plus the cap (D73). Requests go through
   * their serializers: the rows hold owner/buyer secrets until a round archives them.
   */
  async pending(actor: Actor): Promise<{
    issuances: IssuanceRequestDto[];
    transfers: TransferRequestDto[];
    revocations: Revocation[];
    revocationCap: number;
  }> {
    // D86: a branch sees only the plots of its own area.
    const area = actor.scope === 'BRANCH' ? { landOfficeId: actor.officeId } : {};
    const [{ issuances, transfers, revocations }, offices] = await Promise.all([
      this.queue(area),
      officeCodes(this.prisma),
    ]);
    return {
      issuances: issuances.map((row) => toIssuanceRequestDto(row, offices)),
      transfers: transfers.map((row) => toTransferRequestDto(row, offices)),
      revocations,
      revocationCap: revocationCap(),
    };
  }

  /** The raw queue — rows with their secrets, for this service only. */
  private async queue(area: { landOfficeId?: number } = {}): Promise<{
    issuances: IssuanceRequest[];
    transfers: TransferRequest[];
    revocations: Revocation[];
  }> {
    // Not yet in a draft, and not held back by the central office (D87).
    const open = { changeSetId: null, heldAt: null, ...area };
    const orderBy = { createdAt: 'asc' as const };
    const [issuances, transfers, revocations] = await Promise.all([
      this.prisma.issuanceRequest.findMany({ where: { status: 'READY', ...open }, orderBy }),
      this.prisma.transferRequest.findMany({ where: { status: 'APPROVED', ...open }, orderBy }),
      this.prisma.revocation.findMany({ where: { status: 'PENDING', ...open }, orderBy }),
    ]);
    return { issuances, transfers, revocations };
  }

  /**
   * Phase 1 — take the whole queue, project the ONE root that applying all of it
   * produces, and store it as a draft. Nothing but the new ChangeSet row is written:
   * the items are only `connect`ed, so an abandoned draft leaves nothing half-applied.
   */
  async createDraft(actor: Actor): Promise<ChangeSetDraftDetail> {
    await this.lock.assertNoOpenDraft();

    const { issuances, transfers, revocations: pendingRevocations } = await this.queue();
    if (issuances.length === 0 && transfers.length === 0 && pendingRevocations.length === 0) {
      throw new ConflictException(
        'Nothing to publish — no issuance requests, approved transfers or revocations',
      );
    }

    this.assertNoConflicts(issuances, transfers, pendingRevocations);

    // D77 — the buyer's secret travels with the request into this round's
    // archive. A request submitted before D77 has none, and publishing its
    // commitment would leave a plot whose archive holds no key.
    const secretless = transfers.filter((transfer) => transfer.newOwnerSecret === null);
    if (secretless.length > 0) {
      throw new ConflictException(
        `Transfer request(s) ${secretless.map((t) => `#${t.id}`).join(', ')} carry no buyer ` +
          `secret — they were submitted before D77. Reject them and redo the transfers at the counter.`,
      );
    }
    // D87: same rule for the owner's secret, kept on the request until the archive lands.
    const keyless = issuances.filter((request) => request.ownerSecret === null);
    if (keyless.length > 0) {
      throw new ConflictException(
        `Issuance request(s) ${keyless.map((r) => `#${r.id}`).join(', ')} carry no owner ` +
          `secret. Withdraw them and queue the plots again.`,
      );
    }

    // D90, re-checked: a re-issued certificate publishes only once all it replaces are REVOKED.
    if (issuances.length > 0) {
      const blocked = await this.lineage.unrevokedPredecessors(issuances.map((r) => r.propertyId));
      if (blocked.size > 0) {
        throw new ConflictException({
          reason: 'PredecessorNotRevoked',
          message: `Superseded certificates are not revoked yet: ${[...blocked.keys()].join(', ')}`,
          details: Object.fromEntries([...blocked].map(([id, preds]) => [id, preds.join(',')])),
        });
      }
    }

    // D56 — oldest first (queue() orders by createdAt), the rest wait.
    const revocations = pendingRevocations.slice(0, revocationCap());

    // Only the plots in this round are read (D72): the projection walks up from
    // their leaves instead of rebuilding the registry.
    const { updates } = await this.leafUpdatesFor(issuances, transfers, revocations);
    const overlay = await this.nodes.projectRoot(updates);

    const draft = await this.prisma.changeSet.create({
      data: {
        status: 'DRAFT',
        newRoot: overlay.root.toString(),
        createdByOfficeId: actor.officeId,
        issuances: { connect: issuances.map((r) => ({ id: r.id })) },
        transfers: { connect: transfers.map((t) => ({ id: t.id })) },
        revocations: { connect: revocations.map((r) => ({ id: r.id })) },
      },
    });

    this.logger.log(
      `change set draft #${draft.id}: ${issuances.length} issuance(s), ` +
        `${transfers.length} transfer(s), ${revocations.length} revocation(s), ` +
        `projected root ${overlay.root}`,
    );

    return this.toDraftDetail(
      draft,
      issuances,
      transfers,
      revocations,
      pendingRevocations.length - revocations.length,
    );
  }

  /**
   * Defence in depth: the request services already refuse a second open procedure
   * on a plot (D80), but none of them sees the whole queue. A plot named twice would
   * ask this round to apply two leaves at one slot — refuse instead of picking one.
   * Checked against every queued revocation, deferred ones included.
   */
  private assertNoConflicts(
    issuances: { propertyId: string }[],
    transfers: { propertyId: string }[],
    revocations: { propertyId: string }[],
  ): void {
    const issued = new Set<string>();
    const transferred = new Set<string>();
    const revoked = new Set<string>();

    for (const { propertyId } of issuances) {
      if (issued.has(propertyId)) {
        throw new ConflictException(
          `Property ${propertyId} has more than one issuance request queued — ` +
            `withdraw all but one before publishing.`,
        );
      }
      issued.add(propertyId);
    }
    for (const { propertyId } of transfers) {
      if (transferred.has(propertyId)) {
        throw new ConflictException(
          `Property ${propertyId} has more than one approved transfer waiting — ` +
            `reject all but one before publishing.`,
        );
      }
      if (issued.has(propertyId)) {
        throw new ConflictException(
          `Property ${propertyId} has both an issuance request and a transfer queued — ` +
            `resolve the conflict before publishing.`,
        );
      }
      transferred.add(propertyId);
    }
    for (const { propertyId } of revocations) {
      if (revoked.has(propertyId)) {
        throw new ConflictException(
          `Property ${propertyId} has more than one pending revocation — ` +
            `reject all but one before publishing.`,
        );
      }
      if (issued.has(propertyId)) {
        throw new ConflictException(
          `Property ${propertyId} has both an issuance request and a revocation queued — ` +
            `resolve the conflict before publishing.`,
        );
      }
      if (transferred.has(propertyId)) {
        throw new ConflictException(
          `Property ${propertyId} has both a transfer and a revocation pending — ` +
            `resolve the conflict before publishing.`,
        );
      }
      revoked.add(propertyId);
    }
  }

  /**
   * An open draft as the portal sees it (D53), rebuilt from the stored relations —
   * pending() excludes everything connected to a draft, so this is the only way a
   * session that lost the create response can sign again.
   */
  async draftDetail(id: number): Promise<ChangeSetDraftDetail> {
    const draft = await this.prisma.changeSet.findUnique({
      where: { id },
      include: {
        issuances: { orderBy: { createdAt: 'asc' } },
        transfers: { orderBy: { createdAt: 'asc' } },
        revocations: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    const deferred = await this.prisma.revocation.count({
      where: { status: 'PENDING', changeSetId: null, heldAt: null },
    });
    return this.toDraftDetail(draft, draft.issuances, draft.transfers, draft.revocations, deferred);
  }

  /**
   * One mapping for createDraft() and draftDetail(), so a resumed session signs the
   * calldata first shown. Order matters only for the contract's `revocations` writes.
   */
  private toDraftDetail(
    draft: Pick<ChangeSet, 'id' | 'newRoot' | 'createdAt'>,
    issuances: Pick<IssuanceRequest, 'id'>[],
    transfers: Pick<TransferRequest, 'id'>[],
    revocations: Pick<Revocation, 'id' | 'propertyId' | 'reasonCode' | 'detailHash'>[],
    deferredRevocations: number,
  ): ChangeSetDraftDetail {
    return {
      kind: 'changeset',
      id: draft.id,
      newRoot: draft.newRoot,
      createdAt: draft.createdAt,
      issuanceRequestIds: issuances.map((r) => r.id),
      transferIds: transfers.map((t) => t.id),
      revocationIds: revocations.map((r) => r.id),
      revocationCalldata: {
        propertyIds: revocations.map((r) => r.propertyId),
        reasonCodes: revocations.map((r) => r.reasonCode),
        detailHashes: revocations.map((r) => r.detailHash),
      },
      deferredRevocations,
    };
  }

  /**
   * Phase 2 — the officer has signed the root (and the revocation calldata, if any).
   * Verify against the CHAIN, not against anything the caller says, then apply
   * everything in one transaction.
   */
  async confirm(
    id: number,
    txHash: string | undefined,
    actor: Actor,
  ): Promise<{
    id: number;
    rootVersion: number;
    txHash: string | null;
    issuanceRequestIds: number[];
    transferIds: number[];
    revocationIds: number[];
  }> {
    const draft = await this.prisma.changeSet.findUnique({
      where: { id },
      include: { issuances: true, transfers: true, revocations: true },
    });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    // Same rules as createDraft(), re-checked before the chain read: a commitment
    // published without its secret is a plot nobody can ever prove.
    const secretless = draft.transfers.filter((transfer) => transfer.newOwnerSecret === null);
    if (secretless.length > 0) {
      throw new UnprocessableEntityException(
        `Transfer request(s) ${secretless.map((t) => `#${t.id}`).join(', ')} in change set #${id} ` +
          `carry no buyer secret. Discard this change set, reject them, and redo them at the counter.`,
      );
    }
    const keyless = draft.issuances.filter((request) => request.ownerSecret === null);
    if (keyless.length > 0) {
      throw new UnprocessableEntityException(
        `Issuance request(s) ${keyless.map((r) => `#${r.id}`).join(', ')} in change set #${id} ` +
          `carry no owner secret. Discard this change set, withdraw them, and queue the plots again.`,
      );
    }

    // `txHash` is a display label (history, explorer links), never evidence of the
    // publish — that authority is the chain read right below.
    if (txHash !== undefined) {
      draft.txHash = txHash;
    }

    // D74 — the root read is cached; a confirm must always ask the chain itself,
    // or a just-mined publish can be reported as unmined.
    this.chain.invalidateRootCache();
    const latestRoot = await this.chain.getLatestRoot();
    if (latestRoot.toString() !== draft.newRoot) {
      throw new UnprocessableEntityException(
        `On-chain latestRoot is ${latestRoot}, but this change set projects ${draft.newRoot}. ` +
          `The publish transaction has not been mined, or a different root was published.`,
      );
    }
    const rootVersion = await this.chain.getRootVersion();

    // `before` is the tree as it stood before THIS round, for the history rows.
    const {
      updates,
      newLeaves,
      before: beforeById,
    } = await this.leafUpdatesFor(draft.issuances, draft.transfers, draft.revocations);
    const overlay = await this.nodes.projectRoot(updates);

    // If the re-projected root no longer matches the signed one, something moved
    // underneath the draft and applying it would corrupt the registry.
    if (overlay.root.toString() !== draft.newRoot) {
      throw new UnprocessableEntityException(
        `Reprojected root ${overlay.root} no longer matches the signed root ${draft.newRoot}. ` +
          `Discard this change set and start again.`,
      );
    }

    const decidedAt = new Date();
    // Every secret this round clears lives on an issuance or a transfer, so a round
    // with neither has no archive and nothing to clear.
    const archiveZip =
      draft.issuances.length > 0 || draft.transfers.length > 0
        ? await this.buildArchive({
            changeSetId: draft.id,
            txHash: draft.txHash,
            rootVersion,
            overlay,
            issuances: draft.issuances,
            transfers: draft.transfers,
            before: beforeById,
            newLeaves,
            publishedAt: decidedAt,
          })
        : null;
    const archiveExpiresAt = new Date(decidedAt.getTime() + ARCHIVE_TTL_DAYS * 24 * 60 * 60 * 1000);

    try {
      await this.prisma.$transaction([
        ...draft.issuances.map((request) =>
          this.prisma.property.update({
            where: { propertyId: request.propertyId },
            data: {
              status: 'ISSUED',
              ownerCommitment: request.ownerCommitment,
              leaf: newLeaves.get(request.propertyId)!,
              rootVersion,
              issuedAt: decidedAt,
            },
          }),
        ),
        ...draft.issuances.map((request) =>
          this.prisma.issuanceRequest.update({
            where: { id: request.id },
            // D87 — the archive written by the changeSet update below, in this
            // same transaction, is now the secret's copy of record.
            data: { status: 'PUBLISHED', publishedAt: decidedAt, ownerSecret: null },
          }),
        ),

        ...draft.transfers.map((transfer) =>
          this.prisma.property.update({
            where: { propertyId: transfer.propertyId },
            data: {
              ownerCommitment: transfer.newOwnerCommitment,
              leaf: newLeaves.get(transfer.propertyId)!,
              rootVersion,
            },
          }),
        ),
        ...draft.transfers.map((transfer) =>
          this.prisma.transferRequest.update({
            where: { id: transfer.id },
            // D77 — same rule for the buyer's secret.
            data: { status: 'PUBLISHED', txHash: draft.txHash, decidedAt, newOwnerSecret: null },
          }),
        ),

        // A revoked plot leaves the tree (status !== ISSUED, D45); its leaf is cleared
        // here and its node deleted by applyStatements below — the two must agree.
        ...draft.revocations.map((revocation) =>
          this.prisma.property.update({
            where: { propertyId: revocation.propertyId },
            data: { status: 'REVOKED', leaf: null, rootVersion: null },
          }),
        ),
        ...draft.revocations.map((revocation) =>
          this.prisma.revocation.update({
            where: { id: revocation.id },
            data: { status: 'PUBLISHED', publishedAt: decidedAt },
          }),
        ),

        this.roots.recordRootStatement({
          root: overlay.root,
          version: rootVersion,
          txHash: draft.txHash ?? '',
        }),
        // D72: writes only the nodes this round moved — O(k·TREE_DEPTH), not the registry.
        ...this.nodes.applyStatements(overlay),

        ...this.events.issuedStatements(
          draft.issuances.map((request) => ({
            propertyId: request.propertyId,
            ownerCommitment: request.ownerCommitment,
            leaf: newLeaves.get(request.propertyId)!,
          })),
          { rootVersion, txHash: draft.txHash },
        ),
        ...this.events.transferredStatements(
          draft.transfers.map((transfer) => ({
            propertyId: transfer.propertyId,
            previousOwnerCommitment: beforeById.get(transfer.propertyId)?.ownerCommitment ?? null,
            newOwnerCommitment: transfer.newOwnerCommitment,
            previousLeaf: beforeById.get(transfer.propertyId)?.leaf ?? null,
            newLeaf: newLeaves.get(transfer.propertyId)!,
          })),
          { rootVersion, txHash: draft.txHash },
        ),
        ...this.events.revokedStatements(
          draft.revocations.map((revocation) => ({
            propertyId: revocation.propertyId,
            previousLeaf: beforeById.get(revocation.propertyId)?.leaf ?? null,
            reasonCode: revocation.reasonCode,
            // detailHash, never detailText: the free-text reason stays off the
            // public history the same way it stays off chain.
            detailHash: revocation.detailHash,
          })),
          { rootVersion, txHash: draft.txHash },
        ),

        this.prisma.changeSet.update({
          where: { id: draft.id },
          data: {
            status: 'PUBLISHED',
            rootVersion,
            publishedAt: decidedAt,
            txHash: draft.txHash,
            confirmedByOfficeId: actor.officeId,
            // The secrets above are cleared only because this archive lands in the
            // same transaction. Buffer IS a Uint8Array; the cast narrows its buffer type.
            ...(archiveZip
              ? { archiveZip: archiveZip as Uint8Array<ArrayBuffer>, archiveExpiresAt }
              : {}),
          },
        }),
      ]);
    } catch (error) {
      // The wallet already published this root (checked above), so a failure here
      // leaves the database behind the chain — surface it for manual reconciliation.
      this.roots.warnChainAheadOfDatabase(draft.txHash ?? '', error);
      throw error;
    }

    this.logger.log(
      `change set #${draft.id} confirmed at root version ${rootVersion}: ` +
        `${draft.issuances.length} issuance(s), ${draft.transfers.length} transfer(s), ` +
        `${draft.revocations.length} revocation(s)`,
    );

    return {
      id: draft.id,
      rootVersion,
      txHash: draft.txHash,
      issuanceRequestIds: draft.issuances.map((r) => r.id),
      transferIds: draft.transfers.map((t) => t.id),
      revocationIds: draft.revocations.map((r) => r.id),
    };
  }

  /**
   * The new leaf of every issued and transferred plot, `null` for every revoked one,
   * and the "before" rows the history and the bundles are built from. Reads ONLY the
   * plots in the round (D72).
   */
  private async leafUpdatesFor(
    issuances: IssuanceItem[],
    transfers: TransferItem[],
    revocations: { propertyId: string }[],
  ): Promise<{
    updates: Map<number, bigint | null>;
    newLeaves: Map<string, string>;
    before: Map<string, Property>;
  }> {
    const propertyIds = [...issuances, ...transfers, ...revocations].map((item) => item.propertyId);
    const rows = await this.prisma.property.findMany({
      where: { propertyId: { in: propertyIds } },
    });
    const before = new Map(rows.map((property) => [property.propertyId, property]));

    const updates = new Map<number, bigint | null>();
    const newLeaves = new Map<string, string>();
    const plotOf = (propertyId: string): Property => {
      const property = before.get(propertyId);
      if (!property) {
        throw new UnprocessableEntityException(
          `Property ${propertyId} referenced by this round no longer exists. ` +
            `Discard the draft and start again.`,
        );
      }
      return property;
    };

    for (const request of issuances) {
      const property = plotOf(request.propertyId);
      // D84: issuance fills an empty slot, so only a plot that never had a leaf qualifies.
      if (property.status !== 'IMPORTED') {
        throw new UnprocessableEntityException(
          `Property ${request.propertyId} is ${property.status}, not IMPORTED, so issuance ` +
            `request #${request.id} for it cannot be published. Withdraw that request first.`,
        );
      }
      const leaf = await hashRecord(
        toLURRecord({ ...property, ownerCommitment: request.ownerCommitment }),
      );
      updates.set(Number(request.propertyId), leaf);
      newLeaves.set(request.propertyId, leaf.toString());
    }

    for (const transfer of transfers) {
      const property = plotOf(transfer.propertyId);
      // ⚠️ Load-bearing: reading by propertyId (D72) no longer filters out a plot
      // revoked after its transfer was approved, and re-hashing it would resurrect a
      // certificate the State has reclaimed.
      if (property.status !== 'ISSUED') {
        throw new UnprocessableEntityException(
          `Property ${transfer.propertyId} is ${property.status}, not ISSUED, so the approved ` +
            `transfer for it cannot be published. Reject that transfer request first.`,
        );
      }
      // Only `ownerCommitment` changes — that is what makes it a transfer, not an edit.
      const leaf = await hashRecord(
        toLURRecord({ ...property, ownerCommitment: transfer.newOwnerCommitment }),
      );
      updates.set(Number(transfer.propertyId), leaf);
      newLeaves.set(transfer.propertyId, leaf.toString());
    }

    // Revocation = remove the leaf (D45): with no leaf there is no Merkle path, so
    // no circuit can prove anything about the plot afterwards.
    for (const revocation of revocations) {
      updates.set(Number(revocation.propertyId), null);
    }

    return { updates, newLeaves, before };
  }

  /**
   * The round's bundles: one folder per issued or transferred plot, built by the same
   * IssuanceService.buildBundleFiles. Every path comes from the projected overlay —
   * the node table still holds the tree from BEFORE this round, so a receipt built
   * from it would not verify against the root just signed.
   */
  private async buildArchive(input: {
    changeSetId: number;
    txHash: string | null;
    rootVersion: number;
    overlay: TreeOverlay;
    issuances: { propertyId: string; ownerCommitment: string; ownerSecret: string | null }[];
    transfers: { propertyId: string; newOwnerCommitment: string; newOwnerSecret: string | null }[];
    before: Map<string, Property>;
    newLeaves: Map<string, string>;
    publishedAt: Date;
  }): Promise<Buffer> {
    const { issuer, issuedOn } = this.issuance.batchContext();
    const context = {
      rootVersion: input.rootVersion,
      merkleRoot: input.overlay.root,
      transactionHash: input.txHash ?? '',
      contractAddress: this.chain.rootRegistryAddress,
      explorerTxUrlPrefix: this.chain.explorerTxUrlPrefix,
    };

    const owners = [
      ...input.issuances.map((request) => ({
        kind: 'issued' as const,
        propertyId: request.propertyId,
        ownerCommitment: request.ownerCommitment,
        ownerSecret: request.ownerSecret,
      })),
      ...input.transfers.map((transfer) => ({
        kind: 'transferred' as const,
        propertyId: transfer.propertyId,
        ownerCommitment: transfer.newOwnerCommitment,
        ownerSecret: transfer.newOwnerSecret,
      })),
    ];

    const entries: ArchiveEntry[] = [];
    for (const owner of owners) {
      const property = {
        ...input.before.get(owner.propertyId)!,
        ownerCommitment: owner.ownerCommitment,
      };
      const leaf = BigInt(input.newLeaves.get(owner.propertyId)!);
      const merkleProof = await this.nodes.proofInOverlay(property, leaf, input.overlay);
      const built = await this.issuance.buildBundleFiles(
        { property, ownerSecret: BigInt(owner.ownerSecret!), merkleProof },
        context,
        issuer,
        issuedOn,
      );
      entries.push({
        propertyId: property.propertyId,
        certificateSerial: property.certificateSerial,
        leaf: leaf.toString(),
        kind: owner.kind,
        files: built.files,
      });
    }

    return this.archive.build({
      kind: 'changeset',
      batchId: input.changeSetId,
      rootVersion: input.rootVersion,
      txHash: input.txHash,
      publishedAt: input.publishedAt,
      entries,
    });
  }

  /** Abandon a draft. Its items were only `connect`ed, so releasing them returns them to the queue. */
  async discard(id: number): Promise<void> {
    const draft = await this.prisma.changeSet.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      // Relabelling a PUBLISHED round and detaching its items would destroy the
      // record of which round published what.
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    await this.prisma.changeSet.update({
      where: { id },
      data: {
        status: 'DISCARDED',
        issuances: { set: [] },
        transfers: { set: [] },
        revocations: { set: [] },
      },
    });
  }

  /** Every change set, newest first. Summary columns only — never `archiveZip` (D77). */
  async list(): Promise<ChangeSetSummary[]> {
    const rows = await this.prisma.changeSet.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        newRoot: true,
        rootVersion: true,
        txHash: true,
        createdAt: true,
        publishedAt: true,
        archiveExpiresAt: true,
        _count: { select: { transfers: true, revocations: true } },
      },
    });
    return rows.map(({ _count, ...row }) => ({
      ...row,
      transferCount: _count.transfers,
      revocationCount: _count.revocations,
    }));
  }

  /** The round's archive, while it still exists. An expired archive is gone for good. */
  async archiveFor(id: number): Promise<{ zip: Buffer; filename: string }> {
    const changeSet = await this.prisma.changeSet.findUnique({
      where: { id },
      select: { archiveZip: true, archiveExpiresAt: true },
    });
    if (!changeSet || !changeSet.archiveZip) {
      throw new NotFoundException(`Change set #${id} has no archive`);
    }
    if (changeSet.archiveExpiresAt && changeSet.archiveExpiresAt.getTime() < Date.now()) {
      await this.prisma.changeSet.update({ where: { id }, data: { archiveZip: null } });
      throw new GoneException(
        `The archive for change set #${id} expired on ${changeSet.archiveExpiresAt.toISOString()}. ` +
          `The owners' secrets are unrecoverable — the affected plots must be re-issued.`,
      );
    }
    return { zip: Buffer.from(changeSet.archiveZip), filename: `changeset-${id}.zip` };
  }
}
