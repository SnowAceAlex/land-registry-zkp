import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ChangeSet, Prisma, Property, Revocation, TransferRequest } from '@prisma/client';

import { ChainService } from '../chain/chain.service';
import { DraftLockService } from '../common/draft-lock.service';
import { PropertyEventService } from '../history/property-event.service';
import { PrismaService } from '../prisma/prisma.service';
import { TreeService } from '../tree/tree.service';
import { RootService } from './root.service';

/**
 * Most revocations one change set may carry (D56).
 *
 * `publishRootWithRevocations` has no length cap of its own, and a batch past
 * the block gas limit reverts wholesale — nothing publishes. Measured in
 * `blockchain/test/contracts/RootRegistry.revocation.test.ts`: 4,743,185 gas
 * for 50 (~95k each), a sixth of a 30M block. The cap lives here rather than in
 * the portal because createDraft() takes the WHOLE queue: there is no selection
 * step a UI could limit.
 */
export const MAX_REVOCATIONS_PER_CHANGESET = 50;

/** Arguments for `RootRegistry.publishRootWithRevocations`, index-aligned. */
export interface RevocationCalldata {
  propertyIds: string[];
  reasonCodes: number[];
  detailHashes: string[];
}

/** What a portal needs to sign (or resume signing) a change-set draft (D53). */
export interface ChangeSetDraftDetail {
  kind: 'changeset';
  id: number;
  newRoot: string;
  createdAt: Date;
  transferIds: number[];
  revocationIds: number[];
  revocationCalldata: RevocationCalldata;
  /** Pending revocations left for a later round by the cap (D56). */
  deferredRevocations: number;
}

/**
 * ChangeSetService — one publishing round of approved transfers and revocations (D44/D46).
 *
 * Mirrors IssuanceBatchService's two-phase draft/confirm/discard shape (D43): a
 * DRAFT is a durable, inert record — createDraft() only `connect`s the
 * TransferRequest and Revocation rows it covers, never writes to Property or
 * to either row's `status` — and confirm() re-verifies against the chain
 * before applying anything for real.
 *
 * What differs from issuance is where the new root comes from. A transfer
 * proof's public signals carry a `newRoot`, but that value was computed
 * assuming only that ONE transfer happened; batching N transfers (and
 * revocations) together produces one root, not N superseding ones. So the
 * proof is authorisation evidence — proof that whoever submitted it held the
 * old owner's secret — never a source of truth for the tree. The tree here is
 * always rebuilt from the database, with every change in the round applied in
 * memory first, exactly the way IssuanceBatchService rebuilds from the
 * database rather than trusting anything computed at draft time.
 *
 * A revocation's enforcement falls out of that same rebuild for free: a
 * revoked plot is excluded because its Property.status becomes REVOKED
 * (membership is `status === ISSUED`, D45), so no Merkle path exists for it in
 * the new tree and the ownership/mortgage/transfer circuits simply cannot
 * produce a proof for it afterwards. The on-chain `revocations` mapping this
 * draft's calldata feeds is for public auditability, not enforcement —
 * enforcement is already free.
 */
@Injectable()
export class ChangeSetService {
  private readonly logger = new Logger(ChangeSetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tree: TreeService,
    private readonly chain: ChainService,
    private readonly roots: RootService,
    private readonly lock: DraftLockService,
    private readonly events: PropertyEventService,
  ) {}

  /** Everything currently eligible to go into the next change set. */
  async pending(): Promise<{ transfers: TransferRequest[]; revocations: Revocation[] }> {
    const [transfers, revocations] = await Promise.all([
      this.prisma.transferRequest.findMany({
        where: { status: 'APPROVED', changeSetId: null },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.revocation.findMany({
        // changeSetId: null mirrors the transfer query above. Without it, a
        // revocation already `connect`ed to an open DRAFT would still be
        // reported as "pending" here — misleading even though
        // DraftLockService is already refusing to start a second draft that
        // could batch it again.
        where: { status: 'PENDING', changeSetId: null },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { transfers, revocations };
  }

  /**
   * Phase 1 — gather every approved transfer and pending revocation, project
   * the ONE root that applying all of them at once produces, and store it as a
   * draft. No Property, TransferRequest or Revocation row is written here —
   * only `connect`ed to the new draft — so an abandoned draft can never leave
   * any of them in a half-applied state.
   */
  async createDraft(): Promise<ChangeSetDraftDetail> {
    await this.lock.assertNoOpenDraft();

    const { transfers, revocations: pendingRevocations } = await this.pending();
    if (transfers.length === 0 && pendingRevocations.length === 0) {
      throw new ConflictException('Nothing to publish — no approved transfers, no revocations');
    }

    // Defence in depth. TransfersService.submit() already refuses a second
    // transfer while one is PENDING or APPROVED for the same property, and
    // RevocationService.request() refuses a second pending revocation for the
    // same property — but neither knows about the other. If a plot somehow
    // had both, this batch would be asked to simultaneously keep it (under a
    // new owner) and drop it from the tree. Refuse instead of silently
    // picking one.
    //
    // Checked against the WHOLE queue, deferred revocations included: a plot
    // transferred in this round and revoked in the next is the same conflict,
    // just spread over two publishes.
    const seen = new Set<string>();
    for (const item of [...transfers, ...pendingRevocations]) {
      if (seen.has(item.propertyId)) {
        throw new ConflictException(
          `Property ${item.propertyId} has both a transfer and a revocation pending — ` +
            `resolve the conflict before publishing.`,
        );
      }
      seen.add(item.propertyId);
    }

    // D56 — oldest first (pending() orders by createdAt), the rest wait.
    const revocations = pendingRevocations.slice(0, MAX_REVOCATIONS_PER_CHANGESET);

    // Apply every change in memory, then take ONE root from the result. N
    // transfers and revocations batched together produce one root, not N.
    const applied = await this.applyChangesInMemory(transfers, revocations);
    const { tree } = await this.tree.buildFrom(applied);

    // No relation `connect` touches Property here — same reasoning as
    // IssuanceBatchService.createDraft(): only confirm() may write it, and
    // only after a signature.
    const draft = await this.prisma.changeSet.create({
      data: {
        status: 'DRAFT',
        newRoot: tree.root.toString(),
        transfers: { connect: transfers.map((t) => ({ id: t.id })) },
        revocations: { connect: revocations.map((r) => ({ id: r.id })) },
      },
    });

    this.logger.log(
      `change set draft #${draft.id}: ${transfers.length} transfer(s), ` +
        `${revocations.length} revocation(s), projected root ${tree.root}`,
    );

    return this.toDraftDetail(
      draft,
      transfers,
      revocations,
      pendingRevocations.length - revocations.length,
    );
  }

  /**
   * An open draft as the portal sees it (D53) — the same shape createDraft()
   * returned, rebuilt from the stored relations. Without it a session that
   * lost that response could never sign again: pending() excludes everything
   * already connected to a draft, so the calldata would exist nowhere.
   */
  async draftDetail(id: number): Promise<ChangeSetDraftDetail> {
    const draft = await this.prisma.changeSet.findUnique({
      where: { id },
      include: {
        transfers: { orderBy: { createdAt: 'asc' } },
        revocations: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    const deferred = await this.prisma.revocation.count({
      where: { status: 'PENDING', changeSetId: null },
    });
    return this.toDraftDetail(draft, draft.transfers, draft.revocations, deferred);
  }

  /**
   * One mapping for createDraft() and draftDetail(), so the calldata a resumed
   * session signs is built by the same code as the calldata first shown. Order
   * does not affect the root (it is rebuilt from the database) — only the
   * order the contract writes its `revocations` mapping in.
   */
  private toDraftDetail(
    draft: Pick<ChangeSet, 'id' | 'newRoot' | 'createdAt'>,
    transfers: Pick<TransferRequest, 'id'>[],
    revocations: Pick<Revocation, 'id' | 'propertyId' | 'reasonCode' | 'detailHash'>[],
    deferredRevocations: number,
  ): ChangeSetDraftDetail {
    return {
      kind: 'changeset',
      id: draft.id,
      newRoot: draft.newRoot,
      createdAt: draft.createdAt,
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
   * Phase 2 — the officer has signed both the root and (when the round
   * includes any) the revocation calldata. Verify against the CHAIN, not
   * against anything the caller says, then apply everything in one
   * transaction.
   */
  async confirm(
    id: number,
    txHash?: string,
  ): Promise<{
    id: number;
    rootVersion: number;
    txHash: string | null;
    transferIds: number[];
    revocationIds: number[];
  }> {
    const draft = await this.prisma.changeSet.findUnique({
      where: { id },
      include: { transfers: true, revocations: true },
    });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    // `txHash` is a label for humans — surfaced later in history views so a
    // reader can jump to a block explorer — never evidence that the publish
    // happened. That authority stays exactly the chain read immediately
    // below. Stashing it on the in-memory draft here just makes every write
    // further down (the MerkleRoot row, the PropertyEvent rows, this row)
    // carry the same label; nothing branches on whether it is present.
    if (txHash !== undefined) {
      draft.txHash = txHash;
    }

    const latestRoot = await this.chain.getLatestRoot();
    if (latestRoot.toString() !== draft.newRoot) {
      throw new UnprocessableEntityException(
        `On-chain latestRoot is ${latestRoot}, but this change set projects ${draft.newRoot}. ` +
          `The publish transaction has not been mined, or a different root was published.`,
      );
    }
    const rootVersion = await this.chain.getRootVersion();

    // Snapshot "before" state for the history rows — previousOwnerCommitment /
    // previousLeaf must reflect the tree as it stood before THIS round, not
    // after (PropertyEventService writes only forward-looking rows).
    const before = await this.prisma.property.findMany({
      where: {
        propertyId: {
          in: [
            ...draft.transfers.map((t) => t.propertyId),
            ...draft.revocations.map((r) => r.propertyId),
          ],
        },
      },
    });
    const beforeById = new Map(before.map((property) => [property.propertyId, property]));

    const applied = await this.applyChangesInMemory(draft.transfers, draft.revocations);
    const { tree, properties } = await this.tree.buildFrom(applied);

    // Paranoia that has already paid for itself once in IssuanceBatchService:
    // if the rebuilt tree no longer matches the signed root, something moved
    // underneath the draft and applying it would corrupt the registry.
    if (tree.root.toString() !== draft.newRoot) {
      throw new UnprocessableEntityException(
        `Rebuilt root ${tree.root} no longer matches the signed root ${draft.newRoot}. ` +
          `Discard this change set and start again.`,
      );
    }

    const newLeaves = new Map<string, string>();
    for (const transfer of draft.transfers) {
      const property = applied.find((p) => p.propertyId === transfer.propertyId)!;
      const proof = await this.tree.proofFor(tree, property);
      newLeaves.set(transfer.propertyId, proof.leaf.toString());
    }

    const decidedAt = new Date();

    try {
      await this.prisma.$transaction([
        ...draft.transfers.map((transfer) =>
          this.prisma.property.update({
            where: { propertyId: transfer.propertyId },
            data: { ownerCommitment: transfer.newOwnerCommitment },
          }),
        ),
        ...draft.transfers.map((transfer) =>
          this.prisma.transferRequest.update({
            where: { id: transfer.id },
            data: { status: 'PUBLISHED', txHash: draft.txHash, decidedAt },
          }),
        ),

        // A revoked plot leaves the tree (status !== ISSUED, D45) and its cached
        // proof is cleared: a cached path into a tree that no longer contains
        // the leaf is worse than no cache at all, because it still looks
        // answerable. merkleProof is a JSON column, so clearing it needs
        // Prisma.DbNull — plain `null` would store the JSON value `null`, which
        // still reads as "cached data present" to anything that only checks
        // for column presence rather than its content.
        ...draft.revocations.map((revocation) =>
          this.prisma.property.update({
            where: { propertyId: revocation.propertyId },
            data: {
              status: 'REVOKED',
              leaf: null,
              merkleProof: Prisma.DbNull,
              rootVersion: null,
            },
          }),
        ),
        ...draft.revocations.map((revocation) =>
          this.prisma.revocation.update({
            where: { id: revocation.id },
            data: { status: 'PUBLISHED', publishedAt: decidedAt },
          }),
        ),

        this.roots.recordRootStatement({
          root: tree.root,
          version: rootVersion,
          txHash: draft.txHash ?? '',
        }),
        // Rewrites every remaining ISSUED property, not just this round's two
        // lists — see the warning on RootService. `properties` here is already
        // the full rebuilt tree membership: every previously issued plot this
        // round left untouched, plus transferred plots (now carrying their new
        // commitment), minus revoked ones (already dropped by
        // applyChangesInMemory). Passing only draft.transfers/draft.revocations
        // here would silently leave every untouched owner holding a proof
        // against a superseded root.
        ...(await this.roots.proofCacheStatements(tree, properties, rootVersion)),

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
            // public history the same way it stays off chain (see
            // PropertyEventService.RevokedEventInput).
            detailHash: revocation.detailHash,
          })),
          { rootVersion, txHash: draft.txHash },
        ),

        this.prisma.changeSet.update({
          where: { id: draft.id },
          data: { status: 'PUBLISHED', rootVersion, publishedAt: decidedAt, txHash: draft.txHash },
        }),
      ]);
    } catch (error) {
      // The officer's wallet has already published this root on-chain (the
      // latestRoot check above confirms it) — a failure past this point
      // leaves the database behind a root that is now permanently true
      // on-chain. warnChainAheadOfDatabase exists precisely to surface that
      // loudly for manual reconciliation rather than let it pass silently.
      this.roots.warnChainAheadOfDatabase(draft.txHash ?? '', error);
      throw error;
    }

    this.logger.log(
      `change set #${draft.id} confirmed at root version ${rootVersion}: ` +
        `${draft.transfers.length} transfer(s), ${draft.revocations.length} revocation(s)`,
    );

    return {
      id: draft.id,
      rootVersion,
      txHash: draft.txHash,
      transferIds: draft.transfers.map((t) => t.id),
      revocationIds: draft.revocations.map((r) => r.id),
    };
  }

  /**
   * The tree as it WOULD look with every pending change applied: transferred
   * plots carry their new commitment, revoked plots are dropped entirely.
   * Purely in memory — nothing here writes.
   */
  private async applyChangesInMemory(
    transfers: { propertyId: string; newOwnerCommitment: string }[],
    revocations: { propertyId: string }[],
  ): Promise<Property[]> {
    const current = await this.tree.loadIssuedProperties();
    const newCommitments = new Map(transfers.map((t) => [t.propertyId, t.newOwnerCommitment]));
    const revoked = new Set(revocations.map((r) => r.propertyId));

    return current
      .filter((property) => !revoked.has(property.propertyId))
      .map((property) =>
        newCommitments.has(property.propertyId)
          ? { ...property, ownerCommitment: newCommitments.get(property.propertyId)! }
          : property,
      );
  }

  /**
   * Abandon a draft. Nothing was ever written to Property, TransferRequest or
   * Revocation — only `connect`ed to this draft — so releasing the relation is
   * enough to return them to `pending()`.
   */
  async discard(id: number): Promise<void> {
    const draft = await this.prisma.changeSet.findUnique({ where: { id } });
    if (!draft) throw new NotFoundException(`Change set #${id} not found`);
    if (draft.status !== 'DRAFT') {
      // Anything else is already PUBLISHED or DISCARDED. Relabelling it and
      // detaching transfers/revocations with `set: []` would corrupt the
      // audit trail — the on-chain state and the individual rows stay
      // correct, but the record of which batch published what is destroyed.
      throw new ConflictException(`Change set #${id} is already ${draft.status}`);
    }

    await this.prisma.changeSet.update({
      where: { id },
      data: { status: 'DISCARDED', transfers: { set: [] }, revocations: { set: [] } },
    });
  }
}
